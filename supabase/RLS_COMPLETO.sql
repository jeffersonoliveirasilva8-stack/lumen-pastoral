-- ============================================================
-- RLS COMPLETO — Políticas de segurança para todas as tabelas
-- Projeto: cusuoggmlhtvrclrzvfr
-- Execute INTEIRO no SQL Editor:
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
--
-- Seguro executar múltiplas vezes (idempotente).
-- Cobre: ENABLE RLS + DROP POLICY IF EXISTS + CREATE POLICY
-- Padrão: isolamento por paróquia via current_paroquia_id()
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1 — ENABLE ROW LEVEL SECURITY em todas as tabelas da app
-- ════════════════════════════════════════════════════════════

ALTER TABLE paroquias             ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles            ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE comunidades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordenadores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE atuacoes_pastorais    ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_atuacoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE membro_funcao_restricoes ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════
-- 2 — LIMPAR policies antigas (todos os nomes possíveis)
-- ════════════════════════════════════════════════════════════

-- paroquias
DROP POLICY IF EXISTS "paroquias_policy"           ON paroquias;
DROP POLICY IF EXISTS "paroquias_rls"              ON paroquias;
DROP POLICY IF EXISTS "paroquias_select"           ON paroquias;
DROP POLICY IF EXISTS "paroquias_update"           ON paroquias;
DROP POLICY IF EXISTS "Enable read access for own paroquia" ON paroquias;

-- profiles
DROP POLICY IF EXISTS "profiles_policy"            ON profiles;
DROP POLICY IF EXISTS "profiles_rls"               ON profiles;
DROP POLICY IF EXISTS "profiles_select"            ON profiles;
DROP POLICY IF EXISTS "profiles_update"            ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- user_roles
DROP POLICY IF EXISTS "user_roles_policy"          ON user_roles;
DROP POLICY IF EXISTS "user_roles_rls"             ON user_roles;
DROP POLICY IF EXISTS "user_roles_select"          ON user_roles;

-- ministerios
DROP POLICY IF EXISTS "ministerios_paroquia"          ON ministerios;
DROP POLICY IF EXISTS "ministerios_rls"               ON ministerios;
DROP POLICY IF EXISTS "ministerios_leitura_publica"   ON ministerios;
DROP POLICY IF EXISTS "ministerios_public"            ON ministerios;

-- membros
DROP POLICY IF EXISTS "membros_paroquia"              ON membros;
DROP POLICY IF EXISTS "membros_rls"                   ON membros;
DROP POLICY IF EXISTS "membros_leitura_publica"       ON membros;
DROP POLICY IF EXISTS "membros_public"                ON membros;

-- membro_ministerios
DROP POLICY IF EXISTS "membro_ministerios_paroquia"       ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_rls"            ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_leitura_publica" ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_public"         ON membro_ministerios;

-- escalas
DROP POLICY IF EXISTS "escalas_paroquia"              ON escalas;
DROP POLICY IF EXISTS "escalas_rls"                   ON escalas;
DROP POLICY IF EXISTS "escalas_leitura_publica"       ON escalas;
DROP POLICY IF EXISTS "escalas_public"                ON escalas;

-- escala_funcoes
DROP POLICY IF EXISTS "escala_funcoes_paroquia"       ON escala_funcoes;
DROP POLICY IF EXISTS "escala_funcoes_rls"            ON escala_funcoes;
DROP POLICY IF EXISTS "escala_funcoes_leitura_publica" ON escala_funcoes;
DROP POLICY IF EXISTS "escala_funcoes_public"         ON escala_funcoes;

-- escala_membros
DROP POLICY IF EXISTS "escala_membros_paroquia"       ON escala_membros;
DROP POLICY IF EXISTS "escala_membros_rls"            ON escala_membros;
DROP POLICY IF EXISTS "escala_membros_leitura_publica" ON escala_membros;
DROP POLICY IF EXISTS "escala_membros_public"         ON escala_membros;

-- indisponibilidades
DROP POLICY IF EXISTS "indisponibilidades_paroquia"   ON indisponibilidades;
DROP POLICY IF EXISTS "indisponibilidades_rls"        ON indisponibilidades;

