-- Migration 105 — Corrige login infinito para membros regulares
--
-- PROBLEMA (raiz encadeada):
--   1. Migration 102 deletou todos os user_roles de membros com tipo_acesso 'membro'/'servidor'
--   2. Migration 104 (ON CONFLICT fix) pode não ter sido aplicada em produção
--   3. RLS policy membro_read_own usava = (case-sensitive) em vez de LOWER()
--      → fallback de email falhava silenciosamente quando o case do email diferia
--   4. Com roles vazios + RPC falhando + fallback de email bloqueado por RLS:
--      _resolveRoute retornava /membro/login para usuário autenticado
--   5. Na tela de login: clearTimeout() era chamado mas setChecking(false) nunca era →
--      spinner infinito permanente (o safety timeout de 8s já fora cancelado)
--
-- FIXES:
--   A. Reaplicar portal_auto_link_by_email com ON CONFLICT correto (idempotente)
--   B. Corrigir membro_read_own para comparação case-insensitive de email
--   C. Recriar user_roles 'membro' para membros sem roles (deletados em migration 102)
--
-- IDEMPOTENTE: sim

-- ── A. Reaplicar portal_auto_link_by_email com ON CONFLICT correto ────────────

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

  -- Garante role de membro (enum app_role real: {super_admin,admin_paroquial,lider,servidor,coordenador})
  -- 'membro' não existe no enum — o role correto para membros regulares é 'servidor'
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'servidor')
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

-- ── B. Corrigir RLS membro_read_own: case-insensitive email comparison ────────
--
-- A policy original usava `email = auth.email()` (case-sensitive no PostgreSQL).
-- Se o email no banco tiver case diferente do auth.email(), a linha era bloqueada
-- pelo RLS antes do filtro ILIKE da query chegar a ela → fallback de email falhava.

DROP POLICY IF EXISTS membro_read_own ON public.membros;

CREATE POLICY membro_read_own ON public.membros
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
  );

-- ── C. Recriar user_roles 'membro' para membros sem roles ────────────────────
--
-- Migration 102 executou DELETE em user_roles para todos os membros com
-- tipo_acesso NOT IN ('coordenador', 'administrador', 'vice', 'auxiliar'),
-- removendo os roles de membros regulares ('membro', 'servidor').
-- Esses membros ficaram com roles vazios, causando a falha no _resolveRoute.

-- Role 'servidor' é o único valor válido no enum app_role para membros regulares
-- (enum real: {super_admin, admin_paroquial, lider, servidor, coordenador})
INSERT INTO public.user_roles (user_id, paroquia_id, role)
SELECT m.auth_user_id, m.paroquia_id, 'servidor'::public.app_role
FROM public.membros m
WHERE m.auth_user_id IS NOT NULL
  AND m.ativo = true
  AND m.tipo_acesso IN ('membro', 'servidor')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id    = m.auth_user_id
      AND ur.paroquia_id = m.paroquia_id
      AND ur.role IN ('servidor', 'lider', 'coordenador', 'admin_paroquial', 'super_admin')
  )
ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
