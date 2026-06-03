-- Adiciona campo sexo à tabela membros
-- Valores permitidos: 'M' (masculino), 'F' (feminino), NULL (não informado)
-- Executar no Supabase Dashboard → SQL Editor

ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS sexo text DEFAULT NULL
  CHECK (sexo IN ('M', 'F'));

COMMENT ON COLUMN membros.sexo IS 'Sexo do membro: M = masculino, F = feminino, NULL = não informado';
