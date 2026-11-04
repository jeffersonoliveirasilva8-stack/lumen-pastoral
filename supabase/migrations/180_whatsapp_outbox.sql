-- ============================================================
-- Migration 180 — Transactional Outbox para WhatsApp
--
-- Implementa o padrão Outbox para despacho assíncrono de
-- mensagens WhatsApp, desacoplando triggers de banco do
-- envio HTTP via Edge Function.
--
-- Tabelas:
--   whatsapp_outbox           — registro de eventos pendentes
--   whatsapp_outbox_tentativas — tentativas de despacho por worker
--
-- Função:
--   _expirar_e_reemitir_tentativa — expira reserva vencida e cria
--   nova tentativa atomicamente; usa RAISE EXCEPTION para garantir
--   rollback integral se qualquer passo obrigatório falhar.
--
-- Status do outbox:
--   pending   → aguardando worker reservar
--   reserved  → worker reservou, aguardando despacho
--   sent      → confirmado pelo NotificationSrv
--   failed    → falha definitiva
--   cancelled → cancelado manualmente
--
-- Status das tentativas:
--   reservado → worker adquiriu, aguardando envio
--   iniciado  → Edge Function recebeu e está despachando
--   confirmado→ 202 recebido do NotificationSrv
--   expirado  → reserva venceu antes do despacho
--   falhou    → erro no despacho
--
-- search_path = '' em todas as funções (prevenção de schema injection).
-- ============================================================

-- ── 1. Tabela whatsapp_outbox ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id        uuid        NOT NULL,          -- dedup: md5(em.id:seq)::uuid
  evento_ref_id    uuid        NOT NULL,          -- referência da entidade de origem
  evento_tipo      text        NOT NULL,
  membro_id        uuid        NOT NULL REFERENCES public.membros(id),
  paroquia_id      uuid        NOT NULL REFERENCES public.paroquias(id),
  payload          jsonb       NOT NULL DEFAULT '{}',
  status           text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reserved','sent','failed','cancelled')),
  tentativas_count int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_evento_id_key
  ON public.whatsapp_outbox (evento_id);

CREATE INDEX IF NOT EXISTS whatsapp_outbox_pending_idx
  ON public.whatsapp_outbox (status, created_at)
  WHERE status = 'pending';

-- ── 2. Tabela whatsapp_outbox_tentativas ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_outbox_tentativas (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id              uuid        NOT NULL REFERENCES public.whatsapp_outbox(id) ON DELETE CASCADE,
  tentativa_num          int         NOT NULL,
  reservation_token      uuid        NOT NULL DEFAULT gen_random_uuid(),
  reservation_expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  dispatch_started_at    timestamptz,
  dispatch_finished_at   timestamptz,
  status                 text        NOT NULL DEFAULT 'reservado'
    CHECK (status IN ('reservado','iniciado','confirmado','expirado','falhou')),
  sends_id               uuid,       -- FK para whatsapp_sends após despacho
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, tentativa_num)
);

CREATE INDEX IF NOT EXISTS whatsapp_outbox_tentativas_outbox_id_idx
  ON public.whatsapp_outbox_tentativas (outbox_id, status);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.whatsapp_outbox            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_outbox_tentativas ENABLE ROW LEVEL SECURITY;

-- Acesso apenas via service_role (worker + Edge Function interna)
CREATE POLICY "outbox_service_only" ON public.whatsapp_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tentativas_service_only" ON public.whatsapp_outbox_tentativas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Função: _expirar_e_reemitir_tentativa ─────────────────────────────────
--
-- Expira uma tentativa reservada vencida e cria nova tentativa.
-- Atomicidade garantida por RAISE EXCEPTION: se qualquer passo
-- obrigatório falhar após uma escrita, a exceção reverte toda a
-- transação do chamador (autocommit: rollback implícito pelo driver;
-- transação explícita: chamador deve emitir ROLLBACK ao capturar).
--
-- Retorna:
--   'ok'               — sucesso: tentativa expirada, nova criada
--   'noop_ja_expirada' — Passo 1 retornou 0 rows (sem escrita); outro
--                        worker ganhou ou reserva ainda não venceu
--
-- Lança SQLSTATE P0002 se Passo 2 falhar após Passo 1 ter escrito:
--   o chamador deve tratar como falha transitória (log + backoff).

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
  v_rows_expiradas int := 0;
  v_rows_outbox    int := 0;
  v_proxima_num    int;
