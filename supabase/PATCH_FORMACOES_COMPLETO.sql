-- ============================================================
-- PATCH: Formações e Eventos — Colunas extras + tipos corrigidos
-- Execute no SQL Editor do Supabase.
-- Idempotente — seguro executar múltiplas vezes.
-- ============================================================

-- 1. Adicionar colunas extras em formacoes_eventos
ALTER TABLE formacoes_eventos
  ADD COLUMN IF NOT EXISTS observacoes        TEXT,
  ADD COLUMN IF NOT EXISTS responsaveis_nomes TEXT,
  ADD COLUMN IF NOT EXISTS comunidade         TEXT,
  ADD COLUMN IF NOT EXISTS publico_alvo       TEXT NOT NULL DEFAULT 'todos';

-- 2. Corrigir CHECK constraint do campo tipo para incluir encontro e compromisso
ALTER TABLE formacoes_eventos DROP CONSTRAINT IF EXISTS formacoes_eventos_tipo_check;
ALTER TABLE formacoes_eventos
  ADD CONSTRAINT formacoes_eventos_tipo_check
  CHECK (tipo IN (
    'formacao','reuniao','retiro','evento','ensaio',
    'encontro','compromisso','adoracao','outro'
  ));

-- 3. Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'formacoes_eventos'
ORDER BY ordinal_position;
