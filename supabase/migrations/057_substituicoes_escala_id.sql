-- migration 057 — Adiciona coluna escala_id em substituicoes
-- As RPCs em 051 e 053 inserem escala_id mas a coluna não existia na tabela

ALTER TABLE public.substituicoes
  ADD COLUMN IF NOT EXISTS escala_id UUID REFERENCES public.escalas(id) ON DELETE CASCADE;

-- Preenche escala_id a partir de escala_membros para registros existentes
UPDATE public.substituicoes s
SET escala_id = em.escala_id
FROM public.escala_membros em
WHERE em.id = s.escala_membro_id
  AND s.escala_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_substituicoes_escala
  ON public.substituicoes (escala_id);

-- Recalcula scores de todos os membros (garante consistência após migration 053)
UPDATE public.membros m
SET score = COALESCE((
  SELECT SUM(hp.pontos)
  FROM public.historico_participacoes hp
  WHERE hp.membro_id = m.id
), 0);
