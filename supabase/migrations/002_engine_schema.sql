-- ============================================================
-- Liturgia SaaS — Migração 002: Engine de Escalas
-- Execute APÓS 001_liturgia_schema.sql no SQL Editor do Supabase
-- ============================================================

-- ── Novas colunas em paroquias ────────────────────────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS usa_tochas BOOLEAN NOT NULL DEFAULT false;

-- ── Novas colunas em membros ──────────────────────────────────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forcar_escalacao_solene BOOLEAN NOT NULL DEFAULT false;

-- ── Novas colunas em escalas ──────────────────────────────────────────────────
ALTER TABLE escalas
  ADD COLUMN IF NOT EXISTS solene        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_adoracao  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_bispo     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_publico UUID    NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS escalas_token_publico_idx ON escalas(token_publico);

-- ── Indisponibilidades ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indisponibilidades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  membro_id   UUID NOT NULL REFERENCES membros(id)   ON DELETE CASCADE,
  data        DATE NOT NULL,
  motivo      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE indisponibilidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "indisponibilidades_paroquia" ON indisponibilidades
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── Histórico de participações ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historico_participacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID NOT NULL REFERENCES paroquias(id)    ON DELETE CASCADE,
  membro_id     UUID NOT NULL REFERENCES membros(id)       ON DELETE CASCADE,
  escala_id     UUID NOT NULL REFERENCES escalas(id)       ON DELETE CASCADE,
  ministerio_id UUID NOT NULL REFERENCES ministerios(id)   ON DELETE CASCADE,
  presenca      TEXT NOT NULL DEFAULT 'confirmado',
  data          DATE NOT NULL,
  pontos        INT  NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(membro_id, escala_id, ministerio_id)
);

ALTER TABLE historico_participacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historico_paroquia" ON historico_participacoes
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── Leitura pública para portal do acólito ────────────────────────────────────
-- Permite leitura anônima de escalas publicadas (sem auth)

CREATE POLICY "escalas_leitura_publica" ON escalas
  FOR SELECT
  USING (status = 'publicada');

CREATE POLICY "escala_funcoes_leitura_publica" ON escala_funcoes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  );

CREATE POLICY "escala_membros_leitura_publica" ON escala_membros
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  );

CREATE POLICY "membros_leitura_publica" ON membros
  FOR SELECT
  USING (
    ativo = true AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

CREATE POLICY "ministerios_leitura_publica" ON ministerios
  FOR SELECT
  USING (ativo = true);

-- ── Trigger: atualizar score do membro ao registrar participação ───────────────
CREATE OR REPLACE FUNCTION recalcular_score_membro()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE membros
  SET score = (
    SELECT COALESCE(SUM(pontos), 0)
    FROM historico_participacoes
    WHERE membro_id = NEW.membro_id
      AND presenca = 'confirmado'
  )
  WHERE id = NEW.membro_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER historico_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON historico_participacoes
  FOR EACH ROW EXECUTE FUNCTION recalcular_score_membro();
