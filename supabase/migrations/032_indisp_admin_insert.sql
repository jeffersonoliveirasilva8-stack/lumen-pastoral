-- ============================================================
-- Migration 032: Corrige RLS INSERT em indisponibilidades para admins
-- Data: 2026-06-13
--
-- PROBLEMA:
--   PATCH_H (2026-06-09) substituiu a policy FOR ALL "indisponibilidades_paroquia"
--   por 4 policies específicas. A policy de INSERT ficou restrita a:
--
--     membro_id = _portal_membro_id()
--     AND paroquia_id = _portal_membro_paroquia(_portal_membro_id())
--
--   Isso bloqueia o painel admin ao tentar inserir indisponibilidade
--   para um membro diferente do usuário logado:
--     - admin._portal_membro_id() = UUID do próprio admin
--     - membro_id (editId) = UUID do membro alvo
--     - UUID admin ≠ UUID membro → WITH CHECK falha → RLS violation
--
-- CAUSA RAIZ:
--   PATCH_H incluiu exceção admin apenas em UPDATE e DELETE,
--   esquecendo INSERT.
--
-- CORREÇÃO:
--   Recria "indisp_membro_insert" adicionando OR _portal_is_admin(paroquia_id).
--   Admins (super_admin, admin_paroquial, lider) podem inserir indisponibilidades
--   para qualquer membro da própria paróquia.
--
-- INVARIANTE MANTIDO:
--   - Membro comum: só insere para si mesmo
--   - Admin: insere para qualquer membro da paróquia
--   - SELECT, DELETE, UPDATE: sem alteração
--
-- IDEMPOTENTE: sim (DROP IF EXISTS + CREATE)
-- REQUER: migrations 001–031, PATCH_H aplicado
-- ============================================================

-- Recria a policy com exceção para admin
DROP POLICY IF EXISTS "indisp_membro_insert" ON public.indisponibilidades;

CREATE POLICY "indisp_membro_insert" ON public.indisponibilidades
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Membro insere apenas para si mesmo
    (
      membro_id  = public._portal_membro_id()
      AND paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
    )
    -- Admin insere para qualquer membro da paróquia
    OR public._portal_is_admin(paroquia_id)
  );

-- Invalida cache PostgREST
NOTIFY pgrst, 'reload schema';

-- ── Validação ─────────────────────────────────────────────────────────────────
--
-- Após aplicar, confirme que a policy foi criada:
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename = 'indisponibilidades' AND cmd = 'INSERT';
--
-- Esperado: 1 row, policyname = 'indisp_membro_insert'
--
-- Para simular o admin inserindo:
--
--   SELECT public._portal_is_admin('<paroquia_id_uuid>');
--   -- Deve retornar TRUE para o usuário admin logado
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ Admin pode inserir indisponibilidade para qualquer membro da paróquia
--   ✓ Membro comum só insere para si mesmo
--   ✓ SELECT, DELETE, UPDATE não alterados
-- ─────────────────────────────────────────────────────────────────────────────
