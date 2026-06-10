-- ============================================================
-- LUMEN PASTORAL — PATCH H (2026-06-09)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- Idempotente.
--
-- Problema: policy "indisponibilidades_rls" usa FOR ALL com
--   paroquia_id = current_paroquia_id(). Isso permite que qualquer
--   membro autenticado veja e delete indisponibilidades de outros
--   membros da mesma paróquia (RLS não isola por membro).
--
-- Fix: substitui a policy única por 4 policies específicas:
--   SELECT → membro vê apenas as suas; admin vê todas da paróquia
--   INSERT → membro insere apenas para si mesmo
--   UPDATE → bloqueado para membros (admin pode via service_role)
--   DELETE → membro deleta apenas as suas; admin deleta qualquer uma
-- ============================================================

-- Remove a policy antiga permissiva
DROP POLICY IF EXISTS "indisponibilidades_rls"      ON public.indisponibilidades;
DROP POLICY IF EXISTS "indisponibilidades_paroquia" ON public.indisponibilidades;

-- Membro lê apenas as próprias indisponibilidades futuras
-- Admin vê todas da paróquia
CREATE POLICY "indisp_membro_read" ON public.indisponibilidades
  FOR SELECT TO authenticated
  USING (
    membro_id = public._portal_membro_id()
    OR public._portal_is_admin(paroquia_id)
    OR public._portal_is_coord(public._portal_membro_id())
  );

-- Membro só pode inserir para si mesmo na própria paróquia
CREATE POLICY "indisp_membro_insert" ON public.indisponibilidades
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = public._portal_membro_id()
    AND paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
  );

-- Membro deleta apenas as próprias; admin deleta qualquer uma da paróquia
CREATE POLICY "indisp_membro_delete" ON public.indisponibilidades
  FOR DELETE TO authenticated
  USING (
    membro_id = public._portal_membro_id()
    OR public._portal_is_admin(paroquia_id)
  );

-- Admin pode atualizar (motivo, data) via painel
CREATE POLICY "indisp_admin_update" ON public.indisponibilidades
  FOR UPDATE TO authenticated
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

NOTIFY pgrst, 'reload schema';

-- ── Validação ─────────────────────────────────────────────────
SELECT
  'PATCH H aplicado' AS status,
  count(*) AS policies_indisp
FROM pg_policies
WHERE tablename = 'indisponibilidades';
-- Esperado: policies_indisp = 4
