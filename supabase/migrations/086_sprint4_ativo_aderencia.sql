-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 086 — Sprint 4: campo ativo em escala_membros + aderencia_motor
--
-- ativo: soft-delete de uma linha de escala_membros sem perder histórico.
--   false = membro removido da escala mas registro preservado para auditoria.
--
-- aderencia_motor: % de membros que ficaram conforme a sugestão original
--   do motor (origem='motor' e não foram trocados). Calculado ao publicar.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.escala_membros
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS aderencia_motor NUMERIC(5,2);

-- Índice para queries que filtram apenas linhas ativas
CREATE INDEX IF NOT EXISTS idx_escala_membros_ativo
  ON public.escala_membros (escala_id, ativo)
  WHERE ativo = true;
