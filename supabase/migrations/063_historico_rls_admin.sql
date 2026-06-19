-- ============================================================
-- Migration 063: RLS leitura de historico_participacoes para admin/coord
-- Data: 2026-06-18
--
-- PROBLEMA:
--   A policy "historico_paroquia" usa current_paroquia_id() que lê de
--   profiles.paroquia_id. Admins/coordenadores ativados via fluxo de
--   membro podem não ter profiles.paroquia_id preenchido, fazendo a
--   policy retornar NULL e bloquear toda leitura de historico no painel.
--
-- SOLUÇÃO:
--   Adicionar policy SELECT que usa _portal_is_admin(paroquia_id) —
--   verifica user_roles, que é a fonte de verdade de permissões no sistema.
--   Cobre também coordenadores via _portal_is_coord(_portal_membro_id()).
-- ============================================================

DROP POLICY IF EXISTS "historico_admin_read" ON public.historico_participacoes;

CREATE POLICY "historico_admin_read"
  ON public.historico_participacoes
  FOR SELECT
  USING (
    public._portal_is_admin(paroquia_id)
    OR public._portal_is_coord(public._portal_membro_id())
  );

NOTIFY pgrst, 'reload schema';
