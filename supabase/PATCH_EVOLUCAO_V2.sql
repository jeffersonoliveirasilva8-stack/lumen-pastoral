-- ============================================================
-- PATCH_EVOLUCAO_V2.sql
-- Evolução da plataforma pastoral v2
-- Executar no Supabase SQL Editor
-- ============================================================

-- ── 1. Tipos de Prioridade (configurável por paróquia) ────────────────────────
CREATE TABLE IF NOT EXISTS tipos_prioridade (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  descricao       TEXT,
  peso_escala     INTEGER NOT NULL DEFAULT 1,
  frequencia_min  INTEGER,
  frequencia_max  INTEGER,
  priorizar_solenes         BOOLEAN NOT NULL DEFAULT FALSE,
  priorizar_eventos_especiais BOOLEAN NOT NULL DEFAULT FALSE,
  cor             TEXT NOT NULL DEFAULT '#6366f1',
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  ordem           INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Formações e Eventos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS formacoes_eventos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  descricao   TEXT,
  tipo        TEXT NOT NULL DEFAULT 'formacao'
              CHECK (tipo IN ('formacao','reuniao','retiro','evento','ensaio','adoracao','outro')),
  data_inicio TIMESTAMPTZ NOT NULL,
  data_fim    TIMESTAMPTZ,
  local       TEXT,
  pontuacao   INTEGER NOT NULL DEFAULT 0,
  obrigatorio BOOLEAN NOT NULL DEFAULT FALSE,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Presenças em Eventos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presencas_eventos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id         UUID NOT NULL REFERENCES formacoes_eventos(id) ON DELETE CASCADE,
  membro_id         UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  presente          BOOLEAN,
  justificativa     TEXT,
  pontuacao_recebida INTEGER,
  observacoes       TEXT,
  registrado_por    UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(evento_id, membro_id)
);

