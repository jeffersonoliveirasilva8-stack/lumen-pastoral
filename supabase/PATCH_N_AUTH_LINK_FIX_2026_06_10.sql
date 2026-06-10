-- ============================================================
-- LUMEN PASTORAL — PATCH N: Fallback RLS por email no primeiro acesso
-- Data: 2026-06-10
--
-- PROBLEMA:
--   Membros recém-aprovados acessam o portal e veem "Nenhuma
--   comunidade/atuação cadastrada" porque:
--
--   1. auth_user_id ainda NULL no momento das queries
--      (o link era feito em background — race condition).
--
--   2. profiles row nunca criada pelo fluxo de aprovação,
--      então current_paroquia_id() retorna NULL para o membro.
--
--   3. As policies de comunidades e atuacoes_pastorais dependiam
--      exclusivamente de auth_user_id = auth.uid() ou
--      current_paroquia_id(), ambos indisponíveis no primeiro acesso.
--
-- SOLUÇÃO:
--   Adicionar terceira condição nas policies: fallback por email.
--   Garante acesso mesmo quando auth_user_id ainda não foi vinculado
--   e profiles row ainda não existe.
--
--   O frontend (use-membro-auth.ts) foi corrigido para chamar
--   portal_auto_link_by_email() SINCRONAMENTE — esta patch SQL
--   é defesa em profundidade para cobrir casos extremos
--   (OTP, deep links, múltiplas abas, etc.).
--
-- IDEMPOTENTE: sim (DROP IF EXISTS antes de cada CREATE POLICY).
-- ============================================================

-- ── 1. comunidades: fallback por email ────────────────────────────────────
-- Terceira condição: membro encontrado pelo email do usuário autenticado,
-- mesmo sem auth_user_id definido (primeiro acesso via OTP).
DROP POLICY IF EXISTS "comunidades_auth_read"  ON comunidades;
DROP POLICY IF EXISTS "comunidades_anon_read"  ON comunidades;

CREATE POLICY "comunidades_anon_read" ON comunidades
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "comunidades_auth_read" ON comunidades
  FOR SELECT TO authenticated
  USING (
    -- Admin/coordenador: via profiles row
    paroquia_id = current_paroquia_id()
    -- Membro vinculado: via auth_user_id
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
    -- Membro recém-vinculado / primeiro acesso: via email (fallback)
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
        AND ativo = true
    )
  );

-- ── 2. atuacoes_pastorais: fallback por email ─────────────────────────────
DROP POLICY IF EXISTS "atuacoes_pastorais_auth_read"  ON atuacoes_pastorais;
DROP POLICY IF EXISTS "atuacoes_pastorais_anon_read"  ON atuacoes_pastorais;

CREATE POLICY "atuacoes_pastorais_anon_read" ON atuacoes_pastorais
  FOR SELECT TO anon
  USING (ativo = true);

CREATE POLICY "atuacoes_pastorais_auth_read" ON atuacoes_pastorais
  FOR SELECT TO authenticated
  USING (
    paroquia_id = current_paroquia_id()
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
        AND ativo = true
    )
  );

-- ── 3. missas_padrao: fallback por email ──────────────────────────────────
-- PATCH L criou missas_padrao_member_read (auth_user_id OR current_paroquia_id).
-- PATCH M recriou com mesma lógica. Aqui adicionamos o terceiro fallback.
DROP POLICY IF EXISTS "missas_padrao_member_read" ON missas_padrao;

CREATE POLICY "missas_padrao_member_read" ON missas_padrao
  FOR SELECT TO authenticated
  USING (
    paroquia_id = current_paroquia_id()
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros
      WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
        AND ativo = true
    )
  );

-- ── 4. Verificação ────────────────────────────────────────────────────────
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('comunidades','atuacoes_pastorais','missas_padrao')
-- ORDER BY tablename, policyname;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Membro recém-aprovado (auth_user_id NULL) consegue ler comunidades
--   ✓ Membro recém-aprovado consegue ler atuações pastorais
--   ✓ Membro recém-aprovado consegue ler missas padrão
--   ✓ Tenant isolation mantido (email match limita à paróquia do membro)
-- ─────────────────────────────────────────────────────────────────────────────
