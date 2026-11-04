-- ============================================================
-- Migration 179 — RLS membro_ministerios por papel
--
-- Substitui a policy única "membro_ministerios_paroquia" (que não
-- distinguia leitura de escrita) por duas policies separadas:
--
--   mm_read_paroquia  — SELECT para qualquer autenticado da paróquia
--   mm_write_admin    — INSERT/UPDATE/DELETE apenas para admins/lideres
--
-- Coordenadores ficam bloqueados de escrita a nível de banco.
-- Leitores comuns não podem modificar vínculos.
-- ============================================================

DROP POLICY IF EXISTS "membro_ministerios_paroquia" ON public.membro_ministerios;
DROP POLICY IF EXISTS "mm_read_paroquia"             ON public.membro_ministerios;
DROP POLICY IF EXISTS "mm_write_admin"               ON public.membro_ministerios;

CREATE POLICY "mm_read_paroquia" ON public.membro_ministerios
  FOR SELECT TO authenticated
  USING (
    _portal_membro_paroquia(membro_id) = current_paroquia_id()
  );

CREATE POLICY "mm_write_admin" ON public.membro_ministerios
  FOR ALL TO authenticated
  USING (
    _portal_is_admin(current_paroquia_id())
    AND _portal_membro_paroquia(membro_id) = current_paroquia_id()
  )
  WITH CHECK (
    _portal_is_admin(current_paroquia_id())
    AND _portal_membro_paroquia(membro_id) = current_paroquia_id()
  );
