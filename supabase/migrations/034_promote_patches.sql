-- ============================================================
-- Migration 034: Promove PATCH_T (MFA admin) e PATCH_X (rate limit email)
-- Data: 2026-06-13
--
-- CONTEXTO:
--   check_email_rate_limit() e store_admin_mfa_code() foram criadas
--   nos arquivos PATCH_T e PATCH_X, mas nunca incluídas em migrações
--   numeradas. A Edge Function send-email depende de ambas:
--     • check_email_rate_limit — chamada antes de todo envio (falha
--       silenciosa se não existir, mas deixa spam desprotegido)
--     • store_admin_mfa_code — chamada para MFA de administradores;
--       se não existir, retorna 500 e bloqueia login de admin
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS /
--              CREATE INDEX IF NOT EXISTS / CREATE TABLE IF NOT EXISTS)
-- DEPENDÊNCIAS: migration 009 (audit_logs), migration 031 (email_logs)
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- PATCH_X: Rate Limiting de E-mails (check_email_rate_limit)
-- ════════════════════════════════════════════════════════════════

-- 1. Coluna requester_user_id em email_logs
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.email_logs.requester_user_id
  IS 'UUID do usuário autenticado que solicitou o envio (NULL para chamadas de sistema).';

-- 2. Índices para queries de rate limit
CREATE INDEX IF NOT EXISTS idx_email_logs_dest_time
  ON public.email_logs (destinatario, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_time
  ON public.email_logs (requester_user_id, created_at DESC)
  WHERE requester_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_tipo_dest_time
  ON public.email_logs (tipo, destinatario, created_at DESC);

-- 3. RPC check_email_rate_limit
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

  c_dest_per_min    INT := 5;
  c_dest_per_hour   INT := 20;
  c_user_per_min    INT := 10;
  c_user_per_hour   INT := 50;
  c_mfa_per_10min   INT := 3;
BEGIN
  SELECT COUNT(*) INTO v_count_dest_1m
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 minute';

  IF v_count_dest_1m >= c_dest_per_min THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_min || ' e-mails por minuto para este destinatário');
  END IF;

  SELECT COUNT(*) INTO v_count_dest_1h
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count_dest_1h >= c_dest_per_hour THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_hour || ' e-mails por hora para este destinatário');
  END IF;

  IF p_tipo = 'mfa_admin_code' THEN
    SELECT COUNT(*) INTO v_count_mfa_10m
    FROM public.email_logs
    WHERE tipo = 'mfa_admin_code'
      AND destinatario = lower(trim(p_destinatario))
      AND status = 'enviado'
      AND created_at > now() - INTERVAL '10 minutes';

    IF v_count_mfa_10m >= c_mfa_per_10min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_mfa_per_10min || ' códigos MFA por 10 minutos');
    END IF;
  END IF;

  IF p_requester_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_user_1m
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 minute';

    IF v_count_user_1m >= c_user_per_min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_min || ' e-mails por minuto por conta');
    END IF;

    SELECT COUNT(*) INTO v_count_user_1h
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_count_user_1h >= c_user_per_hour THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_hour || ' e-mails por hora por conta');
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', null);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[rate_limit] Erro ao verificar rate limit: %', SQLERRM;
  RETURN jsonb_build_object('allowed', true, 'reason', null);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) FROM authenticated, anon;

-- 4. Cron limpeza email_logs > 90 dias
SELECT cron.unschedule('email-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-logs-cleanup');

SELECT cron.schedule(
  'email-logs-cleanup',
  '0 4 * * 0',
  $$DELETE FROM public.email_logs WHERE created_at < now() - INTERVAL '90 days'$$
);

-- ════════════════════════════════════════════════════════════════
-- PATCH_T: MFA Customizado para Administradores
-- ════════════════════════════════════════════════════════════════

-- 1. Tabela admin_mfa_codes
CREATE TABLE IF NOT EXISTS public.admin_mfa_codes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash           TEXT        NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INT         NOT NULL DEFAULT 0,
  verified            BOOLEAN     NOT NULL DEFAULT false,
  mfa_session_token   UUID,
  session_expires_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.admin_mfa_codes IS 'Códigos MFA personalizados para administradores. Cada login gera um novo registro.';
