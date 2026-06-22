-- migration 080 — Vincular formacoes_materiais a eventos específicos
--
-- Adiciona evento_id opcional em formacoes_materiais, permitindo:
--   evento_id = NULL  → material global da paróquia (comportamento atual)
--   evento_id = UUID  → material/ata do encontro específico
--
-- IDEMPOTENTE: sim (IF NOT EXISTS / IF EXISTS)

-- ══════════════════════════════════════════════════════════════
-- 1. Coluna evento_id
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.formacoes_materiais
  ADD COLUMN IF NOT EXISTS evento_id UUID
  REFERENCES public.formacoes_eventos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_formacoes_materiais_evento_id
  ON public.formacoes_materiais(evento_id)
  WHERE evento_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 2. RLS — membros podem ler materiais publicados do evento
--    (herdado da política existente de leitura de membro)
--    Adiciona policy específica para leitura via evento_id
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "materiais_evento_membro_leitura" ON public.formacoes_materiais;
CREATE POLICY "materiais_evento_membro_leitura" ON public.formacoes_materiais
  FOR SELECT TO authenticated
  USING (
    publicado = true
    AND paroquia_id = COALESCE(
      public.current_paroquia_id(),
      public._portal_membro_paroquia(public._portal_membro_id())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- 3. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
