-- ============================================================
-- LITURGIA SaaS — Schema Completo (do zero)
-- Cole TODO este arquivo no Supabase SQL Editor e execute.
-- URL: https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- ENUM
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('super_admin', 'admin_paroquial', 'lider', 'servidor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════
-- TABELAS BASE
-- ════════════════════════════════════════════════════════════

-- paroquias (tenant raiz)
CREATE TABLE IF NOT EXISTS paroquias (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT        NOT NULL,
  slug             TEXT        NOT NULL UNIQUE,
  contato_email    TEXT,
  contato_telefone TEXT,
  cor_primaria     TEXT        DEFAULT '#7C3AED',
  diocese          TEXT,
  endereco         TEXT,
  logo_url         TEXT,
  padroeiro        TEXT,
  cidade           TEXT,
  usa_tochas       BOOLEAN     NOT NULL DEFAULT false,
  usa_turibulo     BOOLEAN     NOT NULL DEFAULT true,
  usa_naveta       BOOLEAN     NOT NULL DEFAULT true,
  usa_baculifero   BOOLEAN     NOT NULL DEFAULT true,
  usa_mitrifero    BOOLEAN     NOT NULL DEFAULT true,
  regras_escala    JSONB       NOT NULL DEFAULT '{
    "limite_semanal": null,
    "limite_mensal": null,
    "impedir_repeticao_consecutiva": false,
    "prioridade_score": true,
    "permitir_duplicidade": false,
    "peso_solene": 2,
    "peso_normal": 1
  }'::jsonb,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- profiles (um por usuário auth)
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo TEXT,
  email         TEXT,
  telefone      TEXT,
  avatar_url    TEXT,
  paroquia_id   UUID        REFERENCES paroquias(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_roles
CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        app_role    NOT NULL,
  paroquia_id UUID        REFERENCES paroquias(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role, paroquia_id)
);

-- ════════════════════════════════════════════════════════════
-- FUNÇÕES AUXILIARES
-- ════════════════════════════════════════════════════════════

-- Retorna paroquia_id do usuário atual (usada em todo RLS)
CREATE OR REPLACE FUNCTION current_paroquia_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT paroquia_id FROM profiles WHERE id = auth.uid()
$$;

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- Cria profile automaticamente quando usuário se cadastra
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, nome_completo)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger: novo usuário → profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Triggers updated_at nas tabelas base
DROP TRIGGER IF EXISTS paroquias_updated_at ON paroquias;
CREATE TRIGGER paroquias_updated_at BEFORE UPDATE ON paroquias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════
-- RLS — tabelas base
-- ════════════════════════════════════════════════════════════

ALTER TABLE paroquias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- paroquias: usuário vê e edita somente a sua
DROP POLICY IF EXISTS "paroquias_tenant" ON paroquias;
CREATE POLICY "paroquias_tenant" ON paroquias
  FOR ALL USING (id = current_paroquia_id());

-- profiles: cada usuário acessa somente o próprio
DROP POLICY IF EXISTS "profiles_own" ON profiles;
CREATE POLICY "profiles_own" ON profiles
  FOR ALL USING (id = auth.uid());

