-- ============================================================
-- PATCH_RESTRICOES_DIA_SEMANA.sql
-- Adiciona coluna restricoes_dia_semana em membros
-- Valores: array de inteiros 0–6 (0=Dom, 1=Seg, ..., 6=Sáb)
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS restricoes_dia_semana SMALLINT[] NOT NULL DEFAULT '{}';

-- Validação
SELECT 'OK — coluna restricoes_dia_semana adicionada em membros' AS status
FROM information_schema.columns
WHERE table_name = 'membros' AND column_name = 'restricoes_dia_semana';
