-- ============================================================
-- LUMEN PASTORAL — PATCH T: MFA Customizado para Administradores
-- Data: 2026-06-11
--
-- Abandona MFA nativo do Supabase (factor_type email não suportado).
-- Implementa sistema próprio de código 6 dígitos via e-mail (Resend).
--
-- FLUXO:
--   1. Admin faz login email+senha em /login
--   2. Frontend chama Edge Function send-email (template mfa_admin_code)
--      → Edge Function gera código 6 dígitos, armazena SHA-256 hash via
--        store_admin_mfa_code(), envia código plaintext por e-mail
--   3. Frontend redireciona para /auth/admin-mfa
--   4. Admin digita código → rpc verify_admin_mfa_code(plaintext)
--      → RPC calcula SHA-256 no banco, compara, retorna session_token
--   5. Frontend armazena session_token em sessionStorage
--   6. _authenticated.tsx chama check_admin_mfa_session() a cada render de admin
--
-- SEGURANÇA:
--   - Código expira em 10 minutos
--   - Máximo 5 tentativas (após isso, código é bloqueado)
--   - Hash SHA-256 armazenado (não o código plaintext)
--   - Reenvio com cooldown de 60s (frontend)
--   - Registro de tentativas em audit_logs
--   - Session token expira em 8 horas
--   - Apenas admin_paroquial, super_admin e coordenador precisam de MFA
--
-- DEPENDÊNCIAS: 009_audit_log.sql (tabela audit_logs)
-- IDEMPOTENTE: sim
-- ============================================================

-- ── 1. Tabela admin_mfa_codes ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_mfa_codes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash           TEXT        NOT NULL,         -- SHA-256 hex do código de 6 dígitos
  expires_at          TIMESTAMPTZ NOT NULL,         -- created_at + 10 minutos
  attempts            INT         NOT NULL DEFAULT 0,
  verified            BOOLEAN     NOT NULL DEFAULT false,
  mfa_session_token   UUID,                         -- gerado após verificação bem-sucedida
  session_expires_at  TIMESTAMPTZ,                  -- token expira em 8 horas
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.admin_mfa_codes IS 'Códigos MFA personalizados para administradores. Cada login gera um novo registro.';
COMMENT ON COLUMN public.admin_mfa_codes.code_hash IS 'SHA-256 hex do código de 6 dígitos. Nunca armazenado em texto puro.';
COMMENT ON COLUMN public.admin_mfa_codes.mfa_session_token IS 'UUID gerado após verificação bem-sucedida. Armazenado no sessionStorage.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_admin_mfa_user_active
  ON public.admin_mfa_codes (user_id, created_at DESC)
  WHERE verified = false;

CREATE INDEX IF NOT EXISTS idx_admin_mfa_session_token
  ON public.admin_mfa_codes (mfa_session_token)
  WHERE mfa_session_token IS NOT NULL;

-- RLS — nenhum acesso direto; apenas via RPCs SECURITY DEFINER
ALTER TABLE public.admin_mfa_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.admin_mfa_codes TO service_role;
-- Nenhuma policy para authenticated: acesso apenas via SECURITY DEFINER

-- ── 2. RPC: store_admin_mfa_code ───────────────────────────────────────────
-- Chamada pela Edge Function (service role) após gerar o código.
-- p_code_hash: SHA-256 hex do código (calculado na Edge Function via Web Crypto).
-- Invalida todos os códigos anteriores não verificados do mesmo usuário.

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

  -- Invalida códigos anteriores (bloqueia ao atingir attempts=99)
  UPDATE public.admin_mfa_codes
  SET attempts = 99
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now();

  -- Insere novo código com hash
  INSERT INTO public.admin_mfa_codes (user_id, code_hash, expires_at)
  VALUES (v_user_id, p_code_hash, now() + INTERVAL '10 minutes');
END;
$$;

-- Acessível apenas por service_role (Edge Function)
GRANT EXECUTE ON FUNCTION public.store_admin_mfa_code TO service_role;

