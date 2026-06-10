-- ============================================================
-- Migration 008: MFA Settings (estrutura base — sem enforcement)
-- Data: 2026-06-10
-- Contexto: Cria fundação para MFA futuro. Nenhum login é bloqueado
--           neste momento. O enforcement é habilitado via security_settings.
-- ============================================================

-- ── 1. Tabela de configurações MFA por usuário ─────────────────────────

CREATE TABLE IF NOT EXISTS public.user_mfa_settings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled          boolean     NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_mfa_settings_user_id_unique UNIQUE (user_id)
);

ALTER TABLE public.user_mfa_settings ENABLE ROW LEVEL SECURITY;

-- Cada usuário vê e gerencia apenas o próprio registro
CREATE POLICY "user_mfa_settings_own" ON public.user_mfa_settings
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- super_admin pode auditar todos
CREATE POLICY "user_mfa_settings_super_admin" ON public.user_mfa_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Cria registro automaticamente quando um usuário é criado
CREATE OR REPLACE FUNCTION public.create_mfa_settings_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_mfa_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_mfa ON auth.users;
CREATE TRIGGER on_auth_user_created_mfa
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_mfa_settings_for_user();

-- Backfill para usuários existentes
INSERT INTO public.user_mfa_settings (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. Feature flags de segurança ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_settings (
  key         text  PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode LER (para checar feature flags no frontend)
CREATE POLICY "security_settings_read" ON public.security_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Apenas super_admin pode modificar
CREATE POLICY "security_settings_super_admin_write" ON public.security_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Valores iniciais (MFA desabilitado — sem enforcement)
INSERT INTO public.security_settings (key, value, description)
VALUES
  (
    'mfa_required_for_coordination',
    'false',
    'Exige MFA para coordenadores e administradores paroquiais. Habilitar somente após rollout do componente MfaSetup.'
  ),
  (
    'mfa_required_for_admin',
    'false',
    'Exige MFA para super_admin. Habilitar somente após rollout do componente MfaSetup.'
  ),
  (
    'mfa_available',
    'true',
    'Exibe a seção de MFA em Minha Conta. Pode ser false para ocultar o recurso em ambientes de teste.'
  )
ON CONFLICT (key) DO NOTHING;

-- ── 3. Índices ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_mfa_settings_user_id ON public.user_mfa_settings (user_id);

-- ── 4. Grants ──────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON public.user_mfa_settings TO authenticated;
GRANT SELECT ON public.security_settings TO authenticated;
