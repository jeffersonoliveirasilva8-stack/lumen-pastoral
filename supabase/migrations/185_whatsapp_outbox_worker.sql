-- ============================================================
-- Migration 185 — Outbox Worker: backoff, finalização atômica
--
-- 1. Adiciona `next_attempt_at` ao whatsapp_outbox para separar
--    o backoff de retry do TTL de reserva (reservation_expires_at).
--
-- 2. Atualiza _adquirir_outbox_pendente para respeitar next_attempt_at.
--
-- 3. Atualiza _expirar_e_reemitir_tentativa para aplicar backoff
--    exponencial no next_attempt_at ao reintegrar o outbox.
--
-- 4. Cria _finalizar_tentativa_outbox: RPC atômica que finaliza
--    tentativa + outbox em uma transação, usando SELECT FOR UPDATE
--    para prevenir finalizações concorrentes.
--    A RPC consulta whatsapp_sends internamente — não confia em
--    p_sends_status fornecido externamente pelo worker.
--
-- Backoff aprovado: 5 / 10 / 20 / 40 min; cap 60 min; MAX = 5 tentativas.
-- Intervalo de segurança para 'incerto' (timeout worker→EF): 120s.
--
-- Não altera triggers existentes. Fluxo direto (171–177) preservado.
-- search_path = '' em todas as funções.
-- ============================================================


-- ── 1. Coluna next_attempt_at ─────────────────────────────────────────────────

ALTER TABLE public.whatsapp_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.whatsapp_outbox.next_attempt_at IS
  'Horário mais cedo em que o outbox pode ser adquirido. '
  'DEFAULT now() = disponível imediatamente. '
  'Atualizado pela RPC de finalização quando resultado é retry/aguardando.';

-- Índice para _adquirir_outbox_pendente (substitui o anterior que não filtrava por tempo)
DROP INDEX IF EXISTS public.whatsapp_outbox_pending_idx;

CREATE INDEX IF NOT EXISTS whatsapp_outbox_pending_idx
  ON public.whatsapp_outbox (status, next_attempt_at, created_at)
  WHERE status = 'pending';


-- ── 2. _adquirir_outbox_pendente — atualizado ────────────────────────────────
--
-- Adiciona filtro next_attempt_at <= clock_timestamp() para respeitar backoff.
-- FOR UPDATE SKIP LOCKED garante aquisição atômica sem bloqueio entre workers.

