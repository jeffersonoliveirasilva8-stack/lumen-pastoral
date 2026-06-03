-- ============================================================
-- RECUPERAÇÃO DE EMERGÊNCIA
-- Execute INTEIRO no SQL Editor do Supabase agora:
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
--
-- O que aconteceu: RLS foi ativado mas as políticas falharam
-- porque a função current_paroquia_id() não existia ainda.
-- RLS ativo + sem políticas = nenhum dado visível.
-- Os dados NÃO foram apagados.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASSO 1 — Criar/recriar a função central do RLS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION current_paroquia_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT paroquia_id FROM profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION current_paroquia_id TO authenticated;
GRANT EXECUTE ON FUNCTION current_paroquia_id TO anon;

-- ════════════════════════════════════════════════════════════
-- PASSO 2 — Verificar se o seu usuário admin tem perfil
--           (rode e verifique que retorna linha com paroquia_id preenchido)
-- ════════════════════════════════════════════════════════════

SELECT
  p.id,
  p.email,
  p.paroquia_id,
  par.nome AS paroquia_nome,
  auth.uid() AS seu_uid
FROM profiles p
LEFT JOIN paroquias par ON par.id = p.paroquia_id
WHERE p.id = auth.uid();

-- ════════════════════════════════════════════════════════════
-- PASSO 3 — Recriar TODAS as políticas de acesso
-- (as mesmas do RLS_COMPLETO.sql — agora a função existe)
-- ════════════════════════════════════════════════════════════

-- ── Limpar políticas existentes ───────────────────────────────
-- (idempotente — IF EXISTS garante segurança)
DROP POLICY IF EXISTS "paroquias_rls"              ON paroquias;
DROP POLICY IF EXISTS "profiles_rls"               ON profiles;
DROP POLICY IF EXISTS "user_roles_rls"             ON user_roles;
DROP POLICY IF EXISTS "ministerios_rls"            ON ministerios;
DROP POLICY IF EXISTS "ministerios_public"         ON ministerios;
DROP POLICY IF EXISTS "membros_rls"                ON membros;
DROP POLICY IF EXISTS "membros_public"             ON membros;
DROP POLICY IF EXISTS "membro_ministerios_rls"     ON membro_ministerios;
DROP POLICY IF EXISTS "membro_ministerios_public"  ON membro_ministerios;
DROP POLICY IF EXISTS "escalas_rls"                ON escalas;
DROP POLICY IF EXISTS "escalas_public"             ON escalas;
DROP POLICY IF EXISTS "escala_funcoes_rls"         ON escala_funcoes;
DROP POLICY IF EXISTS "escala_funcoes_public"      ON escala_funcoes;
DROP POLICY IF EXISTS "escala_membros_rls"         ON escala_membros;
DROP POLICY IF EXISTS "escala_membros_public"      ON escala_membros;
DROP POLICY IF EXISTS "indisponibilidades_rls"     ON indisponibilidades;
DROP POLICY IF EXISTS "historico_participacoes_rls" ON historico_participacoes;
DROP POLICY IF EXISTS "missas_padrao_rls"          ON missas_padrao;
DROP POLICY IF EXISTS "missa_padrao_funcoes_rls"   ON missa_padrao_funcoes;
DROP POLICY IF EXISTS "comunidades_rls"            ON comunidades;
DROP POLICY IF EXISTS "coordenadores_rls"          ON coordenadores;
DROP POLICY IF EXISTS "atuacoes_pastorais_rls"     ON atuacoes_pastorais;
DROP POLICY IF EXISTS "membro_atuacoes_rls"        ON membro_atuacoes;
DROP POLICY IF EXISTS "membro_funcao_restricoes_rls" ON membro_funcao_restricoes;
-- Políticas de membro do portal
DROP POLICY IF EXISTS "membro_self_link"           ON membros;
DROP POLICY IF EXISTS "membro_read_own"            ON membros;

-- ── paroquias ──────────────────────────────────────────────────
CREATE POLICY "paroquias_rls" ON paroquias
  FOR ALL USING (id = current_paroquia_id())
  WITH CHECK (id = current_paroquia_id());

-- ── profiles ───────────────────────────────────────────────────
CREATE POLICY "profiles_rls" ON profiles
  FOR ALL USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── user_roles ─────────────────────────────────────────────────
