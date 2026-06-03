-- ============================================================
-- LITURGIA SaaS — PATCH 007: Correções Estruturais
-- Itens: 1) remover exclusiva_solene/bispo de ministerios
--        2) adicionar observacoes em missas_padrao
--        3) adicionar prioridade em tipo_missa_funcoes
--        4) garantir tabelas e colunas dos recursos novos
-- Execute INTEIRO no SQL Editor do Supabase.
-- URL: https://supabase.com/dashboard/project/{seu-projeto}/sql/new
-- Idempotente — seguro executar múltiplas vezes.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Remover colunas exclusiva_solene e exclusiva_bispo de ministerios
--    Essas regras passaram a viver somente em tipo_missa_funcoes
-- ────────────────────────────────────────────────────────────
ALTER TABLE ministerios
  DROP COLUMN IF EXISTS exclusiva_solene,
  DROP COLUMN IF EXISTS exclusiva_bispo;

-- ────────────────────────────────────────────────────────────
-- 2. Adicionar coluna observacoes em missas_padrao
-- ────────────────────────────────────────────────────────────
ALTER TABLE missas_padrao
  ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- ────────────────────────────────────────────────────────────
-- 3. Adicionar coluna prioridade em tipo_missa_funcoes
--    (quanto menor o número, maior a prioridade de escalação)
-- ────────────────────────────────────────────────────────────
ALTER TABLE tipo_missa_funcoes
  ADD COLUMN IF NOT EXISTS prioridade SMALLINT NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- 4. Garantir que missas_padrao tem recorrencia e tipo_missa_id
--    (caso NOVOS_RECURSOS.sql não tenha sido executado ainda)
-- ────────────────────────────────────────────────────────────
ALTER TABLE missas_padrao
  ADD COLUMN IF NOT EXISTS tipo_missa_id UUID REFERENCES tipos_missa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recorrencia   JSONB NOT NULL DEFAULT '{"tipo":"semanal"}'::jsonb;

-- ────────────────────────────────────────────────────────────
-- 5. Garantir que tipos_missa existe
-- ────────────────────────────────────────────────────────────
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

ALTER TABLE tipos_missa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tipos_missa_paroquia" ON tipos_missa;
CREATE POLICY "tipos_missa_paroquia" ON tipos_missa FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ────────────────────────────────────────────────────────────
-- 6. Garantir que tipo_missa_funcoes existe
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tipo_missa_funcoes (
  id             UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_missa_id  UUID     NOT NULL REFERENCES tipos_missa(id)   ON DELETE CASCADE,
  ministerio_id  UUID     NOT NULL REFERENCES ministerios(id)   ON DELETE CASCADE,
  tipo_vinculo   TEXT     NOT NULL DEFAULT 'obrigatoria'
                          CHECK (tipo_vinculo IN ('obrigatoria', 'opcional')),
  quantidade_min SMALLINT NOT NULL DEFAULT 1,
  quantidade_max SMALLINT NOT NULL DEFAULT 1,
  prioridade     SMALLINT NOT NULL DEFAULT 0,
  UNIQUE(tipo_missa_id, ministerio_id)
);

ALTER TABLE tipo_missa_funcoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tipo_missa_funcoes_paroquia" ON tipo_missa_funcoes;
CREATE POLICY "tipo_missa_funcoes_paroquia" ON tipo_missa_funcoes FOR ALL
  USING (
    tipo_missa_id IN (SELECT id FROM tipos_missa WHERE paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    tipo_missa_id IN (SELECT id FROM tipos_missa WHERE paroquia_id = current_paroquia_id())
  );

-- ────────────────────────────────────────────────────────────
-- 7. Garantir que comunidades existe
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comunidades (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  tipo          TEXT        NOT NULL DEFAULT 'comunidade'
                            CHECK (tipo IN ('matriz', 'capela', 'comunidade', 'santuario')),
  endereco      TEXT,
  responsavel   TEXT,
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE comunidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comunidades_tenant" ON comunidades;
CREATE POLICY "comunidades_tenant" ON comunidades FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE INDEX IF NOT EXISTS comunidades_paroquia_idx ON comunidades (paroquia_id);

-- ────────────────────────────────────────────────────────────
-- 8. Garantir que atuacoes_pastorais existe
-- ────────────────────────────────────────────────────────────
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

DROP POLICY IF EXISTS "atuacoes_pastorais_tenant" ON atuacoes_pastorais;
CREATE POLICY "atuacoes_pastorais_tenant" ON atuacoes_pastorais FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ────────────────────────────────────────────────────────────
-- 9. Garantir colunas extras em ministerios
-- ────────────────────────────────────────────────────────────
ALTER TABLE ministerios
  ADD COLUMN IF NOT EXISTS categoria          TEXT,
  ADD COLUMN IF NOT EXISTS icone              TEXT,
  ADD COLUMN IF NOT EXISTS pontuacao_minima   INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exigir_experiencia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mostrar_no_portal  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quantidade_padrao  SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_adicionar     BOOLEAN NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────
-- 10. Garantir colunas extras em coordenadores
-- ────────────────────────────────────────────────────────────
ALTER TABLE coordenadores
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS atua_como   TEXT,
  ADD COLUMN IF NOT EXISTS comunidade  TEXT;

-- ────────────────────────────────────────────────────────────
-- 11. GRANTs completos para PostgREST funcionar
-- ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated, service_role;

-- Reload do schema do PostgREST
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────
-- VALIDAÇÃO
-- ────────────────────────────────────────────────────────────
SELECT
  'OK — coluna removida: ' || column_name AS status
FROM information_schema.columns
WHERE table_name = 'ministerios'
  AND column_name IN ('exclusiva_solene', 'exclusiva_bispo')
UNION ALL
SELECT 'OK — coluna presente: missas_padrao.observacoes'
FROM information_schema.columns
WHERE table_name = 'missas_padrao' AND column_name = 'observacoes'
UNION ALL
SELECT 'OK — coluna presente: tipo_missa_funcoes.prioridade'
FROM information_schema.columns
WHERE table_name = 'tipo_missa_funcoes' AND column_name = 'prioridade'
UNION ALL
SELECT 'AVISO — exclusiva_solene ainda existe!' AS status
FROM information_schema.columns
WHERE table_name = 'ministerios' AND column_name = 'exclusiva_solene';