CREATE OR REPLACE FUNCTION public._adquirir_outbox_pendente(
  p_paroquia_id uuid DEFAULT NULL
)
RETURNS TABLE (
  outbox_id              uuid,
  tentativa_id           uuid,
  reservation_token      uuid,
  reservation_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox_id uuid;
BEGIN
  WITH candidato AS (
    SELECT id
    FROM   public.whatsapp_outbox
    WHERE  status           = 'pending'
      AND  next_attempt_at <= clock_timestamp()          -- respeita backoff
      AND  (p_paroquia_id IS NULL OR paroquia_id = p_paroquia_id)
    ORDER  BY created_at
    FOR    UPDATE SKIP LOCKED
    LIMIT  1
  )
  UPDATE public.whatsapp_outbox o
  SET    status            = 'reserved',
         updated_at        = clock_timestamp(),
         tentativas_count  = tentativas_count + 1
  FROM   candidato
  WHERE  o.id = candidato.id
  RETURNING o.id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.whatsapp_outbox_tentativas (
    outbox_id,
    tentativa_num,
    reservation_token,
    reservation_expires_at,
    status
  )
  SELECT
    v_outbox_id,
    COALESCE((SELECT MAX(tentativa_num) FROM public.whatsapp_outbox_tentativas WHERE outbox_id = v_outbox_id), 0) + 1,
    gen_random_uuid(),
    clock_timestamp() + interval '5 minutes',
    'reservado'
  RETURNING outbox_id, id, reservation_token, reservation_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public._adquirir_outbox_pendente(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._adquirir_outbox_pendente(uuid) TO service_role;


-- ── 3. _expirar_e_reemitir_tentativa — backoff exponencial ───────────────────
--
-- Ao reintegrar o outbox para 'pending', define next_attempt_at com backoff
-- exponencial: min(5min × 2^(tentativas_count - 1), 60min).
-- tentativas_count já foi incrementado na aquisição desta tentativa.

CREATE OR REPLACE FUNCTION public._expirar_e_reemitir_tentativa(
  p_outbox_id    uuid,
  p_tentativa_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows_expiradas   int := 0;
  v_rows_outbox      int := 0;
  v_proxima_num      int;
  v_tentativas_count int;
  v_backoff_minutes  numeric;
  v_next_attempt_at  timestamptz;
BEGIN
  -- Passo 1: expirar tentativa reservada e não despachada
  UPDATE public.whatsapp_outbox_tentativas
  SET    status     = 'expirado',
         updated_at = clock_timestamp()
  WHERE  id                     = p_tentativa_id
    AND  outbox_id              = p_outbox_id
    AND  status                 = 'reservado'
    AND  dispatch_started_at    IS NULL
    AND  reservation_expires_at < clock_timestamp();

  GET DIAGNOSTICS v_rows_expiradas = ROW_COUNT;

  IF v_rows_expiradas = 0 THEN
    RETURN 'noop_ja_expirada';
  END IF;

  -- Passo 2: calcular backoff antes de reintegrar
  SELECT tentativas_count INTO v_tentativas_count
  FROM   public.whatsapp_outbox
  WHERE  id = p_outbox_id;

  -- Backoff exponencial: 5 × 2^(n-1), cap 60 minutos
  v_backoff_minutes := LEAST(5.0 * POWER(2.0, v_tentativas_count - 1), 60.0);
  v_next_attempt_at := clock_timestamp() + (v_backoff_minutes || ' minutes')::interval;

  -- Passo 3: reintegrar outbox para 'pending' com backoff
  UPDATE public.whatsapp_outbox
  SET    status           = 'pending',
         next_attempt_at  = v_next_attempt_at,
         updated_at       = clock_timestamp()
  WHERE  id     = p_outbox_id
    AND  status = 'reserved';

  GET DIAGNOSTICS v_rows_outbox = ROW_COUNT;

  IF v_rows_outbox = 0 THEN
    RAISE EXCEPTION
      'expirar_reemitir_outbox_inconsistente: outbox % não estava reserved (tentativa % expirada)',
      p_outbox_id, p_tentativa_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Passo 4: criar nova tentativa
  SELECT COALESCE(MAX(tentativa_num), 0) + 1
  INTO   v_proxima_num
  FROM   public.whatsapp_outbox_tentativas
  WHERE  outbox_id = p_outbox_id;

  INSERT INTO public.whatsapp_outbox_tentativas (
    outbox_id,
    tentativa_num,
    reservation_token,
    reservation_expires_at,
    status
  ) VALUES (
    p_outbox_id,
    v_proxima_num,
    gen_random_uuid(),
    clock_timestamp() + interval '5 minutes',
    'reservado'
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public._expirar_e_reemitir_tentativa(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._expirar_e_reemitir_tentativa(uuid, uuid) TO service_role;


-- ── 4. _finalizar_tentativa_outbox ───────────────────────────────────────────
--
-- RPC atômica: finaliza tentativa + outbox na mesma transação.
-- Usa SELECT FOR UPDATE para prevenir duas finalizações concorrentes.
-- Consulta whatsapp_sends internamente para classificar o resultado real;
-- p_sends_id é apenas um hint de desempenho, não base da decisão.
--
-- p_resultado aceita exatamente 4 valores:
--   'confirmado' — EF retornou ok:true, enviado:true
--   'falhou'     — EF retornou erro determinístico
--   'incerto'    — worker não recebeu resposta (timeout worker→EF)
--   'cancelar'   — evento descartado por motivo de negócio
--
-- p_definitivo = true: marca failed imediatamente sem considerar tentativas_count
--   (usado para sem_consentimento, telefone_ausente)
--
-- Retorna: 'sent' | 'retry' | 'aguardando' | 'failed' | 'cancelled' | 'noop'
--
-- Lança P0001 em inconsistências graves (confirmado sem sent, cancelar sobre sent).
-- Lança P0002 se UPDATE do outbox falhar após UPDATE da tentativa (rollback integral).

CREATE OR REPLACE FUNCTION public._finalizar_tentativa_outbox(
  p_outbox_id         uuid,
  p_tentativa_id      uuid,
  p_reservation_token uuid,
  p_resultado         text,
  p_sends_id          uuid    DEFAULT NULL,
  p_max_tentativas    int     DEFAULT 5,
  p_definitivo        boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tentativa         record;
  v_outbox            record;
  v_ws_status         text;
  v_ws_resp_http      int;
  v_backoff_minutes   numeric;
  v_next_attempt_at   timestamptz;
  v_novo_status_tent  text;
  v_novo_status_outbox text;
  v_rows              int;
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
    WHERE  ws.id          = p_sends_id
      AND  ws.membro_id   = v_outbox.membro_id
      AND  ws.evento_tipo = v_outbox.evento_tipo
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
    v_novo_status_tent  := 'falhou';
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
      -- Reintegrar com next_attempt_at = dispatch_started_at + 120s
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'pending';
      v_next_attempt_at    := v_tentativa.dispatch_started_at + interval '120 seconds';

      UPDATE public.whatsapp_outbox_tentativas
      SET    status              = v_novo_status_tent,
             dispatch_finished_at = clock_timestamp(),
             updated_at          = clock_timestamp()
      WHERE  id = p_tentativa_id;

      UPDATE public.whatsapp_outbox
      SET    status           = v_novo_status_outbox,
             next_attempt_at  = v_next_attempt_at,
             updated_at       = clock_timestamp()
      WHERE  id = p_outbox_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'finalizar_outbox_inconsistente: outbox % não estava reserved', p_outbox_id
          USING ERRCODE = 'P0002';
      END IF;
      RETURN 'aguardando';
    END IF;
    -- Fora da janela: tratar como 'falhou' para decisão por v_ws_status
    -- (cai no bloco FALHOU abaixo via goto implícito — reprocessar como falhou)
    p_resultado := 'falhou';  -- reclassificar para reutilizar a lógica abaixo
  END IF;

  -- FALHOU (incluindo 'incerto' reclassificado)
  IF p_resultado = 'falhou' THEN
    IF v_ws_status = 'sent' THEN
      -- EF completou mas worker não recebeu confirmação
      v_novo_status_tent   := 'confirmado';
      v_novo_status_outbox := 'sent';

    ELSIF v_ws_status IN ('unknown', 'pending') THEN
      -- Estado indeterminado — sem retry
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSIF v_ws_status = 'failed' AND v_ws_resp_http IS NOT NULL THEN
      -- Provider recebeu e rejeitou — sem retry
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSIF v_ws_status = 'failed' AND v_ws_resp_http IS NULL THEN
      -- Falha com resposta_http NULL — indeterminado (D11 pendente) — sem retry
      v_novo_status_tent   := 'falhou';
      v_novo_status_outbox := 'failed';

    ELSE
      -- v_ws_status IS NULL: sem registro em whatsapp_sends
      IF p_definitivo OR v_outbox.tentativas_count >= p_max_tentativas THEN
        v_novo_status_tent   := 'falhou';
        v_novo_status_outbox := 'failed';
      ELSE
        -- Retry com backoff exponencial
        v_backoff_minutes    := LEAST(5.0 * POWER(2.0, v_outbox.tentativas_count - 1), 60.0);
        v_next_attempt_at    := clock_timestamp() + (v_backoff_minutes || ' minutes')::interval;
        v_novo_status_tent   := 'falhou';
        v_novo_status_outbox := 'pending';
      END IF;
    END IF;
  END IF;

  -- ── Escrita atômica: tentativa + outbox ────────────────────────────────────

  UPDATE public.whatsapp_outbox_tentativas
  SET    status              = v_novo_status_tent,
         dispatch_finished_at = clock_timestamp(),
         updated_at          = clock_timestamp()
  WHERE  id = p_tentativa_id;

  IF v_novo_status_outbox = 'pending' AND v_next_attempt_at IS NOT NULL THEN
    UPDATE public.whatsapp_outbox
    SET    status           = v_novo_status_outbox,
           next_attempt_at  = v_next_attempt_at,
           updated_at       = clock_timestamp()
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

  -- Retorno semântico
  RETURN CASE v_novo_status_outbox
    WHEN 'sent'      THEN 'sent'
    WHEN 'failed'    THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'pending'   THEN 'retry'
    ELSE 'noop'
  END;
END;
$$;

REVOKE ALL ON FUNCTION public._finalizar_tentativa_outbox(uuid, uuid, uuid, text, uuid, int, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._finalizar_tentativa_outbox(uuid, uuid, uuid, text, uuid, int, boolean) TO service_role;


-- ── 5. Trigger updated_at para nova coluna ────────────────────────────────────
-- O trigger trg_outbox_updated_at já existe e usa _trg_fn_outbox_updated_at(),
-- que atualiza updated_at via clock_timestamp(). next_attempt_at é atualizado
-- explicitamente pelas RPCs — não precisa de trigger separado.


-- ── 6. Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
