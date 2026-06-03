CREATE TABLE IF NOT EXISTS liturgia_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  data DATE NOT NULL,
  ano INT NOT NULL,

  titulo TEXT NOT NULL,
  subtitulo TEXT,

  tipo TEXT,
  grau TEXT,
  cor TEXT,
  tempo_liturgico TEXT,

  santo TEXT,
  observacoes TEXT,

  evangelho TEXT,
  leitura_1 TEXT,
  leitura_2 TEXT,
  salmo TEXT,
  prefacio TEXT,

  e_dia_preceito BOOLEAN DEFAULT false,
  e_solene BOOLEAN DEFAULT false,
  e_memorial BOOLEAN DEFAULT false,

  origem TEXT DEFAULT 'romano',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liturgia_base_data
ON liturgia_base(data);

CREATE INDEX IF NOT EXISTS idx_liturgia_base_ano
ON liturgia_base(ano);
CREATE TABLE IF NOT EXISTS liturgia_diocese (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  diocese_id UUID,

  data DATE NOT NULL,

  titulo TEXT NOT NULL,
  grau TEXT,
  cor TEXT,

  observacoes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS liturgia_paroquia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  paroquia_id UUID NOT NULL REFERENCES paroquias(id)
  ON DELETE CASCADE,

  data DATE NOT NULL,

  titulo TEXT NOT NULL,
  descricao TEXT,

  grau TEXT,
  cor TEXT,

  e_padroeiro BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS liturgia_leituras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  liturgia_id UUID REFERENCES liturgia_base(id)
  ON DELETE CASCADE,

  evangelho TEXT,
  leitura_1 TEXT,
  leitura_2 TEXT,
  salmo TEXT,
  prefacio TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS liturgia_importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ano INT NOT NULL,

  arquivo_nome TEXT,
  origem TEXT,

  status TEXT DEFAULT 'processando',

  erros JSONB,
  log JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);