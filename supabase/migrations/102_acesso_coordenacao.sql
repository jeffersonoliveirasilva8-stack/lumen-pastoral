-- Migration 102 — Estrutura de níveis de acesso de coordenação
--
-- Mapeamento tipo_acesso (membros) → role (user_roles, app_role enum):
--   'coordenador' | 'administrador'  →  'admin_paroquial'
--   'vice'                            →  'coordenador'
--   'auxiliar'                        →  'lider'
--   'membro' | 'servidor' | outros    →  (sem entrada em user_roles / delete)
--
-- O trigger _sync_tipo_acesso_to_user_roles foi dropado em 054/056/097/099
-- porque o enum app_role não contém 'auxiliar'/'vice'.
-- Esta migration cria uma FUNCTION SECURITY DEFINER que faz o sync manualmente
-- e deve ser chamada pelo frontend ao mudar tipo_acesso.
--
-- Também faz backfill de todos os membros existentes.
-- IDEMPOTENTE: sim

-- ── 1. Função de sincronização ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_membro_acesso(
  p_membro_id  UUID,
  p_tipo_acesso TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_paroquia_id UUID;
  v_auth_user   UUID;
  v_role        public.app_role;
BEGIN
  -- Apenas coordenadores e admins paroquiais podem chamar
  IF NOT (
    public.is_coordenador_da_paroquia(
      (SELECT paroquia_id FROM public.membros WHERE id = p_membro_id LIMIT 1)
    ) OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_caller_id
        AND role IN ('admin_paroquial', 'super_admin')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Carrega dados do membro
  SELECT paroquia_id, auth_user_id
    INTO v_paroquia_id, v_auth_user
  FROM public.membros
  WHERE id = p_membro_id;

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Atualiza tipo_acesso no membro
  UPDATE public.membros
  SET tipo_acesso = p_tipo_acesso
  WHERE id = p_membro_id;

  -- Sincroniza user_roles apenas se houver auth_user_id vinculado
  IF v_auth_user IS NOT NULL THEN
    -- Determina role correspondente
    v_role := CASE p_tipo_acesso
      WHEN 'coordenador'   THEN 'admin_paroquial'::public.app_role
      WHEN 'administrador' THEN 'admin_paroquial'::public.app_role
      WHEN 'vice'          THEN 'coordenador'::public.app_role
      WHEN 'auxiliar'      THEN 'lider'::public.app_role
      ELSE NULL
    END;

    -- Remove roles existentes para esta paróquia (exceto super_admin)
    DELETE FROM public.user_roles
    WHERE user_id = v_auth_user
      AND paroquia_id = v_paroquia_id
      AND role <> 'super_admin';

    IF v_role IS NOT NULL THEN
      -- Insere o novo role
      INSERT INTO public.user_roles (user_id, paroquia_id, role)
      VALUES (v_auth_user, v_paroquia_id, v_role)
      ON CONFLICT (user_id, paroquia_id, role) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_membro_acesso(UUID, TEXT) TO authenticated;

-- ── 2. Backfill membros existentes ───────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  v_role public.app_role;
BEGIN
  FOR r IN
    SELECT m.id, m.paroquia_id, m.auth_user_id, m.tipo_acesso
    FROM public.membros m
    WHERE m.auth_user_id IS NOT NULL
      AND m.tipo_acesso IN ('coordenador', 'administrador', 'vice', 'auxiliar')
      AND m.ativo = true
  LOOP
    v_role := CASE r.tipo_acesso
      WHEN 'coordenador'   THEN 'admin_paroquial'::public.app_role
      WHEN 'administrador' THEN 'admin_paroquial'::public.app_role
      WHEN 'vice'          THEN 'coordenador'::public.app_role
      WHEN 'auxiliar'      THEN 'lider'::public.app_role
    END;

    -- Remove roles anteriores (exceto super_admin) e insere o correto
    DELETE FROM public.user_roles
    WHERE user_id = r.auth_user_id
      AND paroquia_id = r.paroquia_id
      AND role <> 'super_admin';

    INSERT INTO public.user_roles (user_id, paroquia_id, role)
    VALUES (r.auth_user_id, r.paroquia_id, v_role)
    ON CONFLICT (user_id, paroquia_id, role) DO NOTHING;
  END LOOP;
END;
$$;

-- Remove user_roles de membros que voltaram para 'membro'/'servidor'
DELETE FROM public.user_roles ur
WHERE EXISTS (
  SELECT 1 FROM public.membros m
  WHERE m.auth_user_id = ur.user_id
    AND m.paroquia_id  = ur.paroquia_id
    AND m.tipo_acesso  NOT IN ('coordenador', 'administrador', 'vice', 'auxiliar')
    AND ur.role NOT IN ('super_admin')
);

NOTIFY pgrst, 'reload schema';
