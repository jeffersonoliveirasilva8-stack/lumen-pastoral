-- ============================================================
-- LUMEN PASTORAL — PATCH X: Rate Limiting de E-mails
-- Data: 2026-06-11
--
-- PROBLEMA:
--   A Edge Function send-email aceita qualquer requisição com token
--   Supabase válido sem limite de frequência. Se um token vazar, um
--   atacante pode usá-lo para spam ilimitado via Resend.
--
-- SOLUÇÃO:
--   1. Adicionar coluna requester_user_id em email_logs para rastrear
--      qual usuário autenticado solicitou cada envio.
--   2. Criar função RPC check_email_rate_limit() que a Edge Function
--      chamará antes de enviar — retorna { allowed: bool, reason: text }.
--   3. Índices compostos para queries de rate limit eficientes.
--
-- LIMITES (configuráveis via parâmetros da RPC):
--   Por destinatário (email do receptor):
--     - Máximo 5 envios por minuto
--     - Máximo 20 envios por hora
--   Por usuário autenticado (quem chamou a Edge Function):
--     - Máximo 10 envios por minuto (inclui envios para diferentes destinatários)
--     - Máximo 50 envios por hora
--   Por template MFA (mfa_admin_code):
--     - Máximo 3 por 10 minutos por destinatário (cooldown frontend = 60s)
--
-- DEPENDÊNCIA: PATCH_R_EMAIL_LOGS (tabela email_logs deve existir)
-- IDEMPOTENTE: sim
-- ============================================================

-- ── 1. Adicionar coluna requester_user_id em email_logs ───────────────────────

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.email_logs.requester_user_id
  IS 'UUID do usuário autenticado que solicitou o envio (NULL para chamadas de sistema).';

-- ── 2. Índices para queries de rate limit ──────────────────────────────────────

-- Por destinatário + tempo (para limites por receptor)
CREATE INDEX IF NOT EXISTS idx_email_logs_dest_time
  ON public.email_logs (destinatario, created_at DESC);

-- Por usuário solicitante + tempo (para limites por usuário autenticado)
CREATE INDEX IF NOT EXISTS idx_email_logs_user_time
  ON public.email_logs (requester_user_id, created_at DESC)
  WHERE requester_user_id IS NOT NULL;

-- Por tipo + destinatário + tempo (para limites por template)
CREATE INDEX IF NOT EXISTS idx_email_logs_tipo_dest_time
  ON public.email_logs (tipo, destinatario, created_at DESC);

-- ── 3. RPC check_email_rate_limit ─────────────────────────────────────────────
-- Chamada pela Edge Function ANTES de enviar.
-- A Edge Function passa: destinatario (to), tipo (template), user_id (JWT sub).
-- Retorna { allowed: bool, reason: text | null }.

CREATE OR REPLACE FUNCTION public.check_email_rate_limit(
  p_destinatario    TEXT,
  p_tipo            TEXT,
  p_requester_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_dest_1m   INT;
  v_count_dest_1h   INT;
  v_count_user_1m   INT;
  v_count_user_1h   INT;
  v_count_mfa_10m   INT;

  -- Limites por destinatário
  c_dest_per_min    INT := 5;
  c_dest_per_hour   INT := 20;

  -- Limites por usuário autenticado (quem faz a chamada)
  c_user_per_min    INT := 10;
  c_user_per_hour   INT := 50;

  -- Limite específico para MFA (mais restritivo — frontend tem cooldown de 60s)
  c_mfa_per_10min   INT := 3;
BEGIN
  -- ── Contagem por destinatário ────────────────────────────────────────────────

  SELECT COUNT(*) INTO v_count_dest_1m
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 minute';

  IF v_count_dest_1m >= c_dest_per_min THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_min || ' e-mails por minuto para este destinatário'
    );
  END IF;

  SELECT COUNT(*) INTO v_count_dest_1h
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count_dest_1h >= c_dest_per_hour THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_hour || ' e-mails por hora para este destinatário'
    );
  END IF;

  -- ── Contagem por template MFA (mais restritiva) ──────────────────────────────

  IF p_tipo = 'mfa_admin_code' THEN
    SELECT COUNT(*) INTO v_count_mfa_10m
    FROM public.email_logs
    WHERE tipo = 'mfa_admin_code'
      AND destinatario = lower(trim(p_destinatario))
      AND status = 'enviado'
      AND created_at > now() - INTERVAL '10 minutes';

    IF v_count_mfa_10m >= c_mfa_per_10min THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'Rate limit: máximo de ' || c_mfa_per_10min || ' códigos MFA por 10 minutos'
      );
    END IF;
  END IF;

  -- ── Contagem por usuário autenticado ─────────────────────────────────────────

  IF p_requester_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_user_1m
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 minute';

    IF v_count_user_1m >= c_user_per_min THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_min || ' e-mails por minuto por conta'
      );
    END IF;

    SELECT COUNT(*) INTO v_count_user_1h
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_count_user_1h >= c_user_per_hour THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_hour || ' e-mails por hora por conta'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', null);

EXCEPTION WHEN OTHERS THEN
  -- Em caso de erro de DB, deixa passar (fail open) para não bloquear envios legítimos
  RAISE WARNING '[rate_limit] Erro ao verificar rate limit: %', SQLERRM;
  RETURN jsonb_build_object('allowed', true, 'reason', null);
END;
$$;

-- Apenas service_role (Edge Function) pode chamar esta RPC
GRANT EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) FROM authenticated, anon;

-- ── 4. Cron: limpeza de email_logs > 90 dias ──────────────────────────────────

SELECT cron.unschedule('email-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-logs-cleanup');

SELECT cron.schedule(
  'email-logs-cleanup',
  '0 4 * * 0',  -- todo domingo às 04:00 UTC
  $$DELETE FROM public.email_logs WHERE created_at < now() - INTERVAL '90 days'$$
);

-- ── 5. Verificação ────────────────────────────────────────────────────────────
--
-- Confirmar colunas adicionadas:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'email_logs' AND table_schema = 'public'
-- ORDER BY ordinal_position;
-- → Deve incluir 'requester_user_id'
--
-- Testar RPC (como service_role):
-- SELECT check_email_rate_limit('test@test.com', 'ativacao_conta', null);
-- → { "allowed": true, "reason": null }
-- ─────────────────────────────────────────────────────────────────────────────
