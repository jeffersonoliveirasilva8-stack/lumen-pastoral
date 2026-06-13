-- Migration 016: Tabela e RLS para solicitações de cadastro de paróquia
-- Corrige "new row violates row-level security policy" na tela de cadastro público.

CREATE TABLE IF NOT EXISTS public.solicitacoes_paroquia (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_paroquia     TEXT        NOT NULL,
  diocese           TEXT        NOT NULL,
  cidade            TEXT        NOT NULL,
  estado            TEXT        NOT NULL,
  responsavel       TEXT        NOT NULL,
  telefone          TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  mensagem          TEXT,
  status            TEXT        NOT NULL DEFAULT 'pendente'
                                CHECK (status IN ('pendente','em_analise','aprovada','rejeitada')),
  analisado_por     UUID        REFERENCES auth.users(id),
  analisado_em      TIMESTAMPTZ,
  motivo_rejeicao   TEXT,
  paroquia_id       UUID        REFERENCES public.paroquias(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_status ON public.solicitacoes_paroquia(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_email  ON public.solicitacoes_paroquia(email);

-- Impede múltiplas solicitações pendentes do mesmo e-mail
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_email_pendente
  ON public.solicitacoes_paroquia(email)
  WHERE status IN ('pendente', 'em_analise');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_solicitacoes_paroquia_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_solicitacoes_paroquia_updated_at ON public.solicitacoes_paroquia;
CREATE TRIGGER trg_solicitacoes_paroquia_updated_at
  BEFORE UPDATE ON public.solicitacoes_paroquia
  FOR EACH ROW EXECUTE FUNCTION public.set_solicitacoes_paroquia_updated_at();

-- RLS
ALTER TABLE public.solicitacoes_paroquia ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (inclusive anônima) pode enviar solicitação de nova paróquia
DROP POLICY IF EXISTS "public insert solicitacao paroquia" ON public.solicitacoes_paroquia;
CREATE POLICY "public insert solicitacao paroquia"
  ON public.solicitacoes_paroquia
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Somente super_admin gerencia (leitura + atualização + exclusão)
DROP POLICY IF EXISTS "super_admin manage solicitacoes paroquia" ON public.solicitacoes_paroquia;
CREATE POLICY "super_admin manage solicitacoes paroquia"
  ON public.solicitacoes_paroquia
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

GRANT INSERT ON public.solicitacoes_paroquia TO anon;
GRANT INSERT ON public.solicitacoes_paroquia TO authenticated;
GRANT ALL    ON public.solicitacoes_paroquia TO service_role;
