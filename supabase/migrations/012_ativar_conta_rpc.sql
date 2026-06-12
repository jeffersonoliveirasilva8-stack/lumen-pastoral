-- ============================================================
-- 012_ativar_conta_rpc.sql
-- Garante RPCs de ativação de conta e colunas de status
-- Data: 2026-06-12
--
-- CONTEXTO:
--   Estes itens estavam apenas em PATCH_N_CONTA_ATIVADA_2026_06_10.sql
--   (patch manual, não rastreado no histórico de migrations).
--   Esta migration garante que existam na produção.
--
-- IDEMPOTENTE: sim (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE).
-- ============================================================

-- ── 1. Colunas de status em membros ──────────────────────────────────────────
ALTER TABLE public.membros
  ADD COLUMN IF NOT EXISTS conta_ativada        BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perfil_completo      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ativacao_enviada_em  TIMESTAMPTZ;

-- Membros já vinculados ao auth já ativaram conta (acesso anterior).
UPDATE public.membros
SET conta_ativada = true
WHERE auth_user_id IS NOT NULL
  AND conta_ativada = false;

-- ── 2. RPC ativar_conta_membro() ─────────────────────────────────────────────
-- Chamado por /membro/ativar-conta após supabase.auth.updateUser({ password }).
-- SECURITY DEFINER: ignora RLS para UPDATE em membros.

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

  -- Tenta por auth_user_id (normal após auto-link)
  UPDATE membros
  SET conta_ativada = true
  WHERE auth_user_id = v_auth_id AND ativo = true
  RETURNING id INTO v_membro_id;

  -- Fallback por email (auth_user_id ainda NULL no momento da ativação)
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

GRANT EXECUTE ON FUNCTION public.ativar_conta_membro() TO authenticated;

NOTIFY pgrst, 'reload schema';
