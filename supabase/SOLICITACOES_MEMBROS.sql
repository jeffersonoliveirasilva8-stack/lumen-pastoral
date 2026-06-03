-- ============================================================
-- FLUXO DE CADASTRO COM APROVAÇÃO DA COORDENAÇÃO
-- Executar no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. TABELA principal de solicitações de cadastro
-- ============================================================
CREATE TABLE IF NOT EXISTS solicitacoes_membros (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id      uuid        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,

  -- Campos de superfície para listagem rápida
  nome             text        NOT NULL,
  email            text,
  telefone         text,

  -- Formulário completo serializado
  dados_json       jsonb       NOT NULL DEFAULT '{}',

  -- Foto enviada pelo solicitante (Supabase Storage → bucket membros-fotos)
  foto_url         text,

  -- Workflow de aprovação
  status           text        NOT NULL DEFAULT 'pendente'
                               CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  aprovado_por     uuid        REFERENCES profiles(id),
  aprovado_em      timestamptz,
  motivo_rejeicao  text,

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Índice para buscas frequentes (paróquia + status)
CREATE INDEX IF NOT EXISTS idx_solicitacoes_paroquia_status
  ON solicitacoes_membros (paroquia_id, status);

-- 2. ROW-LEVEL SECURITY
-- ============================================================
ALTER TABLE solicitacoes_membros ENABLE ROW LEVEL SECURITY;

-- Qualquer visitante (anon) pode inserir — formulário público sem login
CREATE POLICY "solicitacoes_public_insert" ON solicitacoes_membros
  FOR INSERT WITH CHECK (true);

-- Apenas usuários autenticados da mesma paróquia podem ler
CREATE POLICY "solicitacoes_coord_select" ON solicitacoes_membros
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM profiles
      WHERE id = auth.uid() AND paroquia_id IS NOT NULL
    )
  );

-- Apenas coordenação da mesma paróquia pode atualizar (aprovar/rejeitar)
CREATE POLICY "solicitacoes_coord_update" ON solicitacoes_membros
  FOR UPDATE TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM profiles
      WHERE id = auth.uid() AND paroquia_id IS NOT NULL
    )
  )
  WITH CHECK (
    paroquia_id IN (
      SELECT paroquia_id FROM profiles
      WHERE id = auth.uid() AND paroquia_id IS NOT NULL
    )
  );

-- 3. LEITURA PÚBLICA DE PARÓQUIAS
-- O formulário de inscrição precisa buscar a paróquia pelo slug sem auth.
-- Adiciona política pública apenas se ainda não existir.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'paroquias' AND policyname = 'paroquias_public_read'
  ) THEN
    CREATE POLICY "paroquias_public_read" ON paroquias
      FOR SELECT USING (true);
  END IF;
END $$;

-- 4. POLÍTICAS RLS DE MEMBROS (necessárias para o login do novo membro)
-- Permite que o membro recém-aprovado encontre seu registro pelo e-mail
-- e vincule o auth_user_id automaticamente no primeiro acesso.
-- ============================================================
DROP POLICY IF EXISTS "membro_self_link" ON membros;
CREATE POLICY "membro_self_link" ON membros FOR UPDATE TO authenticated
  USING (lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
  WITH CHECK (auth_user_id = auth.uid() OR auth_user_id IS NULL);

DROP POLICY IF EXISTS "membro_read_own" ON membros;
CREATE POLICY "membro_read_own" ON membros FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),'')))
  );
