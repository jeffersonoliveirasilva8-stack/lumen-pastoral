-- ============================================================
-- Migration 035: Diagnóstico de Ativação — RPCs cirúrgicas
-- Data: 2026-06-13
--
-- CONTEXTO:
--   Auditoria completa do fluxo de ativação revelou pontos de falha
--   que o painel existente (031) não cobre:
--     a) auth.users sem membros correspondentes (usuários órfãos)
--     b) vincular auth_user_id de um membro específico por e-mail
--     c) recriar profile/role de um membro específico com auth_user_id
--     d) listar membros que ativaram mas nunca voltaram a logar
--     e) bug: ativar_conta_membro não gravava nome_completo no profile
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE / ON CONFLICT)
-- DEPENDÊNCIAS: migrations 012, 031
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 0. FIX: ativar_conta_membro — adiciona nome_completo no profile
--    Bug original: INSERT em profiles omitia nome_completo,
--    causando nome=null no cabeçalho do portal quando o
--    portal_auto_link_by_email falha e o fallback por email roda.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ativar_conta_membro()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
  v_nome      TEXT;
  v_paroq_id  UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Tenta por auth_user_id (normal após auto-link)
  UPDATE membros
  SET conta_ativada = true
  WHERE auth_user_id = v_auth_id AND ativo = true
  RETURNING id, nome, paroquia_id INTO v_membro_id, v_nome, v_paroq_id;

  -- Fallback por email (auth_user_id ainda NULL no momento da ativação)
  IF v_membro_id IS NULL THEN
    UPDATE membros
    SET conta_ativada = true, auth_user_id = v_auth_id
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
      AND ativo = true
    RETURNING id, nome, paroquia_id INTO v_membro_id, v_nome, v_paroq_id;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Garante profiles row com nome_completo (corrige bug da versão anterior)
  BEGIN
    INSERT INTO profiles (id, email, nome_completo, paroquia_id)
    VALUES (v_auth_id, auth.email(), v_nome, v_paroq_id)
    ON CONFLICT (id) DO UPDATE
      SET nome_completo = COALESCE(profiles.nome_completo, EXCLUDED.nome_completo),
          paroquia_id   = COALESCE(profiles.paroquia_id,   EXCLUDED.paroquia_id),
          email         = EXCLUDED.email;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Garante role de membro em user_roles
  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    VALUES (v_auth_id, v_paroq_id, 'membro')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ativar_conta_membro() TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 1. admin_get_auth_sem_membro
--    auth.users que têm profile na paróquia do admin mas NÃO têm
--    um membro correspondente via auth_user_id.
--    Útil para detectar usuários auth órfãos (criaram conta mas
--    nunca foram vinculados a um membro aprovado).
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_auth_sem_membro()
RETURNS TABLE(
  auth_user_id     UUID,
  email            TEXT,
  criado_em        TIMESTAMPTZ,
  ultimo_login     TIMESTAMPTZ,
  email_confirmado BOOLEAN,
  tem_profile      BOOLEAN,
  tem_role         BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT,
    au.created_at,
    au.last_sign_in_at,
    (au.email_confirmed_at IS NOT NULL),
    EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = au.id),
    EXISTS(
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = au.id
        AND ur.paroquia_id = v_paroquia_id
        AND ur.role IN ('membro','servidor','auxiliar','coordenador')
    )
  FROM auth.users au
  -- Tem profile na paróquia (portanto, é um usuário do sistema)
  WHERE EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.id = au.id AND p.paroquia_id = v_paroquia_id
  )
  -- Mas NÃO tem membro vinculado nesta paróquia
  AND NOT EXISTS(
    SELECT 1 FROM public.membros m
    WHERE m.auth_user_id = au.id
      AND m.paroquia_id  = v_paroquia_id
      AND m.ativo        = true
  )
  -- Exclui admins/coordenadores (são usuários legítimos sem membros)
  AND NOT EXISTS(
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = au.id
      AND ur.role IN ('admin_paroquial', 'super_admin', 'coordenador')
  )
  ORDER BY au.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_auth_sem_membro() TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. admin_vincular_auth_membro
