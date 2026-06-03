-- ============================================================
-- LITURGIA SaaS — NOVOS RECURSOS: Tipos de Missa + Recorrência + Portal
-- Execute INTEIRO no SQL Editor:
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- Idempotente — seguro executar múltiplas vezes.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOCO 1 — Tipos de Missa
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tipos_missa (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id          UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome                 TEXT        NOT NULL,
  descricao            TEXT,
  cor                  TEXT        NOT NULL DEFAULT '#6366f1',
  icone                TEXT,
  usa_turibulo         BOOLEAN     NOT NULL DEFAULT false,
  usa_naveta           BOOLEAN     NOT NULL DEFAULT false,
  usa_baculifero       BOOLEAN     NOT NULL DEFAULT false,
  usa_mitrifero        BOOLEAN     NOT NULL DEFAULT false,
  prioridade_liturgica SMALLINT    NOT NULL DEFAULT 1,
  ativo                BOOLEAN     NOT NULL DEFAULT true,
  ordem                SMALLINT    NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tipos_missa_paroquia_idx ON tipos_missa (paroquia_id, ordem);

-- Funções definidas por tipo de missa
CREATE TABLE IF NOT EXISTS tipo_missa_funcoes (
  id             UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_missa_id  UUID     NOT NULL REFERENCES tipos_missa(id)   ON DELETE CASCADE,
  ministerio_id  UUID     NOT NULL REFERENCES ministerios(id)   ON DELETE CASCADE,
  tipo_vinculo   TEXT     NOT NULL DEFAULT 'obrigatoria'
                          CHECK (tipo_vinculo IN ('obrigatoria', 'opcional')),
  quantidade_min SMALLINT NOT NULL DEFAULT 1,
  quantidade_max SMALLINT NOT NULL DEFAULT 1,
  UNIQUE(tipo_missa_id, ministerio_id)
);

-- ════════════════════════════════════════════════════════════
-- BLOCO 2 — Colunas novas em tabelas existentes
-- ════════════════════════════════════════════════════════════

-- missas_padrao: FK para tipo e recorrência
ALTER TABLE missas_padrao
  ADD COLUMN IF NOT EXISTS tipo_missa_id UUID REFERENCES tipos_missa(id),
  ADD COLUMN IF NOT EXISTS recorrencia   JSONB NOT NULL DEFAULT '{"tipo":"semanal"}'::jsonb;

-- escalas: FK para tipo
ALTER TABLE escalas
  ADD COLUMN IF NOT EXISTS tipo_missa_id UUID REFERENCES tipos_missa(id);

-- paroquias: token para portal público dos membros
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS token_portal  UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS diocese       TEXT,
  ADD COLUMN IF NOT EXISTS endereco      TEXT,
  ADD COLUMN IF NOT EXISTS contato_email TEXT,
  ADD COLUMN IF NOT EXISTS contato_telefone TEXT;

-- Garantir unique no token_portal e preencher nulos
CREATE UNIQUE INDEX IF NOT EXISTS paroquias_token_portal_idx ON paroquias (token_portal);
UPDATE paroquias SET token_portal = gen_random_uuid() WHERE token_portal IS NULL;

-- ════════════════════════════════════════════════════════════
-- BLOCO 3 — RLS para novas tabelas
-- ════════════════════════════════════════════════════════════

ALTER TABLE tipos_missa       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo_missa_funcoes ENABLE ROW LEVEL SECURITY;

-- tipos_missa: acesso autenticado (mesma paróquia)
DROP POLICY IF EXISTS "tipos_missa_paroquia" ON tipos_missa;
CREATE POLICY "tipos_missa_paroquia" ON tipos_missa FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- tipos_missa: leitura pública para portal e escalas
DROP POLICY IF EXISTS "tipos_missa_publica" ON tipos_missa;
CREATE POLICY "tipos_missa_publica" ON tipos_missa
  FOR SELECT USING (auth.uid() IS NULL AND ativo = true);

-- tipo_missa_funcoes: via tipo_missa da paróquia
DROP POLICY IF EXISTS "tipo_missa_funcoes_paroquia" ON tipo_missa_funcoes;
CREATE POLICY "tipo_missa_funcoes_paroquia" ON tipo_missa_funcoes FOR ALL
  USING (
    tipo_missa_id IN (SELECT id FROM tipos_missa WHERE paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    tipo_missa_id IN (SELECT id FROM tipos_missa WHERE paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "tipo_missa_funcoes_publica" ON tipo_missa_funcoes;
CREATE POLICY "tipo_missa_funcoes_publica" ON tipo_missa_funcoes
  FOR SELECT USING (
    auth.uid() IS NULL AND
    tipo_missa_id IN (SELECT id FROM tipos_missa WHERE ativo = true)
  );

-- ════════════════════════════════════════════════════════════
-- BLOCO 4 — GRANTs para PostgREST
-- ════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL    ON tipos_missa        TO authenticated, service_role;
GRANT SELECT ON tipos_missa        TO anon;
GRANT ALL    ON tipo_missa_funcoes TO authenticated, service_role;
GRANT SELECT ON tipo_missa_funcoes TO anon;

-- Garantir que tabelas anteriores também têm grants corretos
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- BLOCO 5 — Recarregar PostgREST
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- BLOCO 6 — Validação final
-- ════════════════════════════════════════════════════════════

SELECT
  '✓ ' || table_name AS tabela,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS tamanho
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tipos_missa', 'tipo_missa_funcoes')
ORDER BY table_name;

-- Verificar coluna recorrencia em missas_padrao:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'missas_padrao' AND column_name IN ('tipo_missa_id', 'recorrencia');

-- Verificar token_portal em paroquias:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'paroquias' AND column_name = 'token_portal';
