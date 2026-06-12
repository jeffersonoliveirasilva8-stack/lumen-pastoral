-- ============================================================
-- 011_fix_access_flow.sql
-- Corrige fluxo de acesso de membros: RLS e auto-link
-- Data: 2026-06-12
--
-- PROBLEMAS CORRIGIDOS:
--   ERRO 1 — INSERT em solicitacoes_membros bloqueado para anon
--             ("new row violates row-level security policy")
--             Causa: sem policy INSERT para o papel anon.
--
--   ERRO 2 — Membro aprovado redirecionado para a página de login
--             após clicar no convite de ativação.
--             Causa: ausência de policy "membro_read_own" em membros
--             faz getPostLoginRoute() não conseguir ler conta_ativada
--             e retornar /membro/login em vez de /membro/ativar-conta.
--
-- IDEMPOTENTE: sim (DROP IF EXISTS antes de cada CREATE).
-- ORDEM DE APLICAÇÃO: após migration 010_helper_functions.sql
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. solicitacoes_membros — INSERT público (formulário anônimo)
-- ════════════════════════════════════════════════════════════════
-- O formulário de inscrição (inscricao.$slug.tsx) usa o cliente
-- Supabase sem autenticação (papel anon). Sem esta policy + GRANT,
-- o INSERT falha com "new row violates row-level security policy".

ALTER TABLE IF EXISTS public.solicitacoes_membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solicitacoes_public_insert" ON public.solicitacoes_membros;
CREATE POLICY "solicitacoes_public_insert" ON public.solicitacoes_membros
  FOR INSERT
  WITH CHECK (true);

-- GRANT separado: policies RLS não concedem DML por si só.
GRANT INSERT ON public.solicitacoes_membros TO anon;

-- ════════════════════════════════════════════════════════════════
-- 2. membros — leitura do próprio registro (portal do membro)
-- ════════════════════════════════════════════════════════════════
-- Consolida versões anteriores em conflito:
--   "member_portal_select_own"    (PATCH_MEMBRO_PORTAL_V2, PATCH_PORTAL_AUTH)
--   "membros_self_read_by_email"  (PATCH_O)
-- Em uma única policy que cobre ambos os casos:
--   a) auth_user_id já vinculado  — acesso pós-ativação normal
--   b) auth_user_id ainda NULL    — fallback por email, primeiro acesso
--
-- Necessário para getPostLoginRoute() ler conta_ativada após
-- portal_auto_link_by_email() vincular o auth_user_id.

DROP POLICY IF EXISTS "membro_read_own"             ON public.membros;
DROP POLICY IF EXISTS "member_portal_select_own"    ON public.membros;
DROP POLICY IF EXISTS "membros_self_read_by_email"  ON public.membros;

CREATE POLICY "membro_read_own" ON public.membros
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
  );

-- ════════════════════════════════════════════════════════════════
-- 3. membros — UPDATE para vincular auth_user_id (auto-link)
-- ════════════════════════════════════════════════════════════════
-- Permite ao hook use-membro-auth.ts e ao RPC portal_auto_link_by_email
-- gravar auth_user_id no registro do membro no primeiro acesso.

DROP POLICY IF EXISTS "membro_self_link" ON public.membros;
CREATE POLICY "membro_self_link" ON public.membros
  FOR UPDATE TO authenticated
  USING (
    LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
  )
  WITH CHECK (
    auth_user_id = auth.uid() OR auth_user_id IS NULL
  );

-- ════════════════════════════════════════════════════════════════
-- 4. portal_auto_link_by_email() — garante existência do RPC
-- ════════════════════════════════════════════════════════════════
-- SECURITY DEFINER: lê membros ignorando RLS, mesmo antes de
-- auth_user_id estar preenchido.
-- Cria profiles row e user_role 'membro' na primeira ativação.

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

  -- Garante role de membro
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'membro')
  ON CONFLICT (user_id, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success',    true,
    'membro_id',  v_membro_id,
    'nome',       v_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_auto_link_by_email() TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. Invalida cache do PostgREST
-- ════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO PÓS-APLICAÇÃO:
--
-- SELECT tablename, policyname
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('solicitacoes_membros', 'membros')
-- ORDER BY tablename, policyname;
--
-- Resultado esperado em "membros":
--   membros_paroquia         (migration 001 — admin)
--   membro_read_own          (esta migration — portal membro)
--   membro_self_link         (esta migration — auto-link)
--
-- Resultado esperado em "solicitacoes_membros":
--   solicitacoes_public_insert  (esta migration — formulário público)
--   solicitacoes_coord_select   (SOLICITACOES_MEMBROS.sql — admin)
--   solicitacoes_coord_update   (SOLICITACOES_MEMBROS.sql — admin)
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name = 'portal_auto_link_by_email';
-- → deve retornar 1 linha
-- ════════════════════════════════════════════════════════════════
