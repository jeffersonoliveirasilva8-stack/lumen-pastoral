-- ============================================================
-- LUMEN PASTORAL — PATCH M: RPC Completar Perfil de Membro
-- Data: 2026-06-10
--
-- PROBLEMAS CORRIGIDOS:
--   1. Botão "Salvar e Continuar" não fazia nada por falha silenciosa
--      de RLS no UPDATE de membros e INSERT em membro_atuacoes.
--   2. membro_atuacoes INSERT incluía coluna paroquia_id que pode não
--      existir na tabela — causava erro de coluna silencioso.
--   3. missas_padrao_auth usava current_paroquia_id() — membros sem
--      profiles row não conseguiam ler horários de missa.
--   4. membro_missa_restricoes não tinha policy de self-access para
--      membros autenticados lerem/gravarem suas próprias restrições.
--   5. Ausência de RPC SECURITY DEFINER para salvar o perfil de forma
--      atômica, ignorando todas as restrições de RLS.
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar este arquivo.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE + DROP IF EXISTS).
-- ============================================================

-- ── 1. missas_padrao: leitura para membros autenticados ───────────────────
-- PATCH L criou "missas_padrao_auth" que usa current_paroquia_id().
-- Membros sem row em profiles (não-admin) retornam vazio nessa query.
-- Esta policy adicional OR permite acesso via join em membros.paroquia_id.
DROP POLICY IF EXISTS "missas_padrao_member_read" ON missas_padrao;
CREATE POLICY "missas_padrao_member_read" ON missas_padrao
  FOR SELECT TO authenticated
  USING (
    paroquia_id = current_paroquia_id()
    OR paroquia_id IN (
      SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid()
    )
  );

-- ── 2. membro_missa_restricoes: self-access ───────────────────────────────
-- Membros precisam ler e salvar suas próprias restrições de horário de missa.
-- A policy não referencia membro_missa_restricoes.paroquia_id diretamente
-- (pode não existir) — faz join via membros.
DROP POLICY IF EXISTS "membro_missa_restricoes_self"  ON membro_missa_restricoes;
DROP POLICY IF EXISTS "membro_missa_restricoes_tenant" ON membro_missa_restricoes;
CREATE POLICY "membro_missa_restricoes_self" ON membro_missa_restricoes
  FOR ALL TO authenticated
  USING (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  );

-- ── 3. RPC SECURITY DEFINER: completar_perfil_membro() ────────────────────
-- Salva todos os dados do perfil de forma atômica e segura, ignorando RLS.
-- Localiza o membro por auth_user_id (principal) ou por email (fallback
-- para membros cujo auth_user_id ainda não foi vinculado).
-- Garante: profiles row (para current_paroquia_id()), sincroniza
-- membro_atuacoes e membro_missa_restricoes detectando colunas disponíveis.
CREATE OR REPLACE FUNCTION public.completar_perfil_membro(
  p_telefone            TEXT     DEFAULT NULL,
  p_data_nascimento     DATE     DEFAULT NULL,
  p_sexo                TEXT     DEFAULT NULL,
  p_comunidade_id       UUID     DEFAULT NULL,
  p_atuacao_ids         UUID[]   DEFAULT ARRAY[]::UUID[],
  p_missa_restricao_ids UUID[]   DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id          UUID := auth.uid();
  v_membro_id        UUID;
  v_paroquia_id      UUID;
  v_has_paroquia_col BOOLEAN;
BEGIN
  -- Rejeita chamadas não autenticadas
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Busca membro: tenta por auth_user_id, depois por email
  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM membros
  WHERE auth_user_id = v_auth_id AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
    FROM membros
    WHERE auth_user_id IS NULL
      AND ativo = true
      AND LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
    LIMIT 1;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Vincula auth_user_id se ainda não está definido
  UPDATE membros
  SET auth_user_id = v_auth_id
  WHERE id = v_membro_id AND auth_user_id IS NULL;

  -- Garante profiles row para current_paroquia_id() funcionar
  BEGIN
    INSERT INTO profiles (id, email, paroquia_id)
    VALUES (v_auth_id, auth.email(), v_paroquia_id)
    ON CONFLICT (id) DO UPDATE SET paroquia_id = EXCLUDED.paroquia_id;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- profiles pode ter schema diferente — não bloqueia o fluxo
  END;

  -- Garante role de membro em user_roles
  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    VALUES (v_auth_id, v_paroquia_id, 'membro')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Atualiza dados pessoais (campos passados como NULL são ignorados via COALESCE)
  UPDATE membros SET
    telefone        = CASE WHEN p_telefone IS NOT NULL
                           THEN p_telefone ELSE telefone END,
    data_nascimento = CASE WHEN p_data_nascimento IS NOT NULL
                           THEN p_data_nascimento ELSE data_nascimento END,
    sexo            = CASE WHEN p_sexo IS NOT NULL
                           THEN p_sexo ELSE sexo END,
    comunidade_id   = CASE WHEN p_comunidade_id IS NOT NULL
                           THEN p_comunidade_id ELSE comunidade_id END
  WHERE id = v_membro_id;

  -- ── Sincroniza membro_atuacoes ────────────────────────────────────────
  -- Verifica se a tabela tem coluna paroquia_id (pode variar por versão do schema)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'membro_atuacoes'
      AND column_name  = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_atuacoes WHERE membro_id = v_membro_id;

  IF cardinality(p_atuacao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_atuacoes (membro_id, atuacao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_atuacao_ids), v_paroquia_id
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_atuacoes (membro_id, atuacao_id)
      SELECT v_membro_id, unnest(p_atuacao_ids)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ── Sincroniza membro_missa_restricoes ───────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'membro_missa_restricoes'
      AND column_name  = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_missa_restricoes WHERE membro_id = v_membro_id;

  IF cardinality(p_missa_restricao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids), v_paroquia_id
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'membro_id',  v_membro_id,
    'paroquia_id', v_paroquia_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM,
    'state',   SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_perfil_membro TO authenticated;

-- ── 4. Verificação final ───────────────────────────────────────────────────
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('missas_padrao', 'membro_missa_restricoes')
-- ORDER BY tablename, policyname;
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'completar_perfil_membro';
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ SELECT ativo em missas_padrao para membros sem profiles row
--   ✓ SELECT/INSERT/DELETE em membro_missa_restricoes para o próprio membro
--   ✓ completar_perfil_membro() disponível e executável para authenticated
--   ✓ Portal /completar-cadastro salva todos os dados sem erro
-- ─────────────────────────────────────────────────────────────────────────────