COMMENT ON COLUMN public.admin_mfa_codes.code_hash IS 'SHA-256 hex do código de 6 dígitos. Nunca armazenado em texto puro.';
COMMENT ON COLUMN public.admin_mfa_codes.mfa_session_token IS 'UUID gerado após verificação bem-sucedida. Armazenado no sessionStorage.';

CREATE INDEX IF NOT EXISTS idx_admin_mfa_user_active
  ON public.admin_mfa_codes (user_id, created_at DESC)
  WHERE verified = false;

CREATE INDEX IF NOT EXISTS idx_admin_mfa_session_token
  ON public.admin_mfa_codes (mfa_session_token)
  WHERE mfa_session_token IS NOT NULL;

ALTER TABLE public.admin_mfa_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.admin_mfa_codes TO service_role;

-- 2. RPC store_admin_mfa_code (chamada pela Edge Function com service_role)
CREATE OR REPLACE FUNCTION public.store_admin_mfa_code(
  p_user_email  TEXT,
  p_code_hash   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_user_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado: %', p_user_email;
  END IF;

  UPDATE public.admin_mfa_codes
  SET attempts = 99
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now();

  INSERT INTO public.admin_mfa_codes (user_id, code_hash, expires_at)
  VALUES (v_user_id, p_code_hash, now() + INTERVAL '10 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_admin_mfa_code TO service_role;

-- 3. RPC verify_admin_mfa_code
CREATE OR REPLACE FUNCTION public.verify_admin_mfa_code(
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record     public.admin_mfa_codes%ROWTYPE;
  v_token      UUID;
  v_user_id    UUID;
  v_hash       TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  v_hash := encode(sha256(TRIM(p_code)::bytea), 'hex');

  SELECT * INTO v_record
  FROM public.admin_mfa_codes
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now()
    AND attempts < 5
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Código expirado ou número máximo de tentativas atingido. Solicite um novo.');
  END IF;

  UPDATE public.admin_mfa_codes SET attempts = attempts + 1 WHERE id = v_record.id;

  IF v_record.code_hash <> v_hash THEN
    BEGIN
      INSERT INTO public.audit_logs (actor_user_id, entidade, entidade_id, acao, dados_novos)
      VALUES (v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_FAIL',
        jsonb_build_object('attempts', v_record.attempts + 1, 'expires_at', v_record.expires_at));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('success', false, 'error', 'Código incorreto. Verifique e tente novamente.');
  END IF;

  v_token := gen_random_uuid();

  UPDATE public.admin_mfa_codes
  SET verified = true, mfa_session_token = v_token, session_expires_at = now() + INTERVAL '8 hours'
  WHERE id = v_record.id;

  BEGIN
    INSERT INTO public.audit_logs (actor_user_id, entidade, entidade_id, acao, dados_novos)
    VALUES (v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_SUCCESS',
      jsonb_build_object('session_expires_at', now() + INTERVAL '8 hours'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true, 'session_token', v_token::text);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_mfa_code TO authenticated;

-- 4. RPC check_admin_mfa_session
CREATE OR REPLACE FUNCTION public.check_admin_mfa_session(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF p_session_token IS NULL OR TRIM(p_session_token) = '' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_mfa_codes
    WHERE user_id            = auth.uid()
      AND mfa_session_token  = p_session_token::UUID
      AND verified           = true
      AND session_expires_at > now()
  ) INTO v_exists;

  RETURN jsonb_build_object('valid', COALESCE(v_exists, false));

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('valid', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_mfa_session TO authenticated;

-- 5. Cron limpeza admin_mfa_codes > 24h
SELECT cron.unschedule('admin-mfa-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-mfa-cleanup');

SELECT cron.schedule(
  'admin-mfa-cleanup',
  '0 2 * * *',
  $$DELETE FROM public.admin_mfa_codes WHERE created_at < now() - INTERVAL '24 hours'$$
);

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--     AND routine_name IN (
--       'check_email_rate_limit',
--       'store_admin_mfa_code',
--       'verify_admin_mfa_code',
--       'check_admin_mfa_session'
--     );
--   → 4 linhas retornadas
-- ─────────────────────────────────────────────────────────────
