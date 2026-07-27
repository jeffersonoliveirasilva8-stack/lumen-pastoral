-- Migration 126 — Corrige missa_padrao_funcoes_excecao: sem data
--
-- A migration 125 criou a tabela com coluna "data" (data pontual),
-- mas o requisito correto é: função extra permanente para aquela missa
-- padrão (toda ocorrência daquele dia da semana), sem filtro de data.
-- Renomeia a tabela para missa_padrao_funcoes_extras e remove "data".

DROP TABLE IF EXISTS public.missa_padrao_funcoes_excecao;

CREATE TABLE IF NOT EXISTS public.missa_padrao_funcoes_extras (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  missa_padrao_id UUID        NOT NULL REFERENCES public.missas_padrao(id) ON DELETE CASCADE,
  ministerio_id   UUID        NOT NULL REFERENCES public.ministerios(id)   ON DELETE CASCADE,
  quantidade      INT         NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (missa_padrao_id, ministerio_id)
);

CREATE INDEX IF NOT EXISTS idx_mpfe_missa ON public.missa_padrao_funcoes_extras (missa_padrao_id);

ALTER TABLE public.missa_padrao_funcoes_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mpfe_read" ON public.missa_padrao_funcoes_extras
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missas_padrao mp
      JOIN public.user_roles ur ON ur.paroquia_id = mp.paroquia_id
      WHERE mp.id = missa_padrao_id AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "mpfe_write" ON public.missa_padrao_funcoes_extras
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.missas_padrao mp
      JOIN public.user_roles ur ON ur.paroquia_id = mp.paroquia_id
      WHERE mp.id = missa_padrao_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
    )
  );

NOTIFY pgrst, 'reload schema';