BEGIN
  -- Passo 1: expirar tentativa atomicamente.
  -- WHERE garante que apenas uma reserva vencida e não despachada seja afetada.
  -- Se retornar 0 rows: outro worker ganhou a corrida ou a reserva ainda não
  -- venceu. Nenhuma escrita foi feita — retorno limpo, sem rollback necessário.
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
    -- Sem alteração — retorno limpo.
    RETURN 'noop_ja_expirada';
  END IF;

  -- Passo 2: reintegrar outbox para 'pending'.
  -- Se retornar 0 rows: Passo 1 já alterou a tentativa. Sem RAISE aqui,
  -- a transação confirmaria estado parcial (tentativa='expirado' sem nova
  -- tentativa e sem outbox reintegrado). RAISE EXCEPTION força rollback integral.
  UPDATE public.whatsapp_outbox
  SET    status     = 'pending',
         updated_at = clock_timestamp()
  WHERE  id     = p_outbox_id
    AND  status = 'reserved';

  GET DIAGNOSTICS v_rows_outbox = ROW_COUNT;

  IF v_rows_outbox = 0 THEN
    -- Força rollback integral — reverte o Passo 1 junto.
    RAISE EXCEPTION
      'expirar_reemitir_outbox_inconsistente: outbox % não estava reserved (tentativa % expirada)',
      p_outbox_id, p_tentativa_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Passo 3: criar nova tentativa.
  -- UNIQUE (outbox_id, tentativa_num) protege contra duas tentativas com o
  -- mesmo número se dois workers atingirem este ponto concorrentemente:
  -- o segundo recebe unique_violation, revertendo toda a sua transação.
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

-- ── 5. Função: _adquirir_outbox_pendente ─────────────────────────────────────
--
-- Aquisição atômica via CTE com FOR UPDATE SKIP LOCKED.
-- Worker chama esta função para reservar um item pendente.
-- Retorna o outbox_id e o tentativa_id reservados, ou NULL se não há pendentes.

CREATE OR REPLACE FUNCTION public._adquirir_outbox_pendente(
  p_paroquia_id uuid DEFAULT NULL
)
RETURNS TABLE (
  outbox_id      uuid,
  tentativa_id   uuid,
  reservation_token uuid,
  reservation_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox_id uuid;
BEGIN
  -- Seleciona e bloqueia atomicamente um outbox pendente
  WITH candidato AS (
    SELECT id
    FROM   public.whatsapp_outbox
    WHERE  status = 'pending'
      AND  (p_paroquia_id IS NULL OR paroquia_id = p_paroquia_id)
    ORDER  BY created_at
    FOR    UPDATE SKIP LOCKED
    LIMIT  1
  )
  UPDATE public.whatsapp_outbox o
  SET    status     = 'reserved',
         updated_at = clock_timestamp(),
         tentativas_count = tentativas_count + 1
  FROM   candidato
  WHERE  o.id = candidato.id
  RETURNING o.id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    RETURN;  -- nenhum pendente; retorna 0 rows
  END IF;

  -- Cria tentativa para o outbox reservado
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

-- ── 6. Trigger: updated_at automático ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trg_fn_outbox_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outbox_updated_at
  BEFORE UPDATE ON public.whatsapp_outbox
  FOR EACH ROW EXECUTE FUNCTION public._trg_fn_outbox_updated_at();

CREATE TRIGGER trg_outbox_tentativas_updated_at
  BEFORE UPDATE ON public.whatsapp_outbox_tentativas
  FOR EACH ROW EXECUTE FUNCTION public._trg_fn_outbox_updated_at();
