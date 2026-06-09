-- ============================================================
-- LITURGIA SaaS — Melhorias 005
-- Atuações Pastorais · Restrições de Função · Prioridade
-- Execute no SQL Editor: https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ── 1. Prioridade de escalação em membros ────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS prioridade_escala TEXT NOT NULL DEFAULT 'nenhuma';

-- ── 2. Campos extras em ministerios ──────────────────────────
ALTER TABLE ministerios
  ADD COLUMN IF NOT EXISTS exclusiva_solene  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusiva_bispo   BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantidade_padrao SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_adicionar    BOOLEAN  NOT NULL DEFAULT false;

-- ── 3. Tabela: atuacoes_pastorais ─────────────────────────────
CREATE TABLE IF NOT EXISTS atuacoes_pastorais (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome        TEXT        NOT NULL,
  descricao   TEXT,
  cor         TEXT        NOT NULL DEFAULT '#6366f1',
  icone       TEXT,
  ativo       BOOLEAN     NOT NULL DEFAULT true,
  ordem       SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE atuacoes_pastorais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "atuacoes_pastorais_paroquia" ON atuacoes_pastorais
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE INDEX IF NOT EXISTS atuacoes_pastorais_paroquia_idx
  ON atuacoes_pastorais (paroquia_id, ordem);

-- ── 4. Tabela: membro_atuacoes ────────────────────────────────
CREATE TABLE IF NOT EXISTS membro_atuacoes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id  UUID        NOT NULL REFERENCES membros(id)          ON DELETE CASCADE,
  atuacao_id UUID        NOT NULL REFERENCES atuacoes_pastorais(id) ON DELETE CASCADE,
  UNIQUE (membro_id, atuacao_id)
);

ALTER TABLE membro_atuacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membro_atuacoes_paroquia" ON membro_atuacoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  );

-- ── 5. Tabela: membro_funcao_restricoes ───────────────────────
CREATE TABLE IF NOT EXISTS membro_funcao_restricoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id     UUID NOT NULL REFERENCES membros(id)    ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'pode'
                CHECK (tipo IN ('pode', 'nao_pode')),
  UNIQUE (membro_id, ministerio_id, tipo)
);

ALTER TABLE membro_funcao_restricoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membro_funcao_restricoes_paroquia" ON membro_funcao_restricoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  );

-- ── 6. Campos extras em coordenadores ────────────────────────
ALTER TABLE coordenadores
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS atua_como   TEXT,
  ADD COLUMN IF NOT EXISTS comunidade  TEXT;

-- ── 7. Garantir RLS em membro_ministerios (caso policy pública quebre) ─
-- Recria a policy de leitura pública para consistência
DROP POLICY IF EXISTS "membro_ministerios_leitura_publica" ON membro_ministerios;
CREATE POLICY "membro_ministerios_leitura_publica" ON membro_ministerios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM membros m
      JOIN escalas e ON true
      JOIN escala_membros em ON em.membro_id = m.id AND em.escala_id = e.id
      WHERE m.id = membro_id AND e.status = 'publicada'
    )
  );

-- ── Validação ─────────────────────────────────────────────────
SELECT 'TABELAS_NOVAS' AS bloco, table_name AS item
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes')
UNION ALL
SELECT 'COLUNA_MEMBROS', column_name FROM information_schema.columns
WHERE table_name = 'membros' AND column_name = 'prioridade_escala'
UNION ALL
SELECT 'COLUNAS_MINISTERIOS', column_name FROM information_schema.columns
WHERE table_name = 'ministerios'
  AND column_name IN ('exclusiva_solene','exclusiva_bispo','quantidade_padrao','auto_adicionar')
UNION ALL
SELECT 'COLUNAS_COORDENADORES', column_name FROM information_schema.columns
WHERE table_name = 'coordenadores'
  AND column_name IN ('observacoes','atua_como','comunidade')
ORDER BY 1, 2;
