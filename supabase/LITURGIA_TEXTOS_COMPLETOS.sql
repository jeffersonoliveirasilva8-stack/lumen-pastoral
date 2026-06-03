-- ============================================================
-- LITURGIA_TEXTOS_COMPLETOS.sql
-- Expande liturgia_base com campos de texto completo e cria
-- a tabela homilias_diarias para integração com YouTube.
--
-- Execute no Supabase Dashboard → SQL Editor
-- Idempotente: pode ser executado múltiplas vezes com segurança
-- ============================================================

-- ── 1. Expandir liturgia_base com referência + texto separados ────────────────
--  Mantém os campos antigos (leitura_1, leitura_2, salmo, evangelho) para
--  compatibilidade retroativa com o código existente.

ALTER TABLE liturgia_base
  ADD COLUMN IF NOT EXISTS leitura_1_referencia  TEXT,
  ADD COLUMN IF NOT EXISTS leitura_1_texto        TEXT,
  ADD COLUMN IF NOT EXISTS salmo_referencia       TEXT,
  ADD COLUMN IF NOT EXISTS salmo_texto            TEXT,
  ADD COLUMN IF NOT EXISTS leitura_2_referencia   TEXT,
  ADD COLUMN IF NOT EXISTS leitura_2_texto        TEXT,
  ADD COLUMN IF NOT EXISTS evangelho_referencia   TEXT,
  ADD COLUMN IF NOT EXISTS evangelho_texto        TEXT,
  ADD COLUMN IF NOT EXISTS santo                  TEXT;  -- nome do santo do dia

-- Comentários descritivos nas colunas
COMMENT ON COLUMN liturgia_base.leitura_1_referencia  IS 'Referência bíblica — ex: Gn 3,9-15';
COMMENT ON COLUMN liturgia_base.leitura_1_texto        IS 'Texto litúrgico completo da 1ª Leitura';
COMMENT ON COLUMN liturgia_base.salmo_referencia       IS 'Referência do salmo — ex: Sl 129';
COMMENT ON COLUMN liturgia_base.salmo_texto            IS 'Texto completo do salmo responsorial';
COMMENT ON COLUMN liturgia_base.leitura_2_referencia   IS 'Referência bíblica — ex: Rm 5,12-19';
COMMENT ON COLUMN liturgia_base.leitura_2_texto        IS 'Texto litúrgico completo da 2ª Leitura';
COMMENT ON COLUMN liturgia_base.evangelho_referencia   IS 'Referência bíblica — ex: Jo 17,1-11a';
COMMENT ON COLUMN liturgia_base.evangelho_texto        IS 'Texto litúrgico completo do Evangelho';

-- ── 2. Tabela: homilias_diarias ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS homilias_diarias (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  data          DATE        NOT NULL,
  titulo        TEXT        NOT NULL,
  descricao     TEXT,
  youtube_url   TEXT        NOT NULL,  -- ex: https://www.youtube.com/watch?v=xxxx
  video_id      TEXT        NOT NULL,  -- ex: 2CXV9p_uOwY
  thumbnail_url TEXT,                  -- ex: https://i.ytimg.com/vi/xxxx/hqdefault.jpg
  autor         TEXT        DEFAULT 'Padre Paulo Ricardo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (data)   -- apenas uma homilia por dia
);

CREATE INDEX IF NOT EXISTS idx_homilias_diarias_data
  ON homilias_diarias (data DESC);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_homilias_updated_at ON homilias_diarias;
CREATE TRIGGER set_homilias_updated_at
  BEFORE UPDATE ON homilias_diarias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. RLS para homilias_diarias ─────────────────────────────────────────────
ALTER TABLE homilias_diarias ENABLE ROW LEVEL SECURITY;

-- Leitura pública (anon pode ler)
DROP POLICY IF EXISTS "homilias_public_read" ON homilias_diarias;
CREATE POLICY "homilias_public_read" ON homilias_diarias
  FOR SELECT USING (true);

-- Apenas o service_role da Edge Function pode inserir/atualizar
DROP POLICY IF EXISTS "homilias_service_write" ON homilias_diarias;
CREATE POLICY "homilias_service_write" ON homilias_diarias
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Verificação ───────────────────────────────────────────────────────────
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'liturgia_base'
  AND column_name IN (
    'leitura_1_referencia', 'leitura_1_texto',
    'salmo_referencia', 'salmo_texto',
    'leitura_2_referencia', 'leitura_2_texto',
    'evangelho_referencia', 'evangelho_texto',
    'santo'
  )
ORDER BY column_name;

SELECT 'homilias_diarias criada' AS status
FROM information_schema.tables
WHERE table_name = 'homilias_diarias';