CREATE POLICY "user_roles_rls" ON user_roles
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── ministerios ────────────────────────────────────────────────
CREATE POLICY "ministerios_rls" ON ministerios
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE POLICY "ministerios_public" ON ministerios
  FOR SELECT USING (auth.uid() IS NULL AND ativo = true);

-- ── membros ────────────────────────────────────────────────────
CREATE POLICY "membros_rls" ON membros
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- Portal do membro: leitura do próprio registro por auth_user_id ou email
CREATE POLICY "membro_read_own" ON membros
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),'')))
  );

-- Portal do membro: vinculação de auth_user_id
CREATE POLICY "membro_self_link" ON membros
  FOR UPDATE TO authenticated
  USING (lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
  WITH CHECK (auth_user_id = auth.uid() OR auth_user_id IS NULL);

-- Portal público (escala.$token): leitura de membros em escalas publicadas
CREATE POLICY "membros_public" ON membros
  FOR SELECT USING (
    auth.uid() IS NULL AND ativo = true
    AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

-- ── membro_ministerios ─────────────────────────────────────────
CREATE POLICY "membro_ministerios_rls" ON membro_ministerios
  FOR ALL
  USING (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()));

CREATE POLICY "membro_ministerios_public" ON membro_ministerios
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (SELECT 1 FROM membros m JOIN escala_membros em ON em.membro_id = m.id
            JOIN escalas e ON e.id = em.escala_id
            WHERE m.id = membro_id AND e.status = 'publicada')
  );

-- ── escalas ────────────────────────────────────────────────────
CREATE POLICY "escalas_rls" ON escalas
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

CREATE POLICY "escalas_public" ON escalas
  FOR SELECT USING (auth.uid() IS NULL AND status = 'publicada');

-- ── escala_funcoes ─────────────────────────────────────────────
CREATE POLICY "escala_funcoes_rls" ON escala_funcoes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()));

CREATE POLICY "escala_funcoes_public" ON escala_funcoes
  FOR SELECT USING (auth.uid() IS NULL AND EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada'));

-- ── escala_membros ─────────────────────────────────────────────
CREATE POLICY "escala_membros_rls" ON escala_membros
  FOR ALL
  USING (EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.paroquia_id = current_paroquia_id()));

CREATE POLICY "escala_membros_public" ON escala_membros
  FOR SELECT USING (auth.uid() IS NULL AND EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada'));

-- ── indisponibilidades ─────────────────────────────────────────
CREATE POLICY "indisponibilidades_rls" ON indisponibilidades
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── historico_participacoes ────────────────────────────────────
CREATE POLICY "historico_participacoes_rls" ON historico_participacoes
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── missas_padrao ──────────────────────────────────────────────
CREATE POLICY "missas_padrao_rls" ON missas_padrao
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── missa_padrao_funcoes ───────────────────────────────────────
CREATE POLICY "missa_padrao_funcoes_rls" ON missa_padrao_funcoes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM missas_padrao mp WHERE mp.id = missa_padrao_id AND mp.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM missas_padrao mp WHERE mp.id = missa_padrao_id AND mp.paroquia_id = current_paroquia_id()));

-- ── comunidades ────────────────────────────────────────────────
CREATE POLICY "comunidades_rls" ON comunidades
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── coordenadores ──────────────────────────────────────────────
CREATE POLICY "coordenadores_rls" ON coordenadores
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── atuacoes_pastorais ─────────────────────────────────────────
CREATE POLICY "atuacoes_pastorais_rls" ON atuacoes_pastorais
  FOR ALL USING (paroquia_id = current_paroquia_id())
  WITH CHECK (paroquia_id = current_paroquia_id());

-- ── membro_atuacoes ────────────────────────────────────────────
CREATE POLICY "membro_atuacoes_rls" ON membro_atuacoes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()));

-- ── membro_funcao_restricoes ───────────────────────────────────
CREATE POLICY "membro_funcao_restricoes_rls" ON membro_funcao_restricoes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM membros m WHERE m.id = membro_id AND m.paroquia_id = current_paroquia_id()));

-- ════════════════════════════════════════════════════════════
-- PASSO 4 — Verificação: você deve ver seus membros e escalas
-- ════════════════════════════════════════════════════════════

SELECT 'membros' AS tabela, count(*) AS total FROM membros
UNION ALL
SELECT 'escalas', count(*) FROM escalas
UNION ALL
SELECT 'escala_membros', count(*) FROM escala_membros;

-- ════════════════════════════════════════════════════════════
-- PASSO 5 — Notificar PostgREST para recarregar schema
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
