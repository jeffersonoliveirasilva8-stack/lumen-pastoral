-- Migration 232 — fix _finalizar_tentativa_outbox: gravar sends_id na tentativa
--
-- Bug (OBS-2): p_sends_id é aceito como parâmetro e usado para lookup em
-- whatsapp_sends, mas o UPDATE final de whatsapp_outbox_tentativas não inclui
-- sends_id = p_sends_id. Resultado: coluna sends_id permanece NULL mesmo em
-- tentativas confirmadas, impossibilitando rastrear tentativa ↔ send.
--
-- Fix: adicionar sends_id = COALESCE(p_sends_id, sends_id) no UPDATE final
-- (e no UPDATE antecipado do caminho 'incerto' / aguardando).
-- COALESCE preserva o valor já gravado se p_sends_id for NULL.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION (sem DDL destrutivo).
-- RISCO: Baixo — altera apenas o UPDATE da tentativa. A lógica de decisão
-- (backoff, confirmado, falhou, cancelar) não é alterada.

CREATE OR REPLACE FUNCTION public._finalizar_tentativa_outbox(
  p_outbox_id         uuid,
  p_tentativa_id      uuid,
  p_reservation_token uuid,
  p_resultado         text,
  p_sends_id          uuid    DEFAULT NULL::uuid,
  p_max_tentativas    integer DEFAULT 5,
  p_definitivo        boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_tentativa          record;
  v_outbox             record;
  v_ws_status          text;
  v_ws_resp_http       int;
  v_backoff_minutes    numeric;
  v_next_attempt_at    timestamptz;
  v_novo_status_tent   text;
  v_novo_status_outbox text;
  v_rows               int;
BEGIN
  -- ── Validação do parâmetro p_resultado ──────────────────────────────────────
  IF p_resultado NOT IN ('confirmado', 'falhou', 'incerto', 'cancelar') THEN
    RAISE EXCEPTION 'resultado_invalido: % não é um valor aceito', p_resultado
      USING ERRCODE = '22023';
  END IF;

  -- ── Bloquear tentativa (FOR UPDATE) ────────────────────────────────────────
  SELECT id, outbox_id, reservation_token, status, dispatch_started_at,
         sends_id, dispatch_finished_at
  INTO   v_tentativa
  FROM   public.whatsapp_outbox_tentativas
  WHERE  id        = p_tentativa_id
    AND  outbox_id = p_outbox_id
  FOR    UPDATE;

  IF NOT FOUND THEN
    RETURN 'noop';
  END IF;

  -- Validar token (com dados frescos após lock)
  IF v_tentativa.reservation_token IS DISTINCT FROM p_reservation_token THEN
    RETURN 'noop';
  END IF;

  -- Validar status da tentativa
  IF v_tentativa.status NOT IN ('reservado', 'iniciado') THEN
    RETURN 'noop';
  END IF;

  -- ── Bloquear outbox (FOR UPDATE) ───────────────────────────────────────────
  SELECT id, status, membro_id, evento_tipo, evento_ref_id, tentativas_count
  INTO   v_outbox
  FROM   public.whatsapp_outbox
  WHERE  id     = p_outbox_id
    AND  status = 'reserved'
  FOR    UPDATE;

  IF NOT FOUND THEN
    RETURN 'noop';
  END IF;

  -- ── Consultar whatsapp_sends internamente ──────────────────────────────────
  -- Passo A: se p_sends_id fornecido, verificar vínculo com o outbox
  IF p_sends_id IS NOT NULL THEN
    SELECT ws.status, ws.resposta_http
    INTO   v_ws_status, v_ws_resp_http
    FROM   public.whatsapp_sends ws
    WHERE  ws.id            = p_sends_id
      AND  ws.membro_id     = v_outbox.membro_id
      AND  ws.evento_tipo   = v_outbox.evento_tipo
      AND  ws.evento_ref_id = v_outbox.evento_ref_id;
  END IF;

  -- Passo B: fallback — buscar por triplo se hint não vinculou
  IF v_ws_status IS NULL THEN
    SELECT ws.status, ws.resposta_http
    INTO   v_ws_status, v_ws_resp_http
    FROM   public.whatsapp_sends ws
    WHERE  ws.membro_id     = v_outbox.membro_id
      AND  ws.evento_tipo   = v_outbox.evento_tipo
      AND  ws.evento_ref_id = v_outbox.evento_ref_id
    ORDER  BY ws.criado_em DESC
    LIMIT  1;
  END IF;
  -- v_ws_status: 'pending'|'sent'|'failed'|'unknown'|NULL

  -- ── Lógica de decisão ──────────────────────────────────────────────────────

  -- CANCELAR
  IF p_resultado = 'cancelar' THEN
    IF v_ws_status = 'sent' THEN
      RAISE EXCEPTION
        'cancelar_sobre_sent: outbox % tentativa % — whatsapp_sends já confirmado',
        p_outbox_id, p_tentativa_id
        USING ERRCODE = 'P0001';
    END IF;
    v_novo_status_tent   := 'falhou';
    v_novo_status_outbox := 'cancelled';

  -- CONFIRMADO
  ELSIF p_resultado = 'confirmado' THEN
    IF v_ws_status = 'sent' THEN
      v_novo_status_tent   := 'confirmado';
      v_novo_status_outbox := 'sent';
    ELSIF v_ws_status IS NULL THEN
      RAISE EXCEPTION
        'confirmado_sem_registro_sends: outbox % tentativa % — sem evidência em whatsapp_sends',
        p_outbox_id, p_tentativa_id
        USING ERRCODE = 'P0001';
    ELSE
      -- pending, unknown, failed — estado indeterminado
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';
    END IF;

  -- INCERTO (timeout worker→EF)
  ELSIF p_resultado = 'incerto' THEN
    -- Se dentro da janela de segurança de 120s, adiar próxima tentativa
    IF v_tentativa.dispatch_started_at IS NOT NULL
       AND clock_timestamp() < v_tentativa.dispatch_started_at + interval '120 seconds' THEN
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'pending';
      v_next_attempt_at    := v_tentativa.dispatch_started_at + interval '120 seconds';

      -- FIX: gravar sends_id mesmo no caminho aguardando
      UPDATE public.whatsapp_outbox_tentativas
      SET    status               = v_novo_status_tent,
             sends_id             = COALESCE(p_sends_id, sends_id),
             dispatch_finished_at = clock_timestamp(),
             updated_at           = clock_timestamp()
      WHERE  id = p_tentativa_id;

      UPDATE public.whatsapp_outbox
      SET    status          = v_novo_status_outbox,
             next_attempt_at = v_next_attempt_at,
             updated_at      = clock_timestamp()
      WHERE  id = p_outbox_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'finalizar_outbox_inconsistente: outbox % não estava reserved', p_outbox_id
          USING ERRCODE = 'P0002';
      END IF;
      RETURN 'aguardando';
    END IF;
    -- Fora da janela: tratar como 'falhou' para decisão por v_ws_status
    p_resultado := 'falhou';
  END IF;

  -- FALHOU (incluindo 'incerto' reclassificado)
  IF p_resultado = 'falhou' THEN
    IF v_ws_status = 'sent' THEN
      v_novo_status_tent   := 'confirmado';
      v_novo_status_outbox := 'sent';

    ELSIF v_ws_status IN ('unknown', 'pending') THEN
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSIF v_ws_status = 'failed' AND v_ws_resp_http IS NOT NULL THEN
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSIF v_ws_status = 'failed' AND v_ws_resp_http IS NULL THEN
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSE
      -- v_ws_status IS NULL: sem registro em whatsapp_sends
      IF p_definitivo OR v_outbox.tentativas_count >= p_max_tentativas THEN
        v_novo_status_tent   := 'falhou';
        v_novo_status_outbox := 'failed';
      ELSE
        v_backoff_minutes    := LEAST(5.0 * POWER(2.0, v_outbox.tentativas_count - 1), 60.0);
        v_next_attempt_at    := clock_timestamp() + (v_backoff_minutes || ' minutes')::interval;
        v_novo_status_tent   := 'falhou';
        v_novo_status_outbox := 'pending';
      END IF;
    END IF;
  END IF;

  -- ── Escrita atômica: tentativa + outbox ────────────────────────────────────

  -- FIX: gravar sends_id na tentativa
  UPDATE public.whatsapp_outbox_tentativas
  SET    status               = v_novo_status_tent,
         sends_id             = COALESCE(p_sends_id, sends_id),
         dispatch_finished_at = clock_timestamp(),
         updated_at           = clock_timestamp()
  WHERE  id = p_tentativa_id;

  IF v_novo_status_outbox = 'pending' AND v_next_attempt_at IS NOT NULL THEN
    UPDATE public.whatsapp_outbox
    SET    status          = v_novo_status_outbox,
           next_attempt_at = v_next_attempt_at,
           updated_at      = clock_timestamp()
    WHERE  id = p_outbox_id;
  ELSE
    UPDATE public.whatsapp_outbox
    SET    status    = v_novo_status_outbox,
           updated_at = clock_timestamp()
    WHERE  id = p_outbox_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION
      'finalizar_outbox_inconsistente: outbox % não estava reserved', p_outbox_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN CASE v_novo_status_outbox
    WHEN 'sent'      THEN 'sent'
    WHEN 'failed'    THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'pending'   THEN 'retry'
    ELSE 'noop'
  END;
END;
$$;
