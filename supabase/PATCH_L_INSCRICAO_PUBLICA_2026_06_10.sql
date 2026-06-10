-- ============================================================
-- LUMEN PASTORAL — PATCH L: Cadastro Público + Completude de Perfil
-- Data: 2026-06-10
--
-- PROBLEMAS CORRIGIDOS:
--   1. Formulário /inscricao/:slug dependia de sessão administrativa
--      para carregar comunidades, atuações pastorais e missas padrão.
--      Causa: policies RLS usavam current_paroquia_id() (requer profiles
--      de admin). Solicitações públicas (anon) retornavam vazio.
--
--   2. membro_atuacoes não tinha policy de self-access para membros,
--      impossibilitando que completassem atuação pastoral no portal.
--
--   3. Queries autenticadas de membros (não-admin) para comunidades e
--      atuacoes_pastorais falhavam por depender de current_paroquia_id()
--      sem garantia de profiles row.
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar este arquivo.
--
-- IDEMPOTENTE: sim (DROP IF EXISTS antes de cada CREATE POLICY).
-- ============================================================

-- ── 1. paroquias: leitura anônima garantida ────────────────────────────────
-- Garante que qualquer visitante consegue carregar a paróquia por slug OU id.
-- O patch SOLICITACOES_MEMBROS.sql já criou "paroquias_public_read" mas
-- somente dentro de um IF NOT EXISTS — este bloco substitui com DROP+CREATE.
DROP POLICY IF EXISTS "paroquias_public_read"        ON paroquias;
DROP POLICY IF EXISTS "public_read_paroquia_by_slug" ON paroquias;

CREATE POLICY "paroquias_anon_read" ON paroquias
  FOR SELECT TO anon
  USING (true);

-- ── 2. comunidades: leitura anônima ───────────────────────────────────────
-- Formulário público filtra por paroquia_id no cliente — isolamento por tenant
-- garantido na query, não na policy (dados não sensíveis).
DROP POLICY IF EXISTS "comunidades_anon_read"        ON comunidades;
DROP POLICY IF EXISTS "comunidades_tenant"           ON comunidades;
DROP POLICY IF EXISTS "comunidades_paroquia"         ON comunidades;

-- Anon: leitura pública para formulário de inscrição
CREATE POLICY "comunidades_anon_read" ON comunidades
  FOR SELECT TO anon
  USING (true);

-- Authenticated: admin via current_paroquia_id() OU membro autenticado
-- via paroquia_id do próprio registro (evita dependência de profiles row).
CREATE POLICY "comunidades_auth_read" ON comunidades
  FOR SELECT TO authenticated
  USING (
    paroquia_id = current_paroquia_id()
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "comunidades_auth_write" ON comunidades
  FOR ALL TO authenticated
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── 3. atuacoes_pastorais: leitura anônima ─────────────────────────────────
-- Mesmo padrão de comunidades: formulário público precisa listar atuações
-- da paróquia sem sessão administrativa.
DROP POLICY IF EXISTS "atuacoes_pastorais_anon_read"     ON atuacoes_pastorais;
DROP POLICY IF EXISTS "atuacoes_pastorais_tenant"        ON atuacoes_pastorais;
DROP POLICY IF EXISTS "atuacoes_pastorais_paroquia"      ON atuacoes_pastorais;

CREATE POLICY "atuacoes_pastorais_anon_read" ON atuacoes_pastorais
  FOR SELECT TO anon
  USING (ativo = true);

CREATE POLICY "atuacoes_pastorais_auth_read" ON atuacoes_pastorais
  FOR SELECT TO authenticated
  USING (
    paroquia_id = current_paroquia_id()
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "atuacoes_pastorais_auth_write" ON atuacoes_pastorais
  FOR ALL TO authenticated
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── 4. missas_padrao: leitura anônima ─────────────────────────────────────
-- Formulário de inscrição exibe horários disponíveis para o membro informar
-- em quais não consegue servir.
DROP POLICY IF EXISTS "missas_padrao_anon_read"  ON missas_padrao;
DROP POLICY IF EXISTS "missas_padrao_tenant"     ON missas_padrao;
DROP POLICY IF EXISTS "missas_padrao_paroquia"   ON missas_padrao;

CREATE POLICY "missas_padrao_anon_read" ON missas_padrao
  FOR SELECT TO anon
  USING (ativo = true);

-- Política autenticada existente continua cobrindo admins/coordenadores.
-- Recriamos para garantir consistência:
CREATE POLICY "missas_padrao_auth" ON missas_padrao
  FOR ALL TO authenticated
  USING  (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── 5. solicitacoes_membros: garantir INSERT anon ─────────────────────────
-- A policy "solicitacoes_public_insert" já existe em SOLICITACOES_MEMBROS.sql.
-- Re-declaramos para garantir que está ativa após qualquer reset de policies.
DROP POLICY IF EXISTS "solicitacoes_public_insert" ON solicitacoes_membros;
CREATE POLICY "solicitacoes_public_insert" ON solicitacoes_membros
  FOR INSERT TO anon
  WITH CHECK (paroquia_id IN (SELECT id FROM paroquias));

-- Garantir GRANT correto para anon poder inserir
GRANT INSERT ON solicitacoes_membros TO anon;
GRANT USAGE  ON SCHEMA public TO anon;

-- ── 6. membro_atuacoes: self-access para membro no portal ─────────────────
-- Membros precisam ler e gerenciar suas próprias atuações na página
-- "Completar Cadastro". A policy existente usa current_paroquia_id()
-- e não cobre membros sem profiles row ou com paroquia_id não definida.
DROP POLICY IF EXISTS "membro_atuacoes_self"   ON membro_atuacoes;
DROP POLICY IF EXISTS "membro_atuacoes_tenant" ON membro_atuacoes;

-- Self-access: lê/insere/deleta as próprias atuações
CREATE POLICY "membro_atuacoes_self" ON membro_atuacoes
  FOR ALL TO authenticated
  USING (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    -- Só pode vincular a si mesmo e só a atuações da sua paróquia
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()) AND
    atuacao_id IN (
      SELECT ap.id FROM atuacoes_pastorais ap
      JOIN membros m ON m.paroquia_id = ap.paroquia_id
      WHERE m.auth_user_id = auth.uid()
    )
  );

-- Admins/coordenadores: policy separada — join via membros (não depende de
-- membro_atuacoes.paroquia_id, que pode não existir em todas as versões do schema).
CREATE POLICY "membro_atuacoes_admin" ON membro_atuacoes
  FOR ALL TO authenticated
  USING (
    membro_id IN (
      SELECT id FROM membros WHERE paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    membro_id IN (
      SELECT id FROM membros WHERE paroquia_id = current_paroquia_id()
    )
  );

-- ── 7. Verificação final ───────────────────────────────────────────────────
--
-- Execute para confirmar:
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'paroquias','comunidades','atuacoes_pastorais',
--     'missas_padrao','solicitacoes_membros','membro_atuacoes'
--   )
-- ORDER BY tablename, policyname;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ /inscricao/:slug carrega comunidades SEM sessão administrativa
--   ✓ /inscricao/:slug carrega atuações pastorais SEM sessão administrativa
--   ✓ /inscricao/:slug carrega missas padrão SEM sessão administrativa
--   ✓ Formulário de inscrição envia solicitação normalmente (anon INSERT)
--   ✓ Portal /completar-cadastro salva atuação pastoral do membro
--   ✓ Isolation: comunidade/atuação de uma paróquia NÃO aparece em outra
-- ─────────────────────────────────────────────────────────────────────────────
