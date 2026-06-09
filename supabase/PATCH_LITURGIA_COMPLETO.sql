-- ============================================================
-- PATCH_LITURGIA_COMPLETO.sql
-- 1. Índices e constraints nas tabelas de liturgia (005_calendario_liturgico.sql)
-- 2. RLS para todas as tabelas litúrgicas
-- 3. Tabela dioceses
-- 4. Tabela regioes_liturgicas
-- 5. Constraint UNIQUE para evitar duplicatas em liturgia_base
-- 6. Tabela calendario_overrides (multi-diocese)
-- Execute no SQL Editor: https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ── 1. Constraint UNIQUE em liturgia_base (data única por origem) ─────────────
-- Garante que o importador não crie duplicatas para a mesma data e origem
ALTER TABLE liturgia_base
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'romano';

-- Só adiciona unique se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'liturgia_base'
      AND constraint_name = 'liturgia_base_data_origem_key'
  ) THEN
    ALTER TABLE liturgia_base ADD CONSTRAINT liturgia_base_data_origem_key UNIQUE (data, origem);
  END IF;
END $$;

-- ── 2. Índice em liturgia_paroquia (paroquia_id + data) ───────────────────────
CREATE INDEX IF NOT EXISTS idx_liturgia_paroquia_pid_data
  ON liturgia_paroquia (paroquia_id, data);

CREATE INDEX IF NOT EXISTS idx_liturgia_diocese_data
  ON liturgia_diocese (diocese_id, data);

CREATE INDEX IF NOT EXISTS idx_liturgia_base_data_ano
  ON liturgia_base (data, ano);

-- ── 3. RLS nas tabelas litúrgicas ────────────────────────────────────────────

-- liturgia_base: leitura pública (qualquer usuário autenticado pode ler)
ALTER TABLE liturgia_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liturgia_base_read" ON liturgia_base;
CREATE POLICY "liturgia_base_read" ON liturgia_base
  FOR SELECT USING (true);

-- Somente super_admin pode inserir/atualizar (via script ou painel)
DROP POLICY IF EXISTS "liturgia_base_write" ON liturgia_base;
CREATE POLICY "liturgia_base_write" ON liturgia_base
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'super_admin'
    )
  );

-- liturgia_diocese: leitura pública
ALTER TABLE liturgia_diocese ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liturgia_diocese_read" ON liturgia_diocese;
CREATE POLICY "liturgia_diocese_read" ON liturgia_diocese
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "liturgia_diocese_write" ON liturgia_diocese;
CREATE POLICY "liturgia_diocese_write" ON liturgia_diocese
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin', 'admin_paroquial')
    )
  );

-- liturgia_paroquia: leitura e escrita por paróquia autenticada
ALTER TABLE liturgia_paroquia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liturgia_paroquia_read" ON liturgia_paroquia;
CREATE POLICY "liturgia_paroquia_read" ON liturgia_paroquia
  FOR SELECT USING (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "liturgia_paroquia_write" ON liturgia_paroquia;
CREATE POLICY "liturgia_paroquia_write" ON liturgia_paroquia
  FOR ALL USING (paroquia_id = current_paroquia_id());

-- liturgia_leituras: leitura pública
ALTER TABLE liturgia_leituras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liturgia_leituras_read" ON liturgia_leituras;
CREATE POLICY "liturgia_leituras_read" ON liturgia_leituras
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "liturgia_leituras_write" ON liturgia_leituras;
CREATE POLICY "liturgia_leituras_write" ON liturgia_leituras
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- liturgia_importacoes: somente admin
ALTER TABLE liturgia_importacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liturgia_importacoes_access" ON liturgia_importacoes;
CREATE POLICY "liturgia_importacoes_access" ON liturgia_importacoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin', 'admin_paroquial')
    )
  );