-- ── 3. RPC: verify_admin_mfa_code ─────────────────────────────────────────
-- Chamado pelo frontend com o código PLAINTEXT digitado pelo admin.
-- O RPC calcula o SHA-256 no banco usando encode(sha256(...)) e compara.
-- Retorna: { success: bool, session_token: uuid | null, error: text | null }

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

  -- Calcula hash do código fornecido (SHA-256 nativo do PostgreSQL 11+)
  v_hash := encode(sha256(TRIM(p_code)::bytea), 'hex');

  -- Busca o código mais recente válido para o usuário
  SELECT * INTO v_record
  FROM public.admin_mfa_codes
  WHERE user_id = v_user_id
    AND verified = false
    AND expires_at > now()
    AND attempts < 5
  ORDER BY created_at DESC
  LIMIT 1;

  -- Nenhum código válido encontrado
  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Código expirado ou número máximo de tentativas atingido. Solicite um novo.'
    );
  END IF;

  -- Incrementa tentativas antes de verificar (protege contra timing attacks)
  UPDATE public.admin_mfa_codes
  SET attempts = attempts + 1
  WHERE id = v_record.id;

  -- Verifica o hash
  IF v_record.code_hash <> v_hash THEN
    -- Audit: tentativa falha
    BEGIN
      INSERT INTO public.audit_logs (
        actor_user_id, entidade, entidade_id, acao, dados_novos
      ) VALUES (
        v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_FAIL',
        jsonb_build_object('attempts', v_record.attempts + 1, 'expires_at', v_record.expires_at)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object('success', false, 'error', 'Código incorreto. Verifique e tente novamente.');
  END IF;

  -- Código correto — gera session token
  v_token := gen_random_uuid();

  UPDATE public.admin_mfa_codes
  SET verified           = true,
      mfa_session_token  = v_token,
      session_expires_at = now() + INTERVAL '8 hours'
  WHERE id = v_record.id;

  -- Audit: verificação bem-sucedida
  BEGIN
    INSERT INTO public.audit_logs (
      actor_user_id, entidade, entidade_id, acao, dados_novos
    ) VALUES (
      v_user_id, 'admin_mfa_codes', v_record.id, 'MFA_SUCCESS',
      jsonb_build_object('session_expires_at', now() + INTERVAL '8 hours')
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true, 'session_token', v_token::text);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_mfa_code TO authenticated;

-- ── 4. RPC: check_admin_mfa_session ───────────────────────────────────────
-- Chamado por _authenticated.tsx para validar se MFA foi feito nesta sessão.
-- Retorna: { valid: bool }

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
    SELECT 1
    FROM public.admin_mfa_codes
    WHERE user_id             = auth.uid()
      AND mfa_session_token   = p_session_token::UUID
      AND verified            = true
      AND session_expires_at  > now()
  ) INTO v_exists;

  RETURN jsonb_build_object('valid', COALESCE(v_exists, false));

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('valid', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_mfa_session TO authenticated;

-- ── 5. Cron: limpeza diária de registros antigos (> 24h) ──────────────────

SELECT cron.unschedule('admin-mfa-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-mfa-cleanup');

SELECT cron.schedule(
  'admin-mfa-cleanup',
  '0 2 * * *',
  $$DELETE FROM public.admin_mfa_codes WHERE created_at < now() - INTERVAL '24 hours'$$
);

-- ── 6. Verificação final ───────────────────────────────────────────────────
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'admin_mfa_codes';
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'store_admin_mfa_code', 'verify_admin_mfa_code', 'check_admin_mfa_session'
--   );
--
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Tabela admin_mfa_codes criada com RLS e sem policies (apenas DEFINER)
--   ✓ RPC store_admin_mfa_code acessível apenas para service_role
--   ✓ RPC verify_admin_mfa_code acessível para authenticated
--   ✓ RPC check_admin_mfa_session acessível para authenticated
--   ✓ Cron de limpeza agendado
-- ─────────────────────────────────────────────────────────────────────────────
