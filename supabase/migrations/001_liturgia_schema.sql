-- ============================================================
-- Liturgia SaaS — Migração 001: Ministérios, Membros e Escalas
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── Ministérios (funções litúrgicas, configuráveis por paróquia) ──────────────
CREATE TABLE IF NOT EXISTS ministerios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  cor         TEXT NOT NULL DEFAULT '#6B7280',
  ativo       BOOLEAN NOT NULL DEFAULT true,
  ordem       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ministerios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ministerios_paroquia" ON ministerios
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── Membros / servidores ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membros (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  profile_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  nome            TEXT NOT NULL,
  email           TEXT,
  telefone        TEXT,
  data_nascimento DATE,
  data_ingresso   DATE,
  observacoes     TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membros_paroquia" ON membros
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── Membro ↔ Ministérios ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membro_ministerios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id    UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  nivel        TEXT NOT NULL DEFAULT 'ativo',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(membro_id, ministerio_id)
);

ALTER TABLE membro_ministerios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membro_ministerios_paroquia" ON membro_ministerios
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()
    )
  );

-- ── Escalas (missas / celebrações / eventos) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS escalas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  data        DATE NOT NULL,
  hora_inicio TIME,
  hora_fim    TIME,
  local       TEXT,
  tipo        TEXT NOT NULL DEFAULT 'missa',
  status      TEXT NOT NULL DEFAULT 'rascunho',
  observacoes TEXT,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE escalas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "escalas_paroquia" ON escalas
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── Funções necessárias numa escala (quantos de cada ministério) ───────────────
CREATE TABLE IF NOT EXISTS escala_funcoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  quantidade    INT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  UNIQUE(escala_id, ministerio_id)
);

ALTER TABLE escala_funcoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "escala_funcoes_paroquia" ON escala_funcoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()
    )
  );

-- ── Membros atribuídos a uma escala ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escala_membros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id     UUID NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  membro_id     UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'confirmado',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(escala_id, membro_id, ministerio_id)
);

ALTER TABLE escala_membros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "escala_membros_paroquia" ON escala_membros
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()
    )
  );

-- ── Trigger: atualiza updated_at automaticamente ─────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER ministerios_updated_at BEFORE UPDATE ON ministerios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER membros_updated_at BEFORE UPDATE ON membros
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER escalas_updated_at BEFORE UPDATE ON escalas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
