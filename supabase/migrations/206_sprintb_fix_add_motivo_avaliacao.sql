-- Migration 206 — Sprint B Fix: coluna motivo_avaliacao
--
-- Separa o motivo de rejeição do motivo original do membro.
-- Esta migration precisa ocorrer ANTES da 207 (que substitui avaliar_justificativa).
--
-- motivo           → preenchido pelo membro ao solicitar (imutável após criação)
-- motivo_avaliacao → preenchido pelo avaliador ao rejeitar (nullable)

ALTER TABLE public.participacao_justificativas
  ADD COLUMN IF NOT EXISTS motivo_avaliacao text;
