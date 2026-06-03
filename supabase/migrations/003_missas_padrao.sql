-- 003_missas_padrao.sql
-- Parish-level mass templates ("Missas Padrão") + advanced parish config

-- ── paroquias: additional columns ───────────────────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS padroeiro        TEXT,
  ADD COLUMN IF NOT EXISTS cidade           TEXT,
  ADD COLUMN IF NOT EXISTS usa_tochas       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS usa_turibulo     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS usa_naveta       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS usa_baculifero   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS usa_mitrifero    BOOLEAN NOT NULL DEFAULT TRUE;

-- ── missas_padrao ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missas_padrao (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  dia_semana    SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=Dom … 6=Sáb
  hora_inicio   TIME,
  hora_fim      TIME,
  local         TEXT,
  tipo          TEXT NOT NULL DEFAULT 'missa',
  solene        BOOLEAN NOT NULL DEFAULT FALSE,
  tem_adoracao  BOOLEAN NOT NULL DEFAULT FALSE,
  tem_bispo     BOOLEAN NOT NULL DEFAULT FALSE,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  ordem         SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS missas_padrao_paroquia_idx ON missas_padrao (paroquia_id, dia_semana, ordem);

-- ── missa_padrao_funcoes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missa_padrao_funcoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  missa_padrao_id UUID NOT NULL REFERENCES missas_padrao(id) ON DELETE CASCADE,
  ministerio_id   UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  quantidade      SMALLINT NOT NULL DEFAULT 1,
  UNIQUE (missa_padrao_id, ministerio_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE missas_padrao ENABLE ROW LEVEL SECURITY;
ALTER TABLE missa_padrao_funcoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "missas_padrao: paroquia members"
  ON missas_padrao FOR ALL
  USING (paroquia_id = current_paroquia_id());

CREATE POLICY "missa_padrao_funcoes: via missa"
  ON missa_padrao_funcoes FOR ALL
  USING (
    missa_padrao_id IN (
      SELECT id FROM missas_padrao WHERE paroquia_id = current_paroquia_id()
    )
  );
