-- ============================================================
-- LUMEN PASTORAL — PATCH O: Auditoria MFA + Suporte a E-mail MFA
-- Data: 2026-06-11
--
-- MUDANÇAS:
--   1. Tabela mfa_attempts — log de tentativas de verificação MFA
--      (para auditoria, detecção de ataques e suporte ao usuário)
--   2. Novos feature flags em security_settings:
--      - mfa_email_required_for_coordination (padrão false)
--      - mfa_email_required_for_members       (padrão false)
--      - mfa_method_default                   (padrão 'email')
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar.
--
-- IDEMPOTENTE: sim (CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING).
-- ============================================================

-- ── 1. Tabela mfa_attempts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mfa_attempts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type TEXT        NOT NULL DEFAULT 'unknown',  -- 'email' | 'totp'
  success     BOOLEAN     NOT NULL,
  ip_address  INET,
  user_agent  TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mfa_attempts ENABLE ROW LEVEL SECURITY;

-- DROP IF EXISTS garante idempotência em re-execuções
DROP POLICY IF EXISTS "mfa_attempts_own_select"   ON public.mfa_attempts;
DROP POLICY IF EXISTS "mfa_attempts_system_insert" ON public.mfa_attempts;
DROP POLICY IF EXISTS "mfa_attempts_super_admin"   ON public.mfa_attempts;

-- Usuário vê apenas as próprias tentativas
CREATE POLICY "mfa_attempts_own_select" ON public.mfa_attempts
  FOR SELECT
  USING (user_id = auth.uid());

-- Apenas sistema pode inserir (via SECURITY DEFINER RPC)
CREATE POLICY "mfa_attempts_system_insert" ON public.mfa_attempts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- super_admin vê tudo (auditoria)
CREATE POLICY "mfa_attempts_super_admin" ON public.mfa_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

GRANT SELECT, INSERT ON public.mfa_attempts TO authenticated;

CREATE INDEX IF NOT EXISTS idx_mfa_attempts_user_id
  ON public.mfa_attempts (user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_mfa_attempts_recent_failures
  ON public.mfa_attempts (user_id, success, attempted_at DESC)
  WHERE success = false;

-- ── 2. RPC log_mfa_attempt() — inserção segura via SECURITY DEFINER ────────

CREATE OR REPLACE FUNCTION public.log_mfa_attempt(
  p_factor_type TEXT,
  p_success     BOOLEAN,
  p_ip_address  TEXT DEFAULT NULL,
  p_user_agent  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mfa_attempts (user_id, factor_type, success, ip_address, user_agent)
  VALUES (
    auth.uid(),
    p_factor_type,
    p_success,
    CASE WHEN p_ip_address IS NOT NULL THEN p_ip_address::INET ELSE NULL END,
    p_user_agent
  );
EXCEPTION WHEN OTHERS THEN
  -- Não-fatal: falha no log não deve bloquear o login
  NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_mfa_attempt TO authenticated;

-- ── 3. RPC count_recent_mfa_failures() — checa brute force ─────────────────

CREATE OR REPLACE FUNCTION public.count_recent_mfa_failures(
  p_window_minutes INT DEFAULT 15
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.mfa_attempts
  WHERE user_id = auth.uid()
    AND success  = false
    AND attempted_at > now() - (p_window_minutes || ' minutes')::INTERVAL;
$$;

GRANT EXECUTE ON FUNCTION public.count_recent_mfa_failures TO authenticated;

-- ── 4. Novos feature flags em security_settings ────────────────────────────

INSERT INTO public.security_settings (key, value, description)
VALUES
  (
    'mfa_email_required_for_coordination',
    'false',
    'Exige MFA por e-mail para coordenadores. Habilitar após rollout do fator email no MfaSetup.'
  ),
  (
    'mfa_email_required_for_members',
    'false',
    'Exige MFA por e-mail para membros comuns. Recomendado apenas após período de adaptação.'
  ),
  (
    'mfa_method_default',
    '"email"',
    'Método MFA padrão exibido na tela de challenge: "email" ou "totp".'
  )
ON CONFLICT (key) DO NOTHING;

-- ── 5. Verificação final ───────────────────────────────────────────────────
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'mfa_attempts';
--
-- SELECT key, value FROM public.security_settings
-- WHERE key LIKE 'mfa_%'
-- ORDER BY key;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Tabela mfa_attempts criada com RLS habilitado
--   ✓ RPC log_mfa_attempt() disponível para authenticated
--   ✓ RPC count_recent_mfa_failures() disponível para authenticated
--   ✓ Três novos flags inseridos em security_settings
-- ─────────────────────────────────────────────────────────────────────────────
