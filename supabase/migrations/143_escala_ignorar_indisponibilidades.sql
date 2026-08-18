-- Migration 143: ignorar_indisponibilidades na tabela escalas
--
-- Quando true, o motor ignora indisponibilidades de data específica ao gerar a escala.
-- Restrições por dia-da-semana (restricoes_dia_semana) foram removidas como bloqueio rígido
-- e são tratadas apenas como informativas.

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS ignorar_indisponibilidades BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.escalas.ignorar_indisponibilidades IS
  'Quando true, o motor não bloqueia membros por indisponibilidade de data específica ao gerar a escala.';
