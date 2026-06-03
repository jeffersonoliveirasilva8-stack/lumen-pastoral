-- ============================================================
-- PATCH_MISSA_RESTRICOES.sql
-- Cria tabela membro_missa_restricoes
-- Relaciona membros às missas padrão que NÃO conseguem servir
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── Tabela principal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membro_missa_restricoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id       UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  missa_padrao_id UUID NOT NULL REFERENCES missas_padrao(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membro_id, missa_padrao_id)
);

CREATE INDEX IF NOT EXISTS membro_missa_restricoes_membro_idx
  ON membro_missa_restricoes (membro_id);

CREATE INDEX IF NOT EXISTS membro_missa_restricoes_missa_idx
  ON membro_missa_restricoes (missa_padrao_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE membro_missa_restricoes ENABLE ROW LEVEL SECURITY;

-- Membros autenticados da paróquia podem ler/escrever suas próprias restrições
CREATE POLICY "membro_missa_restricoes: paroquia members"
  ON membro_missa_restricoes FOR ALL
  USING (
    membro_id IN (
      SELECT id FROM membros WHERE paroquia_id = current_paroquia_id()
    )
  );

-- ── Validação ─────────────────────────────────────────────────────────────────
SELECT 'OK — tabela membro_missa_restricoes criada' AS status
FROM information_schema.tables
WHERE table_name = 'membro_missa_restricoes';
1