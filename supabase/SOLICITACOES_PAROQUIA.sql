-- ============================================================
-- SOLICITAÇÕES DE CADASTRO DE PARÓQUIAS — FLUXO DE APROVAÇÃO
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── Tabela principal ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solicitacoes_paroquia (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_paroquia     text        NOT NULL,
  diocese           text        NOT NULL,
  cidade            text        NOT NULL,
  estado            text        NOT NULL,
  responsavel       text        NOT NULL,
  telefone          text        NOT NULL,
  email             text        NOT NULL,
  mensagem          text,
  status            text        NOT NULL DEFAULT 'pendente'
                                CHECK (status IN ('pendente','em_analise','aprovada','rejeitada')),
  analisado_por     uuid        REFERENCES auth.users(id),
  analisado_em      timestamptz,
  motivo_rejeicao   text,
  -- Preenchido na aprovação
  paroquia_id       uuid        REFERENCES public.paroquias(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_status ON public.solicitacoes_paroquia(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_email  ON public.solicitacoes_paroquia(email);

-- Trigger: atualiza updated_at
CREATE OR REPLACE FUNCTION public.set_solicitacoes_paroquia_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_solicitacoes_paroquia_updated_at ON public.solicitacoes_paroquia;
CREATE TRIGGER trg_solicitacoes_paroquia_updated_at
  BEFORE UPDATE ON public.solicitacoes_paroquia
  FOR EACH ROW EXECUTE FUNCTION public.set_solicitacoes_paroquia_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.solicitacoes_paroquia ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa autenticada (ou anônima via service_role) pode INSERIR
DROP POLICY IF EXISTS "public insert solicitacao paroquia" ON public.solicitacoes_paroquia;
CREATE POLICY "public insert solicitacao paroquia"
  ON public.solicitacoes_paroquia FOR INSERT
  WITH CHECK (true);

-- Somente super_admin lê e atualiza
DROP POLICY IF EXISTS "super_admin manage solicitacoes paroquia" ON public.solicitacoes_paroquia;
CREATE POLICY "super_admin manage solicitacoes paroquia"
  ON public.solicitacoes_paroquia FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

GRANT INSERT ON public.solicitacoes_paroquia TO anon;
GRANT INSERT ON public.solicitacoes_paroquia TO authenticated;
GRANT ALL    ON public.solicitacoes_paroquia TO service_role;

-- ── Índice de verificação de duplicatas ──────────────────────────────
-- Impede múltiplas solicitações pendentes do mesmo e-mail
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_email_pendente
  ON public.solicitacoes_paroquia(email)
  WHERE status IN ('pendente', 'em_analise');
