-- Migration 059: Tabela de materiais formativos e pautas de reunião
-- Substitui o placeholder da aba "Formações" por conteúdo real

CREATE TABLE IF NOT EXISTS formacoes_materiais (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  uuid        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo       text        NOT NULL,
  tipo         text        NOT NULL DEFAULT 'documento',
  -- tipo: 'pauta' | 'documento' | 'video' | 'artigo' | 'link'
  descricao    text,
  url          text,           -- para documento, video, link
  conteudo     text,           -- para artigo (texto livre) ou pauta (markdown simples)
  itens        jsonb,          -- para pauta: [{ texto: text, concluido: bool }]
  data_reuniao date,           -- obrigatório quando tipo = 'pauta'
  publicado    boolean     NOT NULL DEFAULT false,
  ordem        integer     NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS formacoes_materiais_paroquia_idx ON formacoes_materiais(paroquia_id);
CREATE INDEX IF NOT EXISTS formacoes_materiais_tipo_idx     ON formacoes_materiais(paroquia_id, tipo);
CREATE INDEX IF NOT EXISTS formacoes_materiais_pub_idx      ON formacoes_materiais(paroquia_id, publicado);

-- updated_at automático
CREATE OR REPLACE FUNCTION _update_formacoes_materiais_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_formacoes_materiais_updated_at ON formacoes_materiais;
CREATE TRIGGER trg_formacoes_materiais_updated_at
  BEFORE UPDATE ON formacoes_materiais
  FOR EACH ROW EXECUTE FUNCTION _update_formacoes_materiais_updated_at();

-- RLS
ALTER TABLE formacoes_materiais ENABLE ROW LEVEL SECURITY;

-- Admins/coordenadores da paróquia: leitura total
CREATE POLICY "formacoes_materiais_admin_read" ON formacoes_materiais
  FOR SELECT USING (
    paroquia_id IN (
      SELECT paroquia_id FROM profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial','super_admin','coordenador')
    )
  );

-- Admins/coordenadores: escrita
CREATE POLICY "formacoes_materiais_admin_write" ON formacoes_materiais
  FOR ALL USING (
    paroquia_id IN (
      SELECT paroquia_id FROM profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial','super_admin','coordenador')
    )
  );

-- Membros comuns: só veem o que está publicado
CREATE POLICY "formacoes_materiais_membro_read" ON formacoes_materiais
  FOR SELECT USING (
    publicado = true
    AND paroquia_id IN (
      SELECT paroquia_id FROM profiles WHERE id = auth.uid()
    )
  );
