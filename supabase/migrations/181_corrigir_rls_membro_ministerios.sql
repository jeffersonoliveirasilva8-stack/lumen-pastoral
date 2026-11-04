-- ============================================================
-- Migration 181 — Remove policies permissivas antigas de membro_ministerios
--
-- Contexto: a migration 179 criou mm_read_paroquia e mm_write_admin,
-- mas duas policies pré-existentes permaneceram ativas e neutralizam
-- a proteção nova:
--
--   mm_admin_all         — FOR ALL TO authenticated, sem check de _portal_is_admin
--                          → qualquer autenticado podia escrever via OR permissivo
--   mm_read_authenticated — FOR SELECT TO authenticated USING (true)
--                          → qualquer autenticado lia registros de qualquer paróquia
--
-- Após este DROP, o conjunto ativo passa a ser apenas:
--   mm_read_paroquia  — SELECT restrito à paróquia do membro
--   mm_write_admin    — INSERT/UPDATE/DELETE restrito a _portal_is_admin
-- ============================================================

DROP POLICY IF EXISTS "mm_admin_all"          ON public.membro_ministerios;
DROP POLICY IF EXISTS "mm_read_authenticated" ON public.membro_ministerios;
