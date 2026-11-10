-- Migration 195 — Sprint B M4
-- Índice de unicidade para convocações gerais em historico_participacoes
--
-- Os índices existentes cobrem:
--   uniq_hist_escala  → tipo_evento IN ('escala','solene','bispo') com ministerio_id NOT NULL
--   uniq_hist_evento  → referencia_id NOT NULL (agenda pastoral)
--
-- Registros de convocacao_solene têm ministerio_id = NULL e não caem em nenhum
-- dos dois índices acima. Este índice garante um único registro por
-- (membro_id, escala_id) quando tipo_evento = 'convocacao_solene'.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_hist_convocacao
  ON public.historico_participacoes(membro_id, escala_id)
  WHERE tipo_evento = 'convocacao_solene'
    AND escala_id IS NOT NULL;
