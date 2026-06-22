-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 085 — Membros incompatíveis nas escalas
--
-- Pares de membros que não podem ser escalados juntos na mesma missa.
-- CHECK constraint garante que membro_a_id < membro_b_id para evitar
-- duplicatas inversas (A,B) e (B,A).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.membro_incompatibilidades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  membro_a_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
  membro_b_id UUID NOT NULL REFERENCES public.membros(id) ON DELETE CASCADE,
  motivo      TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT membro_a_menor CHECK (membro_a_id < membro_b_id),
  UNIQUE (membro_a_id, membro_b_id)
);

CREATE INDEX ON public.membro_incompatibilidades (paroquia_id, membro_a_id);
CREATE INDEX ON public.membro_incompatibilidades (paroquia_id, membro_b_id);

ALTER TABLE public.membro_incompatibilidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lider_coordenador_rw" ON public.membro_incompatibilidades
  FOR ALL USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('lider', 'coordenador', 'admin')
    )
  );
