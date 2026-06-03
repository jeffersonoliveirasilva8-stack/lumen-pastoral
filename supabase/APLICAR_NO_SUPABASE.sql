-- ============================================================
-- LITURGIA SaaS — SCHEMA COMPLETO V2 (idempotente)
-- Pode ser executado múltiplas vezes com segurança.
-- Usa IF NOT EXISTS / CREATE OR REPLACE em tudo.
-- Execute INTEIRO no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOCO 0 — ENUM
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('super_admin', 'admin_paroquial', 'lider', 'servidor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════
-- BLOCO 1 — FUNÇÕES AUXILIARES (precisam existir antes das tabelas)
-- ════════════════════════════════════════════════════════════

-- Retorna paroquia_id do usuário autenticado (usada em todo RLS)
CREATE OR REPLACE FUNCTION current_paroquia_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT paroquia_id FROM profiles WHERE id = auth.uid()
$$;

-- Atualiza updated_at / atualizado_em automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('comunidades','coordenadores') THEN
    NEW.atualizado_em = NOW();
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Cria profile automaticamente quando usuário se cadastra
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, nome_completo)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Recalcula score do membro a cada inserção/alteração no histórico
CREATE OR REPLACE FUNCTION recalcular_score_membro()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE membros
  SET score = (
    SELECT COALESCE(SUM(pontos), 0)
    FROM historico_participacoes
    WHERE membro_id = COALESCE(NEW.membro_id, OLD.membro_id)
      AND presenca = 'confirmado'
  )
  WHERE id = COALESCE(NEW.membro_id, OLD.membro_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ════════════════════════════════════════════════════════════
-- BLOCO 2 — TABELAS BASE (com todas as colunas necessárias)
-- ════════════════════════════════════════════════════════════

-- paroquias (tenant raiz) ─ criada pela migration CLI sem colunas extras
-- usamos ADD COLUMN IF NOT EXISTS para não perder dados existentes
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS padroeiro      TEXT,
  ADD COLUMN IF NOT EXISTS cidade         TEXT,
  ADD COLUMN IF NOT EXISTS usa_tochas     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usa_turibulo   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_naveta     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_baculifero BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS usa_mitrifero  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS regras_escala  JSONB   NOT NULL DEFAULT '{
    "limite_semanal": null,
    "limite_mensal": null,
    "impedir_repeticao_consecutiva": false,
    "prioridade_score": true,
    "permitir_duplicidade": false,
    "peso_solene": 2,
    "peso_normal": 1
  }'::jsonb;

-- Trigger updated_at para paroquias
DROP TRIGGER IF EXISTS paroquias_updated_at ON paroquias;
CREATE TRIGGER paroquias_updated_at
  BEFORE UPDATE ON paroquias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- profiles — já existe; só garantir trigger
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════
-- BLOCO 3 — TABELAS LITÚRGICAS PRINCIPAIS
-- ════════════════════════════════════════════════════════════

