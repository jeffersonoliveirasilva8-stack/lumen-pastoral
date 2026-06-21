-- ═══════════════════════════════════════════════════════════════════════════════
-- 077 — Motor V3: novos campos em ministerios, escalas e membro_ministerios
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── ministerios ──────────────────────────────────────────────────────────────

ALTER TABLE public.ministerios
  ADD COLUMN IF NOT EXISTS relevancia TEXT NOT NULL DEFAULT 'normal'
    CHECK (relevancia IN ('normal', 'principal')),
  ADD COLUMN IF NOT EXISTS duplicidade_permitida BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordem_prioridade INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ministerios.relevancia IS
  'normal = equilíbrio primeiro; principal = experiência/rodízio em solenidades';
COMMENT ON COLUMN public.ministerios.duplicidade_permitida IS
  'quando true, membro já alocado pode assumir esta função como fallback de último recurso';
COMMENT ON COLUMN public.ministerios.ordem_prioridade IS
  'menor número = processado antes pelo motor (funções mais importantes primeiro)';

-- ── escalas ──────────────────────────────────────────────────────────────────

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS paramentacao_obrigatoria BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.escalas.paramentacao_obrigatoria IS
  'indica celebração com paramentação completa (influencia seleção de funções acessórias)';

-- ── membro_ministerios ───────────────────────────────────────────────────────

-- Substitui a Regra Jefferson (forcar_escalacao_solene) por um vínculo
-- configurável por coordenador, sem hardcode de nomes de função.
ALTER TABLE public.membro_ministerios
  ADD COLUMN IF NOT EXISTS preferencial_solene BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.membro_ministerios.preferencial_solene IS
  'em solenidades, este membro recebe bônus de prioridade para esta função (não é obrigatório)';

-- Migração de compatibilidade: membros com forcar_escalacao_solene=true
-- recebem preferencial_solene=true em TODOS os ministérios que exercem.
-- O coordenador pode ajustar depois.
UPDATE public.membro_ministerios mm
SET preferencial_solene = true
WHERE EXISTS (
  SELECT 1 FROM public.membros m
  WHERE m.id = mm.membro_id
    AND m.forcar_escalacao_solene = true
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

-- As políticas existentes em ministerios, escalas e membro_ministerios
-- já cobrem as novas colunas (RLS é por linha, não por coluna).

-- ── Índice útil para a query do motor ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_membro_ministerios_preferencial
  ON public.membro_ministerios (ministerio_id, membro_id)
  WHERE preferencial_solene = true;