--    Vincula auth_user_id de um membro específico por e-mail.
--    Cria profile e role se ausentes.
--    Substitui ter que rodar admin_reprocessar_pendentes (que afeta TODOS).
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_vincular_auth_membro(p_membro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro      RECORD;
  v_au_id       UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_sem_paroquia');
  END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT m.id, m.nome, m.email, m.auth_user_id, m.paroquia_id
  INTO v_membro
  FROM public.membros m
  WHERE m.id = p_membro_id AND m.paroquia_id = v_paroquia_id;

  IF v_membro.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  IF v_membro.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'acao', 'already_linked',
      'auth_user_id', v_membro.auth_user_id
    );
  END IF;

  IF v_membro.email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_email');
  END IF;

  -- Busca auth.users pelo e-mail do membro
  SELECT au.id INTO v_au_id
  FROM auth.users au
  WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(v_membro.email))
  LIMIT 1;

  IF v_au_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_user_not_found');
  END IF;

  -- Vincula
  UPDATE public.membros SET auth_user_id = v_au_id WHERE id = v_membro.id;

  -- Garante profile com nome_completo
  INSERT INTO public.profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_au_id, v_membro.email, v_membro.nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = COALESCE(profiles.nome_completo, EXCLUDED.nome_completo),
        paroquia_id   = COALESCE(profiles.paroquia_id,   EXCLUDED.paroquia_id),
        email         = EXCLUDED.email;

  -- Garante role
  INSERT INTO public.user_roles (user_id, paroquia_id, role)
  VALUES (v_au_id, v_paroquia_id, 'membro')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success',      true,
    'acao',         'linked',
    'auth_user_id', v_au_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_auth_membro(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. admin_recriar_profile_role
--    Recria profile e role para um membro específico que já tem
--    auth_user_id mas está com profile/role corrompido ou ausente.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_recriar_profile_role(p_membro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro      RECORD;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_sem_paroquia');
  END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT m.id, m.nome, m.email, m.auth_user_id, m.paroquia_id
  INTO v_membro
  FROM public.membros m
  WHERE m.id = p_membro_id AND m.paroquia_id = v_paroquia_id;

  IF v_membro.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  IF v_membro.auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_auth_user_id');
  END IF;

  -- Recria profile
  INSERT INTO public.profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_membro.auth_user_id, v_membro.email, v_membro.nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = COALESCE(profiles.paroquia_id, EXCLUDED.paroquia_id),
        email         = EXCLUDED.email;

  -- Recria role
  INSERT INTO public.user_roles (user_id, paroquia_id, role)
  VALUES (v_membro.auth_user_id, v_paroquia_id, 'membro')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro.id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recriar_profile_role(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. admin_get_ativados_sem_login
--    Membros com conta_ativada = true mas last_sign_in_at IS NULL
--    (criaram senha mas nunca voltaram a fazer login).
--    Indica membros que completaram o onboarding mas não acessam o portal.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_ativados_sem_login()
RETURNS TABLE(
  membro_id       UUID,
  nome            TEXT,
  email           TEXT,
  auth_user_id    UUID,
  conta_ativada   BOOLEAN,
  ultimo_login    TIMESTAMPTZ,
  ativado_em      TIMESTAMPTZ,
  token_acesso    UUID,
  token_expirado  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.nome,
    m.email,
    m.auth_user_id,
    m.conta_ativada,
    au.last_sign_in_at,
    m.updated_at,                             -- proxy de "quando ativou"
    m.token_acesso,
    (m.token_acesso_expires_at IS NOT NULL AND m.token_acesso_expires_at < now())
  FROM public.membros m
  LEFT JOIN auth.users au ON au.id = m.auth_user_id
  WHERE m.paroquia_id   = v_paroquia_id
    AND m.ativo          = true
    AND m.conta_ativada  = true
    AND (au.id IS NULL OR au.last_sign_in_at IS NULL)
  ORDER BY m.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_ativados_sem_login() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--     AND routine_name IN (
--       'admin_get_auth_sem_membro',
--       'admin_vincular_auth_membro',
--       'admin_recriar_profile_role',
--       'admin_get_ativados_sem_login'
--     );
--   → 4 linhas
--
--   -- Verifica fix do nome_completo:
--   SELECT routine_definition FROM information_schema.routines
--   WHERE routine_name = 'ativar_conta_membro';
--   → deve incluir 'nome_completo'
-- ─────────────────────────────────────────────────────────────