-- ── 4. Tabela dioceses (Parte 11 — multi-diocese) ────────────────────────────
CREATE TABLE IF NOT EXISTS dioceses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  sigla         TEXT,
  pais          TEXT NOT NULL DEFAULT 'BR',
  regiao        TEXT,
  bispo         TEXT,
  site_url      TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dioceses_pais_idx ON dioceses (pais, ativo);

ALTER TABLE dioceses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dioceses_read" ON dioceses;
CREATE POLICY "dioceses_read" ON dioceses
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "dioceses_write" ON dioceses;
CREATE POLICY "dioceses_write" ON dioceses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- FK de liturgia_diocese para dioceses (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'liturgia_diocese' AND column_name = 'diocese_id'
      AND data_type = 'uuid'
  ) THEN
    -- diocese_id já existe mas sem FK; adicionamos a restrição
    BEGIN
      ALTER TABLE liturgia_diocese
        ADD CONSTRAINT fk_liturgia_diocese_dioceses
        FOREIGN KEY (diocese_id) REFERENCES dioceses(id) ON DELETE CASCADE;
    EXCEPTION WHEN others THEN
      -- FK pode já existir
    END;
  END IF;
END $$;

-- ── 5. Tabela regioes_liturgicas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regioes_liturgicas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diocese_id    UUID REFERENCES dioceses(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE regioes_liturgicas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regioes_liturgicas_read" ON regioes_liturgicas;
CREATE POLICY "regioes_liturgicas_read" ON regioes_liturgicas
  FOR SELECT USING (true);

-- ── 6. FK paroquias → dioceses (opcional) ────────────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS diocese_id UUID REFERENCES dioceses(id) ON DELETE SET NULL;

-- ── 7. Tabela calendario_overrides (multi-diocesal / multi-país) ──────────────
-- Permite sobrescrever liturgia_base para uma diocese ou região específica
CREATE TABLE IF NOT EXISTS calendario_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diocese_id      UUID REFERENCES dioceses(id) ON DELETE CASCADE,
  paroquia_id     UUID REFERENCES paroquias(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  titulo          TEXT NOT NULL,
  grau            TEXT,
  cor             TEXT,
  observacoes     TEXT,
  tipo_override   TEXT NOT NULL DEFAULT 'adicao',
  -- tipo_override: 'adicao' | 'substituicao' | 'cancelamento'
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_override_scope CHECK (
    diocese_id IS NOT NULL OR paroquia_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS calendario_overrides_data_idx
  ON calendario_overrides (data);
CREATE INDEX IF NOT EXISTS calendario_overrides_diocese_idx
  ON calendario_overrides (diocese_id, data);
CREATE INDEX IF NOT EXISTS calendario_overrides_paroquia_idx
  ON calendario_overrides (paroquia_id, data);

ALTER TABLE calendario_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendario_overrides_read" ON calendario_overrides;
CREATE POLICY "calendario_overrides_read" ON calendario_overrides
  FOR SELECT USING (
    paroquia_id = current_paroquia_id()
    OR diocese_id IN (
      SELECT diocese_id FROM paroquias WHERE id = current_paroquia_id()
    )
  );

DROP POLICY IF EXISTS "calendario_overrides_write" ON calendario_overrides;
CREATE POLICY "calendario_overrides_write" ON calendario_overrides
  FOR ALL USING (
    paroquia_id = current_paroquia_id()
    AND EXISTS (
      SELECT 1 FROM user_roles WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'lider', 'super_admin')
    )
  );

-- ── Validação ─────────────────────────────────────────────────────────────────
SELECT 'OK — RLS liturgia_base' AS status
UNION ALL SELECT 'OK — RLS liturgia_diocese'
UNION ALL SELECT 'OK — RLS liturgia_paroquia'
UNION ALL SELECT 'OK — tabela dioceses'
UNION ALL SELECT 'OK — tabela regioes_liturgicas'
UNION ALL SELECT 'OK — tabela calendario_overrides'
UNION ALL SELECT 'OK — coluna diocese_id em paroquias';
