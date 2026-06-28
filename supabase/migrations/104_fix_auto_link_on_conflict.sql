-- Migration 104 — Corrige ON CONFLICT na função portal_auto_link_by_email
--
-- PROBLEMA: A função original (migration 011) usa ON CONFLICT (user_id, paroquia_id)
-- mas a constraint real da tabela user_roles é UNIQUE(user_id, role, paroquia_id) — 3 colunas.
-- Isso causava erro PostgreSQL 42P10 na primeira tentativa de login de membros sem roles,
-- fazendo o frontend cair no caminho de fallback (funcional, mas gerando erro silencioso).
--
-- FIX: Substitui ON CONFLICT (user_id, paroquia_id) por ON CONFLICT (user_id, role, paroquia_id).
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.portal_auto_link_by_email()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_email       TEXT;
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_nome        TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_auth_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_email');
  END IF;

  -- Encontra membro pelo email (sem auth_user_id ou já com o mesmo)
  SELECT id, paroquia_id, nome
  INTO   v_membro_id, v_paroquia_id, v_nome
  FROM   membros
  WHERE  LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(v_email))
    AND  (auth_user_id IS NULL OR auth_user_id = v_auth_id)
    AND  ativo = true
  ORDER  BY created_at ASC
  LIMIT  1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  -- Vincula auth_user_id
  UPDATE membros SET auth_user_id = v_auth_id WHERE id = v_membro_id;

  -- Garante profiles row (preserva paroquia_id existente)
  INSERT INTO profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_auth_id, v_email, v_nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = COALESCE(profiles.paroquia_id, EXCLUDED.paroquia_id),
        email         = EXCLUDED.email;

  -- Garante role de membro (constraint: UNIQUE(user_id, role, paroquia_id))
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'membro')
  ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success',    true,
    'membro_id',  v_membro_id,
    'nome',       v_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_auto_link_by_email() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_auto_link_by_email() FROM anon;

NOTIFY pgrst, 'reload schema';