-- user_roles: vê os próprios e os da paróquia
DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles
  FOR SELECT USING (user_id = auth.uid() OR paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "user_roles_write" ON user_roles;
CREATE POLICY "user_roles_write" ON user_roles
  FOR ALL USING (paroquia_id = current_paroquia_id());

-- ════════════════════════════════════════════════════════════
-- TABELAS DE LITURGIA (001)
-- ════════════════════════════════════════════════════════════

-- ministerios
CREATE TABLE IF NOT EXISTS ministerios (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome        TEXT        NOT NULL,
  descricao   TEXT,
  cor         TEXT        NOT NULL DEFAULT '#6B7280',
  ativo       BOOLEAN     NOT NULL DEFAULT true,
  ordem       INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- membros / servidores
CREATE TABLE IF NOT EXISTS membros (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id            UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  profile_id             UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  nome                   TEXT        NOT NULL,
  email                  TEXT,
  telefone               TEXT,
  data_nascimento        DATE,
  data_ingresso          DATE,
  observacoes            TEXT,
  ativo                  BOOLEAN     NOT NULL DEFAULT true,
  score                  INT         NOT NULL DEFAULT 0,
  forcar_escalacao_solene BOOLEAN    NOT NULL DEFAULT false,
  token_acesso           UUID        DEFAULT gen_random_uuid() UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS membros_token_acesso_idx ON membros (token_acesso);

-- membro ↔ ministérios
CREATE TABLE IF NOT EXISTS membro_ministerios (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id     UUID        NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  nivel         TEXT        NOT NULL DEFAULT 'ativo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(membro_id, ministerio_id)
);

-- escalas (missas / celebrações)
CREATE TABLE IF NOT EXISTS escalas (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo       TEXT        NOT NULL,
  data         DATE        NOT NULL,
  hora_inicio  TIME,
  hora_fim     TIME,
  local        TEXT,
  tipo         TEXT        NOT NULL DEFAULT 'missa',
  status       TEXT        NOT NULL DEFAULT 'rascunho',
  observacoes  TEXT,
  solene       BOOLEAN     NOT NULL DEFAULT false,
  tem_adoracao BOOLEAN     NOT NULL DEFAULT false,
  tem_bispo    BOOLEAN     NOT NULL DEFAULT false,
  token_publico UUID       NOT NULL DEFAULT gen_random_uuid(),
  created_by   UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS escalas_token_publico_idx ON escalas(token_publico);

-- funções necessárias por escala (quantos de cada ministério)
CREATE TABLE IF NOT EXISTS escala_funcoes (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID     NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  ministerio_id UUID     NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  quantidade    INT      NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  UNIQUE(escala_id, ministerio_id)
);

-- membros atribuídos a uma escala
CREATE TABLE IF NOT EXISTS escala_membros (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID        NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  membro_id     UUID        NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pendente',
  justificativa TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(escala_id, membro_id, ministerio_id)
);

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
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id)  ON DELETE CASCADE,
  membro_id     UUID        NOT NULL REFERENCES membros(id)    ON DELETE CASCADE,
  escala_id     UUID        NOT NULL REFERENCES escalas(id)    ON DELETE CASCADE,
  ministerio_id UUID        NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS missas_padrao_paroquia_idx ON missas_padrao (paroquia_id, dia_semana, ordem);

-- funções por template de missa
CREATE TABLE IF NOT EXISTS missa_padrao_funcoes (
  id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  missa_padrao_id UUID     NOT NULL REFERENCES missas_padrao(id) ON DELETE CASCADE,
  ministerio_id   UUID     NOT NULL REFERENCES ministerios(id)   ON DELETE CASCADE,
  quantidade      SMALLINT NOT NULL DEFAULT 1,
  UNIQUE (missa_padrao_id, ministerio_id)
);

-- ════════════════════════════════════════════════════════════
-- TRIGGERS updated_at + score
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS ministerios_updated_at ON ministerios;
CREATE TRIGGER ministerios_updated_at BEFORE UPDATE ON ministerios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS membros_updated_at ON membros;
CREATE TRIGGER membros_updated_at BEFORE UPDATE ON membros
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS escalas_updated_at ON escalas;
CREATE TRIGGER escalas_updated_at BEFORE UPDATE ON escalas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Recalcula score do membro a cada inserção/update no histórico
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

DROP TRIGGER IF EXISTS historico_score_trigger ON historico_participacoes;
CREATE TRIGGER historico_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON historico_participacoes
  FOR EACH ROW EXECUTE FUNCTION recalcular_score_membro();

-- ════════════════════════════════════════════════════════════
-- RLS — tabelas de liturgia
-- ════════════════════════════════════════════════════════════

ALTER TABLE ministerios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE membros               ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_ministerios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE escala_funcoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE escala_membros        ENABLE ROW LEVEL SECURITY;
ALTER TABLE indisponibilidades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_participacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE missas_padrao         ENABLE ROW LEVEL SECURITY;
ALTER TABLE missa_padrao_funcoes  ENABLE ROW LEVEL SECURITY;

-- Políticas autenticadas (acesso por paróquia)
DROP POLICY IF EXISTS "ministerios_paroquia" ON ministerios;
CREATE POLICY "ministerios_paroquia" ON ministerios FOR ALL
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "membros_paroquia" ON membros;
CREATE POLICY "membros_paroquia" ON membros FOR ALL
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "membro_ministerios_paroquia" ON membro_ministerios;
CREATE POLICY "membro_ministerios_paroquia" ON membro_ministerios FOR ALL
  USING (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "escalas_paroquia" ON escalas;
CREATE POLICY "escalas_paroquia" ON escalas FOR ALL
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "escala_funcoes_paroquia" ON escala_funcoes;
CREATE POLICY "escala_funcoes_paroquia" ON escala_funcoes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "escala_membros_paroquia" ON escala_membros;
CREATE POLICY "escala_membros_paroquia" ON escala_membros FOR ALL
  USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id())
  );

DROP POLICY IF EXISTS "indisponibilidades_paroquia" ON indisponibilidades;
CREATE POLICY "indisponibilidades_paroquia" ON indisponibilidades FOR ALL
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "historico_paroquia" ON historico_participacoes;
CREATE POLICY "historico_paroquia" ON historico_participacoes FOR ALL
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "missas_padrao: paroquia members" ON missas_padrao;
CREATE POLICY "missas_padrao: paroquia members" ON missas_padrao FOR ALL
  USING (paroquia_id = current_paroquia_id());

DROP POLICY IF EXISTS "missa_padrao_funcoes: via missa" ON missa_padrao_funcoes;
CREATE POLICY "missa_padrao_funcoes: via missa" ON missa_padrao_funcoes FOR ALL
  USING (
    missa_padrao_id IN (
      SELECT id FROM missas_padrao WHERE paroquia_id = current_paroquia_id()
    )
  );

-- Políticas de leitura pública (portal /escala/$token sem auth)
DROP POLICY IF EXISTS "escalas_leitura_publica"        ON escalas;
DROP POLICY IF EXISTS "escala_funcoes_leitura_publica" ON escala_funcoes;
DROP POLICY IF EXISTS "escala_membros_leitura_publica" ON escala_membros;
DROP POLICY IF EXISTS "membros_leitura_publica"        ON membros;
DROP POLICY IF EXISTS "ministerios_leitura_publica"    ON ministerios;

CREATE POLICY "escalas_leitura_publica" ON escalas
  FOR SELECT USING (status = 'publicada');

CREATE POLICY "escala_funcoes_leitura_publica" ON escala_funcoes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

CREATE POLICY "escala_membros_leitura_publica" ON escala_membros
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

CREATE POLICY "membros_leitura_publica" ON membros
  FOR SELECT USING (
    ativo = true AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

CREATE POLICY "ministerios_leitura_publica" ON ministerios
  FOR SELECT USING (ativo = true);

-- ════════════════════════════════════════════════════════════
-- RPCs DO PORTAL (SECURITY DEFINER — bypass RLS, token-based)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION portal_get_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT row_to_json(t) FROM (
    SELECT
      m.id, m.nome, m.email, m.telefone, m.score, m.data_ingresso,
      m.forcar_escalacao_solene, m.paroquia_id,
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
    LEFT JOIN historico_participacoes hp ON hp.escala_id = e.id AND hp.membro_id = m.id
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
-- VALIDAÇÃO — confirma tudo criado
-- ════════════════════════════════════════════════════════════
SELECT 'TABELAS' AS bloco, table_name AS item
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'paroquias','profiles','user_roles',
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes'
  )
UNION ALL
SELECT 'FUNCOES', routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'current_paroquia_id','set_updated_at','handle_new_user',
    'recalcular_score_membro',
    'portal_get_membro','portal_get_escalas_membro','portal_get_historico_membro',
    'portal_get_indisponibilidades_membro','portal_responder_escala',
    'portal_add_indisponibilidade','portal_remove_indisponibilidade'
  )
ORDER BY 1, 2;