-- historico_participacoes
DROP POLICY IF EXISTS "historico_paroquia"            ON historico_participacoes;
DROP POLICY IF EXISTS "historico_participacoes_rls"   ON historico_participacoes;

-- missas_padrao
DROP POLICY IF EXISTS "missas_padrao: paroquia members" ON missas_padrao;
DROP POLICY IF EXISTS "missas_padrao_paroquia"          ON missas_padrao;
DROP POLICY IF EXISTS "missas_padrao_rls"               ON missas_padrao;

-- missa_padrao_funcoes
DROP POLICY IF EXISTS "missa_padrao_funcoes: via missa" ON missa_padrao_funcoes;
DROP POLICY IF EXISTS "missa_padrao_funcoes_paroquia"   ON missa_padrao_funcoes;
DROP POLICY IF EXISTS "missa_padrao_funcoes_rls"        ON missa_padrao_funcoes;

-- comunidades
DROP POLICY IF EXISTS "comunidades_select"            ON comunidades;
DROP POLICY IF EXISTS "comunidades_insert"            ON comunidades;
DROP POLICY IF EXISTS "comunidades_update"            ON comunidades;
DROP POLICY IF EXISTS "comunidades_delete"            ON comunidades;
DROP POLICY IF EXISTS "comunidades_paroquia"          ON comunidades;
DROP POLICY IF EXISTS "comunidades_rls"               ON comunidades;

-- coordenadores
DROP POLICY IF EXISTS "coordenadores_select"          ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_insert"          ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_update"          ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_delete"          ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_paroquia"        ON coordenadores;
DROP POLICY IF EXISTS "coordenadores_rls"             ON coordenadores;

-- atuacoes_pastorais
DROP POLICY IF EXISTS "atuacoes_pastorais_paroquia"   ON atuacoes_pastorais;
DROP POLICY IF EXISTS "atuacoes_pastorais_rls"        ON atuacoes_pastorais;

-- membro_atuacoes
DROP POLICY IF EXISTS "membro_atuacoes_paroquia"      ON membro_atuacoes;
DROP POLICY IF EXISTS "membro_atuacoes_rls"           ON membro_atuacoes;

-- membro_funcao_restricoes
DROP POLICY IF EXISTS "membro_funcao_restricoes_paroquia" ON membro_funcao_restricoes;
DROP POLICY IF EXISTS "membro_funcao_restricoes_rls"      ON membro_funcao_restricoes;

-- ════════════════════════════════════════════════════════════
-- 3 — CRIAR POLICIES
--
-- Padrão para tabelas com paroquia_id direto:
--   USING  (paroquia_id = current_paroquia_id())   ← SELECT/UPDATE/DELETE
--   WITH CHECK (paroquia_id = current_paroquia_id()) ← INSERT/UPDATE
--
-- Padrão para tabelas sem paroquia_id (junction tables):
--   EXISTS (...parent com paroquia_id = current_paroquia_id())
--
-- current_paroquia_id() retorna NULL para anon → nega acesso automaticamente
-- Políticas de leitura pública são separadas e explícitas
-- ════════════════════════════════════════════════════════════

-- ── paroquias ─────────────────────────────────────────────────────────────────
-- Usuário vê e edita apenas a própria paróquia

CREATE POLICY "paroquias_rls" ON paroquias
  FOR ALL
  USING  (id = current_paroquia_id())
  WITH CHECK (id = current_paroquia_id());

-- ── profiles ──────────────────────────────────────────────────────────────────
-- Usuário vê e edita apenas o próprio perfil

CREATE POLICY "profiles_rls" ON profiles
  FOR ALL
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── user_roles ────────────────────────────────────────────────────────────────
-- Admin vê e gerencia roles da própria paróquia

CREATE POLICY "user_roles_rls" ON user_roles
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── ministerios ───────────────────────────────────────────────────────────────
-- Autenticado: CRUD na própria paróquia
-- Público (portal): leitura de funções ativas

CREATE POLICY "ministerios_rls" ON ministerios
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE POLICY "ministerios_public" ON ministerios
  FOR SELECT
  USING (auth.uid() IS NULL AND ativo = true);

-- ── membros ───────────────────────────────────────────────────────────────────
-- Autenticado: CRUD na própria paróquia
-- Público (portal): leitura de membros em escalas publicadas

