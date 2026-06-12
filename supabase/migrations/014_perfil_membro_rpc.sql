-- Migration 014: RPC SECURITY DEFINER para atualização de perfil do membro
-- Permite que o membro atualize seus próprios dados mesmo quando auth_user_id
-- e email podem estar em estados transitórios de vinculação.

CREATE OR REPLACE FUNCTION public.atualizar_perfil_membro(
  p_nome                TEXT,
  p_telefone            TEXT    DEFAULT NULL,
  p_data_nascimento     DATE    DEFAULT NULL,
  p_cpf                 TEXT    DEFAULT NULL,
  p_rg                  TEXT    DEFAULT NULL,
  p_endereco            TEXT    DEFAULT NULL,
  p_cidade              TEXT    DEFAULT NULL,
  p_cep                 TEXT    DEFAULT NULL,
  p_nome_pai            TEXT    DEFAULT NULL,
  p_nome_mae            TEXT    DEFAULT NULL,
  p_nome_emergencia     TEXT    DEFAULT NULL,
  p_telefone_emergencia TEXT    DEFAULT NULL,
  p_observacoes         TEXT    DEFAULT NULL
)
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

  IF p_nome IS NULL OR TRIM(p_nome) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_obrigatorio');
  END IF;

  SELECT id INTO v_membro_id
  FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  UPDATE membros SET
    nome                = TRIM(p_nome),
    telefone            = p_telefone,
    data_nascimento     = p_data_nascimento,
    cpf                 = p_cpf,
    rg                  = p_rg,
    endereco            = p_endereco,
    cidade              = p_cidade,
    cep                 = p_cep,
    nome_pai            = p_nome_pai,
    nome_mae            = p_nome_mae,
    nome_emergencia     = p_nome_emergencia,
    telefone_emergencia = p_telefone_emergencia,
    observacoes         = p_observacoes,
    updated_at          = now()
  WHERE id = v_membro_id;

  -- Sincroniza nome no profiles para o painel admin
  UPDATE profiles SET nome_completo = TRIM(p_nome)
  WHERE user_id = v_auth_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_perfil_membro TO authenticated;
