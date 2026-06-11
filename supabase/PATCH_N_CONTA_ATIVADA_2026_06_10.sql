-- ============================================================
-- LUMEN PASTORAL — PATCH N: Senha Obrigatória + Status da Conta
-- Data: 2026-06-10
--
-- PROBLEMAS CORRIGIDOS:
--   1. Membros acessavam o portal sem nunca terem criado uma senha
--      própria — dependiam de magic link a cada login.
--   2. Coordenação não conseguia ver em qual etapa cada membro estava
--      (ativação pendente / cadastro incompleto / ativo).
--   3. completar_perfil_membro() não marcava perfil_completo no banco,
--      impossibilitando exibir status real no painel admin.
--
-- NOVO FLUXO:
--   Aprovação → e-mail de ativação → /membro/ativar-conta (cria senha)
--   → /portal-membro/completar-cadastro → /portal-membro/home
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar este arquivo.
--
-- IDEMPOTENTE: sim (ALTER TABLE IF NOT EXISTS + CREATE OR REPLACE).
-- ============================================================

-- ── 1. Novas colunas em membros ────────────────────────────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS conta_ativada      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perfil_completo    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ativacao_enviada_em TIMESTAMPTZ;

-- ── 2. Migração: preserva acesso de membros que já usavam o sistema ────────
-- Membros já vinculados ao auth já ativaram (magic link ou login anterior).
UPDATE membros
SET conta_ativada = true
WHERE auth_user_id IS NOT NULL;

-- Membros com dados mínimos preenchidos = perfil já completo.
UPDATE membros
SET perfil_completo = true
WHERE conta_ativada = true
  AND telefone IS NOT NULL
  AND data_nascimento IS NOT NULL
  AND sexo IS NOT NULL
  AND comunidade_id IS NOT NULL;

-- ── 3. RPC ativar_conta_membro() ──────────────────────────────────────────
-- Chamado pelo frontend em /membro/ativar-conta após updateUser({ password }).
-- Define conta_ativada = true e garante auth_user_id vinculado.
CREATE OR REPLACE FUNCTION public.ativar_conta_membro()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Tenta por auth_user_id (membro já vinculado)
  UPDATE membros
  SET conta_ativada = true
  WHERE auth_user_id = v_auth_id AND ativo = true
  RETURNING id INTO v_membro_id;

  -- Fallback por email (primeiro acesso, auth_user_id ainda não está definido)
  IF v_membro_id IS NULL THEN
    UPDATE membros
    SET conta_ativada = true,
        auth_user_id  = v_auth_id
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
      AND ativo = true
    RETURNING id INTO v_membro_id;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Garante profiles row para current_paroquia_id() funcionar
  BEGIN
    INSERT INTO profiles (id, email, paroquia_id)
    SELECT v_auth_id, auth.email(), paroquia_id
    FROM membros WHERE id = v_membro_id
    ON CONFLICT (id) DO UPDATE
      SET paroquia_id = EXCLUDED.paroquia_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Garante role de membro em user_roles
  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    SELECT v_auth_id, paroquia_id, 'membro'
    FROM membros WHERE id = v_membro_id
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ativar_conta_membro TO authenticated;

-- ── 4. completar_perfil_membro() — versão atualizada (marca perfil_completo) ──
-- Substitui a versão do PATCH_M adicionando: UPDATE membros SET perfil_completo = true
CREATE OR REPLACE FUNCTION public.completar_perfil_membro(
  p_telefone               TEXT     DEFAULT NULL,
  p_data_nascimento        DATE     DEFAULT NULL,
  p_sexo                   TEXT     DEFAULT NULL,
  p_comunidade_id          UUID     DEFAULT NULL,
  p_atuacao_ids            UUID[]   DEFAULT ARRAY[]::UUID[],
  p_missa_restricao_ids    UUID[]   DEFAULT ARRAY[]::UUID[],
  p_motivo_disponibilidade TEXT     DEFAULT NULL
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
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

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

  UPDATE membros SET auth_user_id = v_auth_id
  WHERE id = v_membro_id AND auth_user_id IS NULL;

  BEGIN
    INSERT INTO profiles (id, email, paroquia_id)
    VALUES (v_auth_id, auth.email(), v_paroquia_id)
    ON CONFLICT (id) DO UPDATE SET paroquia_id = EXCLUDED.paroquia_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    VALUES (v_auth_id, v_paroquia_id, 'membro')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  UPDATE membros SET
    telefone               = CASE WHEN p_telefone IS NOT NULL               THEN p_telefone               ELSE telefone               END,
    data_nascimento        = CASE WHEN p_data_nascimento IS NOT NULL        THEN p_data_nascimento        ELSE data_nascimento        END,
    sexo                   = CASE WHEN p_sexo IS NOT NULL                   THEN p_sexo                   ELSE sexo                   END,
    comunidade_id          = CASE WHEN p_comunidade_id IS NOT NULL          THEN p_comunidade_id          ELSE comunidade_id          END,
    motivo_disponibilidade = CASE WHEN p_motivo_disponibilidade IS NOT NULL THEN p_motivo_disponibilidade ELSE motivo_disponibilidade END
  WHERE id = v_membro_id;

  -- ── Sincroniza membro_atuacoes ─────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membro_atuacoes' AND column_name = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_atuacoes WHERE membro_id = v_membro_id;

  IF cardinality(p_atuacao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_atuacoes (membro_id, atuacao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_atuacao_ids), v_paroquia_id ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_atuacoes (membro_id, atuacao_id)
      SELECT v_membro_id, unnest(p_atuacao_ids) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ── Sincroniza membro_missa_restricoes ────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membro_missa_restricoes' AND column_name = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_missa_restricoes WHERE membro_id = v_membro_id;

  IF cardinality(p_missa_restricao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids), v_paroquia_id ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ── Marca perfil como completo ─────────────────────────────────────────
  -- Atualizado no PATCH N: permite que o painel admin exiba status correto.
  UPDATE membros SET perfil_completo = true WHERE id = v_membro_id;

  RETURN jsonb_build_object(
    'success',     true,
    'membro_id',   v_membro_id,
    'paroquia_id', v_paroquia_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_perfil_membro TO authenticated;

-- ── 5. Verificação final ───────────────────────────────────────────────────
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'membros'
--   AND column_name IN ('conta_ativada', 'perfil_completo', 'ativacao_enviada_em');
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('ativar_conta_membro', 'completar_perfil_membro');
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Coluna conta_ativada existe em membros (DEFAULT false)
--   ✓ Coluna perfil_completo existe em membros (DEFAULT false)
--   ✓ Coluna ativacao_enviada_em existe em membros
--   ✓ Membros com auth_user_id NOT NULL têm conta_ativada = true (migração)
--   ✓ ativar_conta_membro() disponível e executável para authenticated
--   ✓ completar_perfil_membro() agora define perfil_completo = true
-- ─────────────────────────────────────────────────────────────────────────────