-- ministerios
CREATE TABLE IF NOT EXISTS ministerios (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id         UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome                TEXT        NOT NULL,
  descricao           TEXT,
  cor                 TEXT        NOT NULL DEFAULT '#6B7280',
  icone               TEXT,
  categoria           TEXT,
  ativo               BOOLEAN     NOT NULL DEFAULT true,
  ordem               INT         NOT NULL DEFAULT 0,
  pontuacao_minima    INT         NOT NULL DEFAULT 0,
  exigir_experiencia  BOOLEAN     NOT NULL DEFAULT false,
  mostrar_no_portal   BOOLEAN     NOT NULL DEFAULT true,
  exclusiva_solene    BOOLEAN     NOT NULL DEFAULT false,
  exclusiva_bispo     BOOLEAN     NOT NULL DEFAULT false,
  quantidade_padrao   SMALLINT    NOT NULL DEFAULT 1,
  auto_adicionar      BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colunas adicionadas em patches anteriores (caso tabela já existia sem elas)
ALTER TABLE ministerios
  ADD COLUMN IF NOT EXISTS icone              TEXT,
  ADD COLUMN IF NOT EXISTS categoria          TEXT,
  ADD COLUMN IF NOT EXISTS pontuacao_minima   INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exigir_experiencia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mostrar_no_portal  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclusiva_solene   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusiva_bispo    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantidade_padrao  SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_adicionar     BOOLEAN NOT NULL DEFAULT false;

DROP TRIGGER IF EXISTS ministerios_updated_at ON ministerios;
CREATE TRIGGER ministerios_updated_at
  BEFORE UPDATE ON ministerios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- membros / servidores
CREATE TABLE IF NOT EXISTS membros (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id             UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  profile_id              UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  nome                    TEXT        NOT NULL,
  email                   TEXT,
  telefone                TEXT,
  data_nascimento         DATE,
  data_ingresso           DATE,
  observacoes             TEXT,
  ativo                   BOOLEAN     NOT NULL DEFAULT true,
  score                   INT         NOT NULL DEFAULT 0,
  forcar_escalacao_solene BOOLEAN     NOT NULL DEFAULT false,
  prioridade_escala       TEXT        NOT NULL DEFAULT 'nenhuma',
  token_acesso            UUID        DEFAULT gen_random_uuid() UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS score                   INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forcar_escalacao_solene BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prioridade_escala       TEXT    NOT NULL DEFAULT 'nenhuma',
  ADD COLUMN IF NOT EXISTS token_acesso            UUID    DEFAULT gen_random_uuid();

-- Garante índice único no token_acesso
CREATE UNIQUE INDEX IF NOT EXISTS membros_token_acesso_idx ON membros (token_acesso);

-- Preenche token_acesso em membros que ficaram sem ele
UPDATE membros SET token_acesso = gen_random_uuid() WHERE token_acesso IS NULL;

DROP TRIGGER IF EXISTS membros_updated_at ON membros;
CREATE TRIGGER membros_updated_at
  BEFORE UPDATE ON membros
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- membro ↔ ministérios
CREATE TABLE IF NOT EXISTS membro_ministerios (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id     UUID        NOT NULL REFERENCES membros(id)    ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  nivel         TEXT        NOT NULL DEFAULT 'ativo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(membro_id, ministerio_id)
);

-- escalas (missas / celebrações)
CREATE TABLE IF NOT EXISTS escalas (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo        TEXT        NOT NULL,
  data          DATE        NOT NULL,
  hora_inicio   TIME,
  hora_fim      TIME,
  local         TEXT,
  tipo          TEXT        NOT NULL DEFAULT 'missa',
  status        TEXT        NOT NULL DEFAULT 'rascunho',
  observacoes   TEXT,
  solene        BOOLEAN     NOT NULL DEFAULT false,
  tem_adoracao  BOOLEAN     NOT NULL DEFAULT false,
  tem_bispo     BOOLEAN     NOT NULL DEFAULT false,
  token_publico UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_by    UUID        REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE escalas
  ADD COLUMN IF NOT EXISTS hora_inicio   TIME,
  ADD COLUMN IF NOT EXISTS hora_fim      TIME,
  ADD COLUMN IF NOT EXISTS local         TEXT,
  ADD COLUMN IF NOT EXISTS tipo          TEXT    NOT NULL DEFAULT 'missa',
  ADD COLUMN IF NOT EXISTS status        TEXT    NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS observacoes   TEXT,
  ADD COLUMN IF NOT EXISTS solene        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_adoracao  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_bispo     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_publico UUID    NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS created_by    UUID    REFERENCES profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS escalas_token_publico_idx ON escalas(token_publico);

DROP TRIGGER IF EXISTS escalas_updated_at ON escalas;
CREATE TRIGGER escalas_updated_at
  BEFORE UPDATE ON escalas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- funções necessárias por escala
CREATE TABLE IF NOT EXISTS escala_funcoes (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID     NOT NULL REFERENCES escalas(id)    ON DELETE CASCADE,
  ministerio_id UUID     NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  quantidade    INT      NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  UNIQUE(escala_id, ministerio_id)
);

-- membros atribuídos à escala
CREATE TABLE IF NOT EXISTS escala_membros (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID        NOT NULL REFERENCES escalas(id)    ON DELETE CASCADE,
  membro_id     UUID        NOT NULL REFERENCES membros(id)    ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pendente',
  justificativa TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(escala_id, membro_id, ministerio_id)
);

ALTER TABLE escala_membros
  ADD COLUMN IF NOT EXISTS justificativa TEXT;

-- Default para 'pendente' em registros existentes (caso fosse '')
UPDATE escala_membros SET status = 'pendente' WHERE status IS NULL OR status = '';

-- indisponibilidades
CREATE TABLE IF NOT EXISTS indisponibilidades (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  membro_id   UUID        NOT NULL REFERENCES membros(id)   ON DELETE CASCADE,
  data        DATE        NOT NULL,
  motivo      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- histórico de participações (para scoring)
CREATE TABLE IF NOT EXISTS historico_participacoes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id)    ON DELETE CASCADE,
  membro_id     UUID        NOT NULL REFERENCES membros(id)       ON DELETE CASCADE,
  escala_id     UUID        NOT NULL REFERENCES escalas(id)       ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id)   ON DELETE CASCADE,
  presenca      TEXT        NOT NULL DEFAULT 'confirmado',
  data          DATE        NOT NULL,
  pontos        INT         NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(membro_id, escala_id, ministerio_id)
);

-- templates semanais de missa
CREATE TABLE IF NOT EXISTS missas_padrao (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome         TEXT        NOT NULL,
  dia_semana   SMALLINT    NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio  TIME,
  hora_fim     TIME,
  local        TEXT,
  tipo         TEXT        NOT NULL DEFAULT 'missa',
  solene       BOOLEAN     NOT NULL DEFAULT false,
  tem_adoracao BOOLEAN     NOT NULL DEFAULT false,
  tem_bispo    BOOLEAN     NOT NULL DEFAULT false,
  ativo        BOOLEAN     NOT NULL DEFAULT true,
  ordem        SMALLINT    NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS missas_padrao_paroquia_idx
  ON missas_padrao (paroquia_id, dia_semana, ordem);

-- funções por template de missa
CREATE TABLE IF NOT EXISTS missa_padrao_funcoes (
  id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  missa_padrao_id UUID     NOT NULL REFERENCES missas_padrao(id)  ON DELETE CASCADE,
  ministerio_id   UUID     NOT NULL REFERENCES ministerios(id)     ON DELETE CASCADE,
  quantidade      SMALLINT NOT NULL DEFAULT 1,
  UNIQUE(missa_padrao_id, ministerio_id)
);

-- ════════════════════════════════════════════════════════════
-- BLOCO 4 — TABELAS DE PERSONALIZAÇÃO (comunidades, coordenadores)
-- ════════════════════════════════════════════════════════════

-- comunidades (capelas, matrizes, etc.)
CREATE TABLE IF NOT EXISTS comunidades (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  tipo          TEXT        NOT NULL DEFAULT 'comunidade'
                            CHECK (tipo IN ('matriz','capela','comunidade','santuario')),
  endereco      TEXT,
  responsavel   TEXT,
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS comunidades_updated_at ON comunidades;
CREATE TRIGGER comunidades_updated_at
  BEFORE UPDATE ON comunidades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- coordenadores pastorais
CREATE TABLE IF NOT EXISTS coordenadores (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  membro_id       UUID        REFERENCES membros(id) ON DELETE SET NULL,
  nome            TEXT        NOT NULL,
  funcao_pastoral TEXT,
  atua_como       TEXT,
  comunidade      TEXT,
  email           TEXT,
  telefone        TEXT,
  observacoes     TEXT,
  ativo           BOOLEAN     NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colunas novas em coordenadores (para quem já tinha a tabela sem elas)
ALTER TABLE coordenadores
  ADD COLUMN IF NOT EXISTS atua_como   TEXT,
  ADD COLUMN IF NOT EXISTS comunidade  TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT;

DROP TRIGGER IF EXISTS coordenadores_updated_at ON coordenadores;
CREATE TRIGGER coordenadores_updated_at
  BEFORE UPDATE ON coordenadores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  
-- ════════════════════════════════════════════════════════════
-- BLOCO 5 — ATUAÇÕES PASTORAIS E RESTRIÇÕES DE FUNÇÃO
-- ════════════════════════════════════════════════════════════

-- atuações pastorais (grupos: jovens, catequese, idosos, etc.)
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

CREATE INDEX IF NOT EXISTS atuacoes_pastorais_paroquia_idx
  ON atuacoes_pastorais (paroquia_id, ordem);

-- membro ↔ atuações (M:N)
CREATE TABLE IF NOT EXISTS membro_atuacoes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id  UUID NOT NULL REFERENCES membros(id)           ON DELETE CASCADE,
  atuacao_id UUID NOT NULL REFERENCES atuacoes_pastorais(id) ON DELETE CASCADE,
  UNIQUE(membro_id, atuacao_id)
);

-- membro ↔ restrições de função (pode / nao_pode por ministério)
CREATE TABLE IF NOT EXISTS membro_funcao_restricoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id     UUID NOT NULL REFERENCES membros(id)    ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'pode'
                CHECK (tipo IN ('pode', 'nao_pode')),
  UNIQUE(membro_id, ministerio_id, tipo)
);

-- ════════════════════════════════════════════════════════════
-- BLOCO 6 — TRIGGERS score
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS historico_score_trigger ON historico_participacoes;
CREATE TRIGGER historico_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON historico_participacoes
  FOR EACH ROW EXECUTE FUNCTION recalcular_score_membro();

-- ════════════════════════════════════════════════════════════
-- BLOCO 7 — RLS (HABILITAR + POLICIES)
-- ════════════════════════════════════════════════════════════

ALTER TABLE ministerios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE membros                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_ministerios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE escala_funcoes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE escala_membros          ENABLE ROW LEVEL SECURITY;
ALTER TABLE indisponibilidades      ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_participacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE missas_padrao           ENABLE ROW LEVEL SECURITY;
ALTER TABLE missa_padrao_funcoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunidades             ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordenadores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE atuacoes_pastorais      ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_atuacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_funcao_restricoes ENABLE ROW LEVEL SECURITY;

-- ── ministerios ───────────────────────────────────────────
DROP POLICY IF EXISTS "ministerios_paroquia" ON ministerios;
CREATE POLICY "ministerios_paroquia" ON ministerios FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "ministerios_leitura_publica" ON ministerios;
CREATE POLICY "ministerios_leitura_publica" ON ministerios
  FOR SELECT USING (auth.uid() IS NULL AND ativo = true);

-- ── membros ───────────────────────────────────────────────
DROP POLICY IF EXISTS "membros_paroquia" ON membros;
CREATE POLICY "membros_paroquia" ON membros FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "membros_leitura_publica" ON membros;
CREATE POLICY "membros_leitura_publica" ON membros
  FOR SELECT USING (
    auth.uid() IS NULL AND ativo = true AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

-- ── membro_ministerios ────────────────────────────────────
DROP POLICY IF EXISTS "membro_ministerios_paroquia" ON membro_ministerios;
CREATE POLICY "membro_ministerios_paroquia" ON membro_ministerios FOR ALL
  USING (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "membro_ministerios_leitura_publica" ON membro_ministerios;
CREATE POLICY "membro_ministerios_leitura_publica" ON membro_ministerios
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (
      SELECT 1 FROM membros m
      JOIN escala_membros em ON em.membro_id = m.id
      JOIN escalas e ON e.id = em.escala_id
      WHERE m.id = membro_id AND e.status = 'publicada'
    )
  );

-- ── escalas ───────────────────────────────────────────────
DROP POLICY IF EXISTS "escalas_paroquia" ON escalas;
CREATE POLICY "escalas_paroquia" ON escalas FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "escalas_leitura_publica" ON escalas;
CREATE POLICY "escalas_leitura_publica" ON escalas
  FOR SELECT USING (auth.uid() IS NULL AND status = 'publicada');

-- ── escala_funcoes ────────────────────────────────────────
DROP POLICY IF EXISTS "escala_funcoes_paroquia" ON escala_funcoes;
CREATE POLICY "escala_funcoes_paroquia" ON escala_funcoes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "escala_funcoes_leitura_publica" ON escala_funcoes;
CREATE POLICY "escala_funcoes_leitura_publica" ON escala_funcoes
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

-- ── escala_membros ────────────────────────────────────────
DROP POLICY IF EXISTS "escala_membros_paroquia" ON escala_membros;
CREATE POLICY "escala_membros_paroquia" ON escala_membros FOR ALL
  USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "escala_membros_leitura_publica" ON escala_membros;
CREATE POLICY "escala_membros_leitura_publica" ON escala_membros
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

-- ── indisponibilidades ────────────────────────────────────
DROP POLICY IF EXISTS "indisponibilidades_paroquia" ON indisponibilidades;
CREATE POLICY "indisponibilidades_paroquia" ON indisponibilidades FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── historico_participacoes ───────────────────────────────
DROP POLICY IF EXISTS "historico_paroquia" ON historico_participacoes;
CREATE POLICY "historico_paroquia" ON historico_participacoes FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── missas_padrao ─────────────────────────────────────────
DROP POLICY IF EXISTS "missas_padrao: paroquia members" ON missas_padrao;
CREATE POLICY "missas_padrao: paroquia members" ON missas_padrao FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "missa_padrao_funcoes: via missa" ON missa_padrao_funcoes;
CREATE POLICY "missa_padrao_funcoes: via missa" ON missa_padrao_funcoes FOR ALL
  USING (
    missa_padrao_id IN (SELECT id FROM missas_padrao WHERE paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    missa_padrao_id IN (SELECT id FROM missas_padrao WHERE paroquia_id = current_paroquia_id())
  );

-- ── comunidades ───────────────────────────────────────────
DROP POLICY IF EXISTS "comunidades_select" ON comunidades;
DROP POLICY IF EXISTS "comunidades_insert" ON comunidades;
DROP POLICY IF EXISTS "comunidades_update" ON comunidades;
DROP POLICY IF EXISTS "comunidades_delete" ON comunidades;
DROP POLICY IF EXISTS "comunidades_paroquia" ON comunidades;
CREATE POLICY "comunidades_paroquia" ON comunidades FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── coordenadores ─────────────────────────────────────────
DROP POLICY IF EXISTS "coordenadores_select" ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_insert" ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_update" ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_delete" ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_paroquia" ON coordenadores;
CREATE POLICY "coordenadores_paroquia" ON coordenadores FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── atuacoes_pastorais ────────────────────────────────────
DROP POLICY IF EXISTS "atuacoes_pastorais_paroquia" ON atuacoes_pastorais;
CREATE POLICY "atuacoes_pastorais_paroquia" ON atuacoes_pastorais FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── membro_atuacoes ───────────────────────────────────────
DROP POLICY IF EXISTS "membro_atuacoes_paroquia" ON membro_atuacoes;
CREATE POLICY "membro_atuacoes_paroquia" ON membro_atuacoes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  );

-- ── membro_funcao_restricoes ──────────────────────────────
DROP POLICY IF EXISTS "membro_funcao_restricoes_paroquia" ON membro_funcao_restricoes;
CREATE POLICY "membro_funcao_restricoes_paroquia" ON membro_funcao_restricoes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  );

-- ════════════════════════════════════════════════════════════
-- BLOCO 8 — RPCs DO PORTAL (SECURITY DEFINER — bypass RLS via token)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION portal_get_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT row_to_json(t) FROM (
    SELECT
      m.id, m.nome, m.email, m.telefone, m.score, m.data_ingresso,
      m.forcar_escalacao_solene, m.prioridade_escala, m.paroquia_id,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', mn.id, 'nome', mn.nome, 'cor', mn.cor))
        FILTER (WHERE mn.id IS NOT NULL), '[]'::json
      ) AS ministerios
    FROM membros m
    LEFT JOIN membro_ministerios mm ON mm.membro_id = m.id
    LEFT JOIN ministerios        mn ON mn.id = mm.ministerio_id
    WHERE m.token_acesso = p_token
    GROUP BY m.id
  ) t;
$$;

CREATE OR REPLACE FUNCTION portal_get_escalas_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, em.justificativa, em.ministerio_id,
      e.id AS escala_id, e.titulo, e.data, e.hora_inicio, e.hora_fim,
      e.local, e.tipo, e.solene, e.tem_adoracao, e.tem_bispo, e.observacoes,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    WHERE m.token_acesso = p_token
      AND e.data >= CURRENT_DATE
      AND e.status <> 'cancelada'
    ORDER BY e.data
    LIMIT 20
  ) t;
