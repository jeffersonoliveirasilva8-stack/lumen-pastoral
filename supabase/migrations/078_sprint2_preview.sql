-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 078 — Sprint 2: campos de auditoria do motor e publicação
-- Sem novas tabelas. Sem soft-delete (geracao/ativo adiados para Sprint 4+).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── escala_membros: rastreamento de origem e score do motor ──────────────────

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'motor'
    CHECK (origem IN ('motor', 'manual', 'importado')),
  ADD COLUMN IF NOT EXISTS score_motor SMALLINT,
  ADD COLUMN IF NOT EXISTS substituido_de UUID REFERENCES public.membros(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS justificativa_motor JSONB;

COMMENT ON COLUMN public.escala_membros.origem IS
  'Quem fez a alocação: motor (engine), manual (coordenador), importado (externo)';
COMMENT ON COLUMN public.escala_membros.score_motor IS
  'Score calculado pelo motor V3 para este membro nesta função no momento da geração';
COMMENT ON COLUMN public.escala_membros.substituido_de IS
  'membro_id que o motor havia sugerido antes da troca manual do coordenador';
COMMENT ON COLUMN public.escala_membros.justificativa_motor IS
  'Schema v3: { v, modo, score, participacoes_30d, dias_sem_servir, pool, forcado }';

-- ── escalas: rastreamento de geração e publicação ───────────────────────────

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS motor_gerado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.escalas.motor_gerado_em IS
  'Timestamp da última geração de sugestões pelo motor para esta escala';
COMMENT ON COLUMN public.escalas.published_at IS
  'Timestamp exato da publicação da escala';
COMMENT ON COLUMN public.escalas.published_by IS
  'Usuário (auth.uid) que publicou a escala';

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Histórico de motor por escala (novo campo origem)
CREATE INDEX IF NOT EXISTS idx_escala_membros_origem
  ON public.escala_membros (escala_id, origem);

-- Já existe: idx_escala_membros_escala_id ON escala_membros(escala_id) [036]

-- assignmentHistory faz range scan por paroquia_id + data — crítico ao crescer
CREATE INDEX IF NOT EXISTS idx_escalas_paroquia_data
  ON public.escalas (paroquia_id, data);