CREATE POLICY "membros_rls" ON membros
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE POLICY "membros_public" ON membros
  FOR SELECT
  USING (
    auth.uid() IS NULL
    AND ativo = true
    AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

-- ── membro_ministerios ────────────────────────────────────────────────────────
-- Isolado via membros.paroquia_id

CREATE POLICY "membro_ministerios_rls" ON membro_ministerios
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

CREATE POLICY "membro_ministerios_public" ON membro_ministerios
  FOR SELECT
  USING (
    auth.uid() IS NULL AND
    EXISTS (
      SELECT 1 FROM membros m
      JOIN escala_membros em ON em.membro_id = m.id
      JOIN escalas e ON e.id = em.escala_id
      WHERE m.id = membro_id AND e.status = 'publicada'
    )
  );

-- ── escalas ───────────────────────────────────────────────────────────────────
-- Autenticado: CRUD na própria paróquia
-- Público: leitura de escalas publicadas

CREATE POLICY "escalas_rls" ON escalas
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE POLICY "escalas_public" ON escalas
  FOR SELECT
  USING (auth.uid() IS NULL AND status = 'publicada');

-- ── escala_funcoes ────────────────────────────────────────────────────────────
-- Isolado via escalas.paroquia_id

CREATE POLICY "escala_funcoes_rls" ON escala_funcoes
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

CREATE POLICY "escala_funcoes_public" ON escala_funcoes
  FOR SELECT
  USING (
    auth.uid() IS NULL AND
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  );

-- ── escala_membros ────────────────────────────────────────────────────────────
-- Isolado via escalas.paroquia_id

CREATE POLICY "escala_membros_rls" ON escala_membros
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

CREATE POLICY "escala_membros_public" ON escala_membros
  FOR SELECT
  USING (
    auth.uid() IS NULL AND
    EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  );

-- ── indisponibilidades ────────────────────────────────────────────────────────

CREATE POLICY "indisponibilidades_rls" ON indisponibilidades
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── historico_participacoes ───────────────────────────────────────────────────

CREATE POLICY "historico_participacoes_rls" ON historico_participacoes
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── missas_padrao ─────────────────────────────────────────────────────────────

CREATE POLICY "missas_padrao_rls" ON missas_padrao
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── missa_padrao_funcoes ──────────────────────────────────────────────────────
-- Isolado via missas_padrao.paroquia_id

CREATE POLICY "missa_padrao_funcoes_rls" ON missa_padrao_funcoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM missas_padrao mp
      WHERE mp.id = missa_padrao_id AND mp.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM missas_padrao mp
      WHERE mp.id = missa_padrao_id AND mp.paroquia_id = current_paroquia_id()
    )
  );

-- ── comunidades ───────────────────────────────────────────────────────────────

CREATE POLICY "comunidades_rls" ON comunidades
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── coordenadores ─────────────────────────────────────────────────────────────

CREATE POLICY "coordenadores_rls" ON coordenadores
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── atuacoes_pastorais ────────────────────────────────────────────────────────

CREATE POLICY "atuacoes_pastorais_rls" ON atuacoes_pastorais
  FOR ALL
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── membro_atuacoes ───────────────────────────────────────────────────────────
-- Isolado via membros.paroquia_id

CREATE POLICY "membro_atuacoes_rls" ON membro_atuacoes
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

-- ── membro_funcao_restricoes ──────────────────────────────────────────────────
-- Isolado via membros.paroquia_id

CREATE POLICY "membro_funcao_restricoes_rls" ON membro_funcao_restricoes
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

-- ════════════════════════════════════════════════════════════
-- 4 — RECARREGAR SCHEMA DO POSTGREST
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- 5 — VALIDAÇÃO: confirmar RLS e policies criadas
-- ════════════════════════════════════════════════════════════

SELECT
  c.relname                          AS tabela,
  c.relrowsecurity                   AS rls_ativo,
  COUNT(p.policyname)                AS qtd_policies,
  string_agg(p.policyname, ' | ' ORDER BY p.policyname) AS policies
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'paroquias','profiles','user_roles',
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes',
    'comunidades','coordenadores',
    'atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