$$;

CREATE OR REPLACE FUNCTION portal_get_historico_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data DESC), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, e.titulo, e.data, e.tipo, e.solene,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor,
      hp.presenca, hp.pontos
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    LEFT JOIN historico_participacoes hp
      ON hp.escala_id = e.id AND hp.membro_id = m.id
    WHERE m.token_acesso = p_token AND e.data < CURRENT_DATE
    ORDER BY e.data DESC
    LIMIT 30
  ) t;
$$;

CREATE OR REPLACE FUNCTION portal_get_indisponibilidades_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT i.id, i.data::text AS data, i.motivo
    FROM indisponibilidades i
    JOIN membros m ON m.id = i.membro_id
    WHERE m.token_acesso = p_token AND i.data >= CURRENT_DATE
    ORDER BY i.data
  ) t;
$$;

CREATE OR REPLACE FUNCTION portal_responder_escala(
  p_token UUID, p_escala_membro_id UUID,
  p_status TEXT, p_justificativa TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id FROM membros WHERE token_acesso = p_token;
  IF v_membro_id IS NULL THEN RAISE EXCEPTION 'Token inválido'; END IF;
  UPDATE escala_membros
  SET status = p_status, justificativa = p_justificativa
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;
END;
$$;

CREATE OR REPLACE FUNCTION portal_add_indisponibilidade(
  p_token UUID, p_data DATE, p_motivo TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro RECORD; v_id UUID;
BEGIN
  SELECT id, paroquia_id INTO v_membro FROM membros WHERE token_acesso = p_token;
  IF v_membro.id IS NULL THEN RAISE EXCEPTION 'Token inválido'; END IF;
  INSERT INTO indisponibilidades (paroquia_id, membro_id, data, motivo)
  VALUES (v_membro.paroquia_id, v_membro.id, p_data, p_motivo)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION portal_remove_indisponibilidade(
  p_token UUID, p_indisp_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_membro_id UUID;
BEGIN
  SELECT id INTO v_membro_id FROM membros WHERE token_acesso = p_token;
  IF v_membro_id IS NULL THEN RAISE EXCEPTION 'Token inválido'; END IF;
  DELETE FROM indisponibilidades WHERE id = p_indisp_id AND membro_id = v_membro_id;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- BLOCO 9 — FORÇAR REFRESH DO SCHEMA CACHE DO POSTGREST
-- ════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- BLOCO 9b — GRANTS (tabelas criadas via SQL Editor precisam de grants manuais)
-- ════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated, service_role;

-- Notifica o PostgREST para recarregar o schema após as alterações
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- BLOCO 10 — VALIDAÇÃO COMPLETA
-- Rode após executar para confirmar que tudo foi criado.
-- ════════════════════════════════════════════════════════════

SELECT '━━ TABELAS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' AS secao, '' AS item, '' AS status
UNION ALL
SELECT
  'TABELA' AS secao,
  table_name AS item,
  CASE WHEN table_name IS NOT NULL THEN '✓ OK' ELSE '✗ FALTANDO' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'paroquias','profiles','user_roles',
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes',
    'comunidades','coordenadores',
    'atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes'
  )

UNION ALL
SELECT '━━ COLUNAS CRÍTICAS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' AS secao, '' AS item, '' AS status

UNION ALL
SELECT
  'COLUNA' AS secao,
  table_name || '.' || column_name AS item,
  '✓ OK' AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'paroquias'   AND column_name IN ('padroeiro','cidade','usa_tochas','usa_turibulo','usa_naveta','usa_baculifero','usa_mitrifero','regras_escala'))
    OR (table_name = 'membros'  AND column_name IN ('score','forcar_escalacao_solene','prioridade_escala','token_acesso'))
    OR (table_name = 'escalas'  AND column_name IN ('hora_inicio','hora_fim','local','tipo','status','observacoes','solene','tem_adoracao','tem_bispo','token_publico'))
    OR (table_name = 'ministerios' AND column_name IN ('icone','categoria','pontuacao_minima','exigir_experiencia','mostrar_no_portal','exclusiva_solene','exclusiva_bispo','quantidade_padrao','auto_adicionar'))
    OR (table_name = 'escala_membros' AND column_name = 'justificativa')
    OR (table_name = 'coordenadores'  AND column_name IN ('atua_como','comunidade','observacoes'))
  )

UNION ALL
SELECT '━━ FUNÇÕES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' AS secao, '' AS item, '' AS status

UNION ALL
SELECT
  'FUNCAO' AS secao,
  routine_name AS item,
  '✓ OK' AS status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'current_paroquia_id','set_updated_at','handle_new_user','recalcular_score_membro',
    'portal_get_membro','portal_get_escalas_membro','portal_get_historico_membro',
    'portal_get_indisponibilidades_membro','portal_responder_escala',
    'portal_add_indisponibilidade','portal_remove_indisponibilidade'
  )

UNION ALL
SELECT '━━ POLICIES RLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' AS secao, '' AS item, '' AS status

UNION ALL
SELECT
  'POLICY' AS secao,
  tablename || ' → ' || policyname AS item,
  '✓ OK' AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes',
    'comunidades','coordenadores',
    'atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes'
  )

ORDER BY 1, 2;
