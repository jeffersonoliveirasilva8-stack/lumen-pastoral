-- Migration 192 — Sprint B M1
-- Adiciona escala_membros.paramentado e escalas.tem_convocacao_geral
--
-- paramentado: NULL = não registrado; TRUE/FALSE = registrado pelo sacristão
-- tem_convocacao_geral: flag que redireciona qual trigger gera o histórico
--   (quando TRUE em escala solene, o trigger de escala_membros cede espaço
--    ao trigger de escala_convocacoes para evitar duplicidade no histórico)

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS paramentado boolean;

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS tem_convocacao_geral boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.escala_membros.paramentado IS
  'Registrado pelo sacristão em Missas Solenes. NULL = não verificado.';

COMMENT ON COLUMN public.escalas.tem_convocacao_geral IS
  'TRUE quando coord executou convocar_pastoral_solene. '
  'Redireciona geração do histórico para o trigger de escala_convocacoes.';
