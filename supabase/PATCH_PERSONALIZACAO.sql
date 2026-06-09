-- ============================================================
-- PATCH: Personalização — Comunidades, Coordenadores e extensões de Ministérios
-- Cole no Supabase SQL Editor e execute.
-- URL: https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- 1. Tabela: comunidades
CREATE TABLE IF NOT EXISTS comunidades (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  tipo          TEXT        NOT NULL DEFAULT 'comunidade'
                            CHECK (tipo IN ('matriz', 'capela', 'comunidade', 'santuario')),
  endereco      TEXT,
  responsavel   TEXT,
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE comunidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comunidades_select" ON comunidades FOR SELECT
  USING (paroquia_id = current_paroquia_id());
CREATE POLICY "comunidades_insert" ON comunidades FOR INSERT
  WITH CHECK (paroquia_id = current_paroquia_id());
CREATE POLICY "comunidades_update" ON comunidades FOR UPDATE
  USING (paroquia_id = current_paroquia_id());
CREATE POLICY "comunidades_delete" ON comunidades FOR DELETE
  USING (paroquia_id = current_paroquia_id());

CREATE TRIGGER set_comunidades_updated_at
  BEFORE UPDATE ON comunidades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Tabela: coordenadores
CREATE TABLE IF NOT EXISTS coordenadores (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id     UUID        NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  membro_id       UUID        REFERENCES membros(id) ON DELETE SET NULL,
  nome            TEXT        NOT NULL,
  funcao_pastoral TEXT,
  email           TEXT,
  telefone        TEXT,
  ativo           BOOLEAN     NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE coordenadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coordenadores_select" ON coordenadores FOR SELECT
  USING (paroquia_id = current_paroquia_id());
CREATE POLICY "coordenadores_insert" ON coordenadores FOR INSERT
  WITH CHECK (paroquia_id = current_paroquia_id());
CREATE POLICY "coordenadores_update" ON coordenadores FOR UPDATE
  USING (paroquia_id = current_paroquia_id());
CREATE POLICY "coordenadores_delete" ON coordenadores FOR DELETE
  USING (paroquia_id = current_paroquia_id());

CREATE TRIGGER set_coordenadores_updated_at
  BEFORE UPDATE ON coordenadores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Estender tabela ministerios com campos de Funções Litúrgicas
ALTER TABLE ministerios
  ADD COLUMN IF NOT EXISTS categoria         TEXT,
  ADD COLUMN IF NOT EXISTS icone             TEXT,
  ADD COLUMN IF NOT EXISTS pontuacao_minima  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exigir_experiencia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mostrar_no_portal  BOOLEAN NOT NULL DEFAULT true;

-- Validação
SELECT 'comunidades'   AS tabela, COUNT(*) AS politicas FROM pg_policies WHERE tablename = 'comunidades'
UNION ALL
SELECT 'coordenadores' AS tabela, COUNT(*) AS politicas FROM pg_policies WHERE tablename = 'coordenadores'
UNION ALL
SELECT 'ministerios_cols' AS tabela,
       COUNT(*) AS politicas
FROM information_schema.columns
WHERE table_name = 'ministerios'
  AND column_name IN ('categoria','icone','pontuacao_minima','exigir_experiencia','mostrar_no_portal');
