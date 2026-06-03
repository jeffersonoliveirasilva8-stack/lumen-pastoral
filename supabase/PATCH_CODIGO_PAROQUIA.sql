-- =====================================================================
-- PATCH_CODIGO_PAROQUIA.sql
-- Adiciona código de acesso curto (6 chars) à paróquia.
-- Membros entram com email + código da paróquia — sem depender de slug
-- ou URL de confirmação de email.
-- Execute no SQL Editor do Supabase
-- =====================================================================

-- ── 1. Coluna codigo_acesso ───────────────────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS codigo_acesso TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS paroquias_codigo_acesso_idx
  ON paroquias (codigo_acesso) WHERE codigo_acesso IS NOT NULL;

-- ── 2. Gerar código para paróquias que ainda não têm ─────────────────
-- Formato: 6 caracteres alfanuméricos maiúsculos (ex: "K7R2MX")
UPDATE paroquias
SET codigo_acesso = UPPER(SUBSTRING(gen_random_uuid()::text, 1, 6))
WHERE codigo_acesso IS NULL;

-- ── 3. portal_link_by_code ───────────────────────────────────────────
-- Vincula auth.uid() ao membro usando código da paróquia + email.
-- Alternativa à portal_auto_link_by_email para membros em múltiplas paróquias.
CREATE OR REPLACE FUNCTION portal_link_by_code(
  p_codigo TEXT,
  p_email  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro_id   UUID;
  v_nome        TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_paroquia_id
  FROM   paroquias
  WHERE  UPPER(codigo_acesso) = UPPER(TRIM(p_codigo));

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  SELECT id, nome INTO v_membro_id, v_nome
  FROM   membros
  WHERE  paroquia_id = v_paroquia_id
    AND  LOWER(email) = LOWER(TRIM(p_email))
    AND  (auth_user_id IS NULL OR auth_user_id = v_auth_id)
    AND  ativo = true
  LIMIT  1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  -- Vincula
  UPDATE membros SET auth_user_id = v_auth_id WHERE id = v_membro_id;

  -- Cria/atualiza profile
  INSERT INTO profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_auth_id, p_email, v_nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = EXCLUDED.paroquia_id,
        email         = EXCLUDED.email;

  -- Role membro
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'membro')
  ON CONFLICT (user_id, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'nome', v_nome, 'membro_id', v_membro_id);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_link_by_code TO authenticated;

-- ── 4. portal_get_paroquia_by_code ────────────────────────────────────
-- Retorna nome da paróquia pelo código (pré-login, para mostrar confirmação)
CREATE OR REPLACE FUNCTION portal_get_paroquia_by_code(p_codigo TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object('nome', nome, 'cidade', cidade)
  FROM   paroquias
  WHERE  UPPER(codigo_acesso) = UPPER(TRIM(p_codigo))
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION portal_get_paroquia_by_code TO anon, authenticated;

-- ── 5. Mostra os códigos gerados ──────────────────────────────────────
SELECT nome, codigo_acesso FROM paroquias ORDER BY nome;