-- ── 4. Ocorrências de Escala ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocorrencias_escala (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  escala_id   UUID REFERENCES escalas(id) ON DELETE SET NULL,
  membro_id   UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  criado_por  UUID REFERENCES auth.users(id),
  tipo        TEXT NOT NULL DEFAULT 'observacao'
              CHECK (tipo IN (
                'atraso','ausencia','comportamento','troca_nao_autorizada',
                'problema_liturgico','elogio','observacao'
              )),
  descricao   TEXT,
  gravidade   TEXT NOT NULL DEFAULT 'leve'
              CHECK (gravidade IN ('leve','moderada','grave','positiva')),
  data        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Notificações ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id      UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo           TEXT NOT NULL,
  mensagem         TEXT,
  tipo             TEXT NOT NULL DEFAULT 'aviso'
                   CHECK (tipo IN ('aviso','alerta','urgente','sistema')),
  lida             BOOLEAN NOT NULL DEFAULT FALSE,
  destinatario_id  UUID REFERENCES membros(id) ON DELETE CASCADE,
  criada_por       UUID REFERENCES auth.users(id),
  link_referencia  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. Alterações em membros ──────────────────────────────────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS prioridade_id UUID REFERENCES tipos_prioridade(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipo_acesso TEXT NOT NULL DEFAULT 'membro'
    CHECK (tipo_acesso IN ('membro','auxiliar','coordenador','administrador'));

-- ── 7. Coluna pontuacao_config em paroquias ───────────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS pontuacao_config JSONB NOT NULL DEFAULT '{
    "presenca_missa": 1,
    "presenca_formacao": 2,
    "presenca_reuniao": 1,
    "presenca_retiro": 3,
    "presenca_adoracao": 1,
    "presenca_evento_especial": 2,
    "presenca_missa_solene": 2,
    "presenca_missa_bispo": 3,
    "falta_sem_justificativa": -2,
    "falta_justificada": -1,
    "atraso": -1,
    "ocorrencia_grave": -3
  }'::jsonb;

-- ── 8. Prioridades padrão para paróquias existentes ──────────────────────────
INSERT INTO tipos_prioridade
  (paroquia_id, nome, descricao, peso_escala, priorizar_solenes, cor, ordem)
SELECT
  p.id,
  t.nome,
  t.descricao,
  t.peso,
  t.solenes,
  t.cor,
  t.ordem
FROM paroquias p
CROSS JOIN (VALUES
  ('Aspirante',           'Está aprendendo, ainda não escala sozinho', 0, false, '#94a3b8', 0),
  ('Novato',              'Primeiro ano de serviço',                    1, false, '#3b82f6', 1),
  ('Comum',               'Servidor regular',                           2, false, '#6366f1', 2),
  ('Prioridade Alta',     'Servidor experiente e confiável',            3, true,  '#22c55e', 3),
  ('Coordenador',         'Lidera e coordena a equipe',                 4, true,  '#f97316', 4),
  ('Cerimoniário',        'Coordena a cerimônia litúrgica',             5, true,  '#eab308', 5),
  ('Mestre de Cerimônia', 'Responsável principal pela cerimônia',       5, true,  '#ec4899', 6),
  ('Reserva',             'Escalado apenas quando necessário',          1, false, '#6B7280', 7),
  ('Em Observação',       'Em período de avaliação pastoral',           1, false, '#f59e0b', 8)
) AS t(nome, descricao, peso, solenes, cor, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM tipos_prioridade tp WHERE tp.paroquia_id = p.id
);

-- ── 9. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tipos_prioridade_paroquia   ON tipos_prioridade(paroquia_id);
CREATE INDEX IF NOT EXISTS idx_formacoes_eventos_paroquia  ON formacoes_eventos(paroquia_id);
CREATE INDEX IF NOT EXISTS idx_formacoes_eventos_data      ON formacoes_eventos(data_inicio);
CREATE INDEX IF NOT EXISTS idx_presencas_eventos_evento    ON presencas_eventos(evento_id);
CREATE INDEX IF NOT EXISTS idx_presencas_eventos_membro    ON presencas_eventos(membro_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_escala_paroquia ON ocorrencias_escala(paroquia_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_escala_membro   ON ocorrencias_escala(membro_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_paroquia       ON notificacoes(paroquia_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_destinatario   ON notificacoes(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_membros_prioridade_id       ON membros(prioridade_id);

-- ── 10. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE tipos_prioridade ENABLE ROW LEVEL SECURITY;
ALTER TABLE formacoes_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE presencas_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencias_escala ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- tipos_prioridade
DROP POLICY IF EXISTS "tipos_prioridade_select" ON tipos_prioridade;
DROP POLICY IF EXISTS "tipos_prioridade_all" ON tipos_prioridade;

CREATE POLICY "tipos_prioridade_select" ON tipos_prioridade
  FOR SELECT USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "tipos_prioridade_all" ON tipos_prioridade
  FOR ALL USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

-- formacoes_eventos
DROP POLICY IF EXISTS "formacoes_eventos_select" ON formacoes_eventos;
DROP POLICY IF EXISTS "formacoes_eventos_all" ON formacoes_eventos;

CREATE POLICY "formacoes_eventos_select" ON formacoes_eventos
  FOR SELECT USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "formacoes_eventos_all" ON formacoes_eventos
  FOR ALL USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

-- presencas_eventos
DROP POLICY IF EXISTS "presencas_eventos_select" ON presencas_eventos;
DROP POLICY IF EXISTS "presencas_eventos_all" ON presencas_eventos;

CREATE POLICY "presencas_eventos_select" ON presencas_eventos
  FOR SELECT USING (
    evento_id IN (
      SELECT id FROM formacoes_eventos
      WHERE paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "presencas_eventos_all" ON presencas_eventos
  FOR ALL USING (
    evento_id IN (
      SELECT id FROM formacoes_eventos
      WHERE paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
    )
  );

-- ocorrencias_escala
DROP POLICY IF EXISTS "ocorrencias_escala_select" ON ocorrencias_escala;
DROP POLICY IF EXISTS "ocorrencias_escala_all" ON ocorrencias_escala;

CREATE POLICY "ocorrencias_escala_select" ON ocorrencias_escala
  FOR SELECT USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "ocorrencias_escala_all" ON ocorrencias_escala
  FOR ALL USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

-- notificacoes
DROP POLICY IF EXISTS "notificacoes_select" ON notificacoes;
DROP POLICY IF EXISTS "notificacoes_all" ON notificacoes;

CREATE POLICY "notificacoes_select" ON notificacoes
  FOR SELECT USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "notificacoes_all" ON notificacoes
  FOR ALL USING (
    paroquia_id IN (SELECT paroquia_id FROM profiles WHERE id = auth.uid())
  );

-- ── 11. Trigger updated_at em formacoes_eventos ───────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_formacoes_eventos_updated_at ON formacoes_eventos;
CREATE TRIGGER trg_formacoes_eventos_updated_at
  BEFORE UPDATE ON formacoes_eventos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
