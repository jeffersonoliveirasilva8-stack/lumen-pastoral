-- Migration 222 — atuacoes_exigidas em modelos de missa
--
-- Adiciona o campo atuacoes_exigidas a três tabelas de modelos para que a
-- restrição de atuação pastoral seja herdada automaticamente por escala_funcoes
-- ao gerar novas escalas via wizard ou criação manual.
--
-- Tabelas afetadas:
--   missa_padrao_funcoes       → funções do modelo de missa padrão (wizard)
--   missa_padrao_funcoes_extras → funções extras/exceção do modelo (wizard)
--   tipo_missa_funcoes          → funções do tipo de missa (criação manual)
--
-- Compatibilidade retroativa garantida:
--   NULL = sem restrição (comportamento idêntico ao atual).
--   Registros existentes não são alterados.
--   Motor (escala-engine.ts:773) e RPC (migrations 162/221) já verificam
--   NULL/vazio com lógica IS NULL OR cardinality = 0 OR EXISTS(...).

-- ── missa_padrao_funcoes (wizard: funções do modelo) ──────────────────────
ALTER TABLE public.missa_padrao_funcoes
  ADD COLUMN IF NOT EXISTS atuacoes_exigidas uuid[] DEFAULT NULL;

COMMENT ON COLUMN public.missa_padrao_funcoes.atuacoes_exigidas IS
  'UUIDs de atuacoes_pastorais exigidas para servir nesta função.
   NULL ou vazio = sem restrição.
   Propagado para escala_funcoes pelo wizard ao gerar escalas.';

-- ── missa_padrao_funcoes_extras (wizard: funções extras/exceção) ──────────
ALTER TABLE public.missa_padrao_funcoes_extras
  ADD COLUMN IF NOT EXISTS atuacoes_exigidas uuid[] DEFAULT NULL;

COMMENT ON COLUMN public.missa_padrao_funcoes_extras.atuacoes_exigidas IS
  'Mesma semântica de missa_padrao_funcoes.atuacoes_exigidas.
   Aplica-se quando a função extra é adicionada a uma celebração pelo wizard.';

-- ── tipo_missa_funcoes (criação manual de escalas) ────────────────────────
ALTER TABLE public.tipo_missa_funcoes
  ADD COLUMN IF NOT EXISTS atuacoes_exigidas uuid[] DEFAULT NULL;

COMMENT ON COLUMN public.tipo_missa_funcoes.atuacoes_exigidas IS
  'Mesma semântica de missa_padrao_funcoes.atuacoes_exigidas.
   Propagado para escala_funcoes na criação manual de escalas via tipo de missa.';

NOTIFY pgrst, 'reload schema';
