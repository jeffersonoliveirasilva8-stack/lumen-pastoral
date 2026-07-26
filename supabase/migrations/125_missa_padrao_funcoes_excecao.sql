-- Migration 125 — Funções específicas por data em missa padrão
--
-- Permite adicionar ministérios extras (com quantidade) para datas
-- pontuais numa missa padrão, além das funções do tipo_missa vinculado.

CREATE TABLE IF NOT EXISTS public.missa_padrao_funcoes_excecao (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  missa_padrao_id UUID        NOT NULL REFERENCES public.missas_padrao(id)  ON DELETE CASCADE,
  ministerio_id   UUID        NOT NULL REFERENCES public.ministerios(id)    ON DELETE CASCADE,
  quantidade      INT         NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  data            DATE        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mpfe_missa ON public.missa_padrao_funcoes_excecao (missa_padrao_id);
CREATE INDEX IF NOT EXISTS idx_mpfe_data  ON public.missa_padrao_funcoes_excecao (data);

-- RLS: mesma lógica das demais tabelas de configuração — leitura e escrita para admin/coord da paróquia
ALTER TABLE public.missa_padrao_funcoes_excecao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mpfe_read" ON public.missa_padrao_funcoes_excecao
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.missas_padrao mp
      JOIN public.user_roles ur ON ur.paroquia_id = mp.paroquia_id
      WHERE mp.id = missa_padrao_id AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "mpfe_write" ON public.missa_padrao_funcoes_excecao
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
