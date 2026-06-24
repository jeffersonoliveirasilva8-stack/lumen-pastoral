-- Migration 094 — Adicionar atuacoes_exigidas em escala_funcoes
--
-- Problema: o motor de escalas suporta filtrar candidatos por atuação exigida
-- (biblioteca/escala-engine.ts linha 599), mas a coluna nunca existiu no banco.
-- O campo chegava sempre como undefined → regra nunca aplicada.
--
-- atuacoes_exigidas: array de UUIDs de membro_atuacoes que o candidato deve possuir
-- para ser elegível nesta função. NULL = sem restrição (comportamento padrão anterior).
--
-- IDEMPOTENTE: sim (ADD COLUMN IF NOT EXISTS)

ALTER TABLE public.escala_funcoes
  ADD COLUMN IF NOT EXISTS atuacoes_exigidas UUID[] DEFAULT NULL;

COMMENT ON COLUMN public.escala_funcoes.atuacoes_exigidas
  IS 'UUIDs de atuações que o membro deve ter para servir nesta função. NULL = sem restrição.';

NOTIFY pgrst, 'reload schema';
