-- ============================================================
-- Migration 062: RLS leitura própria em historico_participacoes
-- Data: 2026-06-18
--
-- PROBLEMA:
--   A única policy em historico_participacoes usa current_paroquia_id()
--   que lê de profiles.paroquia_id. Membros do portal não têm registro
--   em profiles, então a função retorna NULL e a policy bloqueia
--   toda leitura → histórico de pontuação aparece vazio para membros.
--
-- SOLUÇÃO:
--   Adicionar policy SELECT que permite ao membro autenticado ler
--   apenas os seus próprios registros (membro_id = _portal_membro_id()).
--   A policy existente "historico_paroquia" cobre admins/coordenadores
--   via profiles → mantida intacta.
-- ============================================================

-- Policy de leitura própria para membros do portal
DROP POLICY IF EXISTS "historico_membro_read_own" ON public.historico_participacoes;

CREATE POLICY "historico_membro_read_own"
  ON public.historico_participacoes
  FOR SELECT
  USING (membro_id = public._portal_membro_id());

-- Invalida cache PostgREST
NOTIFY pgrst, 'reload schema';
