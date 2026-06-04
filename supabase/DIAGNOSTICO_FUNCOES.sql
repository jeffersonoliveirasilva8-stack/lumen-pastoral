-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO — Funções, RLS e Dados
-- Execute INTEIRO no Supabase SQL Editor.
-- Idempotente — seguro executar múltiplas vezes.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. DIAGNÓSTICO — Estado atual
-- ════════════════════════════════════════════════════════════

-- Ver todas as tabelas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Ver todas as políticas RLS
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Contar ministérios/funções por paróquia
SELECT p.nome AS paroquia, COUNT(m.id) AS total_ministerios
FROM paroquias p
LEFT JOIN ministerios m ON m.paroquia_id = p.id
GROUP BY p.nome;

-- Contar membros por paróquia
SELECT p.nome AS paroquia, COUNT(mb.id) AS total_membros
FROM paroquias p
LEFT JOIN membros mb ON mb.paroquia_id = p.id
GROUP BY p.nome;

-- ════════════════════════════════════════════════════════════
-- 2. GARANTIR COLUNAS EXTRAS EM formacoes_eventos
-- ════════════════════════════════════════════════════════════

ALTER TABLE formacoes_eventos
  ADD COLUMN IF NOT EXISTS observacoes        TEXT,
  ADD COLUMN IF NOT EXISTS responsaveis_nomes TEXT,
  ADD COLUMN IF NOT EXISTS comunidade         TEXT,
  ADD COLUMN IF NOT EXISTS publico_alvo       TEXT NOT NULL DEFAULT 'todos';

-- Fix CHECK constraint para incluir encontro e compromisso
ALTER TABLE formacoes_eventos DROP CONSTRAINT IF EXISTS formacoes_eventos_tipo_check;
ALTER TABLE formacoes_eventos
  ADD CONSTRAINT formacoes_eventos_tipo_check
  CHECK (tipo IN (
    'formacao','reuniao','retiro','evento','ensaio',
    'encontro','compromisso','adoracao','outro'
  ));

-- ════════════════════════════════════════════════════════════
-- 3. GARANTIR COLUNAS EXTRAS EM ministerios (Funções Litúrgicas)
-- ════════════════════════════════════════════════════════════

ALTER TABLE ministerios
  ADD COLUMN IF NOT EXISTS categoria          TEXT,
  ADD COLUMN IF NOT EXISTS icone              TEXT,
  ADD COLUMN IF NOT EXISTS pontuacao_minima   INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exigir_experiencia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mostrar_no_portal  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quantidade_padrao  SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_adicionar     BOOLEAN NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════
-- 4. CORRIGIR RLS — Garantir acesso às funções/ministérios
-- ════════════════════════════════════════════════════════════

-- Habilitar RLS em ministerios
ALTER TABLE ministerios ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas que possam conflitar
DROP POLICY IF EXISTS "ministerios_paroquia"             ON ministerios;
DROP POLICY IF EXISTS "ministerios_leitura_publica"      ON ministerios;
DROP POLICY IF EXISTS "ministerios_rls"                  ON ministerios;
DROP POLICY IF EXISTS "ministerios_public"               ON ministerios;
DROP POLICY IF EXISTS "ministerios_read_authenticated"   ON ministerios;
DROP POLICY IF EXISTS "ministerios_admin_all"            ON ministerios;
DROP POLICY IF EXISTS "member_portal_select_ministerios" ON ministerios;

-- Política: qualquer usuário autenticado pode ler ministérios
CREATE POLICY "ministerios_read_authenticated" ON ministerios
  FOR SELECT TO authenticated
  USING (true);

-- Política: apenas admins podem criar/editar/deletar
CREATE POLICY "ministerios_admin_all" ON ministerios
  FOR ALL TO authenticated
  USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ════════════════════════════════════════════════════════════
-- 5. CORRIGIR RLS — membro_ministerios
-- ════════════════════════════════════════════════════════════

ALTER TABLE membro_ministerios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membro_ministerios_paroquia"          ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_leitura_publica"   ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_rls"               ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_public"            ON membro_ministerios;
DROP POLICY IF EXISTS "mm_read_paroquia"                     ON membro_ministerios;
DROP POLICY IF EXISTS "mm_admin_all"                         ON membro_ministerios;
DROP POLICY IF EXISTS "member_portal_select_membro_ministerios" ON membro_ministerios;

-- Qualquer autenticado pode ler (necessário para o motor de escalas)
CREATE POLICY "mm_read_authenticated" ON membro_ministerios
  FOR SELECT TO authenticated
  USING (true);

-- Apenas admins modificam
CREATE POLICY "mm_admin_all" ON membro_ministerios
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM ministerios m WHERE m.id = ministerio_id AND m.paroquia_id = current_paroquia_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM ministerios m WHERE m.id = ministerio_id AND m.paroquia_id = current_paroquia_id())
  );

-- ════════════════════════════════════════════════════════════
-- 6. CORRIGIR RLS — atuacoes_pastorais
-- ════════════════════════════════════════════════════════════

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

ALTER TABLE atuacoes_pastorais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atuacoes_pastorais_paroquia" ON atuacoes_pastorais;

CREATE POLICY "atuacoes_pastorais_paroquia" ON atuacoes_pastorais
  FOR ALL TO authenticated
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ════════════════════════════════════════════════════════════
-- 7. VERIFICAÇÃO FINAL
-- ════════════════════════════════════════════════════════════

SELECT 'ministerios' AS tabela, COUNT(*) AS politicas
FROM pg_policies WHERE tablename = 'ministerios'
UNION ALL
SELECT 'membro_ministerios', COUNT(*)
FROM pg_policies WHERE tablename = 'membro_ministerios'
UNION ALL
SELECT 'formacoes_eventos', COUNT(*)
FROM pg_policies WHERE tablename = 'formacoes_eventos'
UNION ALL
SELECT 'atuacoes_pastorais', COUNT(*)
FROM pg_policies WHERE tablename = 'atuacoes_pastorais';
