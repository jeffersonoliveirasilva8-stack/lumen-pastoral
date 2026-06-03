-- =====================================================================
-- PATCH_MEMBRO_PORTAL_V2.sql
-- Separação completa: Portal Administrativo ↔ Portal do Membro
--
-- O que este patch faz:
--   1. portal_auto_link_by_email() — vincula auth.uid() ao membro pelo
--      email, cria perfil e role 'membro' automaticamente.
--      Chamada no login do /membro/login e como fallback em use-membro-auth.
--   2. portal_get_own_membro() — retorna o membro do usuário autenticado
--      (usado pelo hook antes de tentar auto-link).
--   3. Atualiza a role do usuário: aceita 'membro' além de 'servidor'.
--   4. Garante policies RLS para o novo papel 'membro'.
--
-- Execute no SQL Editor do Supabase → Run
-- =====================================================================

-- ── 1. Garantir coluna auth_user_id (idempotente) ────────────────────
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS membros_auth_user_id_idx
  ON membros (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ── 2. portal_auto_link_by_email ─────────────────────────────────────
-- Vincula o auth.uid() atual ao registro de membro pelo email.
-- Cria o profile (se não existir) com paroquia_id do membro.
-- Adiciona role 'membro' em user_roles.
-- Retorna { success, membro_id?, error? }
CREATE OR REPLACE FUNCTION portal_auto_link_by_email()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_email       TEXT;
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_nome        TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Pega o email do usuário autenticado
  SELECT email INTO v_email FROM auth.users WHERE id = v_auth_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_email');
  END IF;

  -- Procura membro pelo email (ainda não vinculado ou já vinculado ao mesmo uid)
  SELECT id, paroquia_id, nome
  INTO   v_membro_id, v_paroquia_id, v_nome
  FROM   membros
  WHERE  LOWER(email) = LOWER(v_email)
    AND  (auth_user_id IS NULL OR auth_user_id = v_auth_id)
    AND  ativo = true
  ORDER  BY created_at ASC
  LIMIT  1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  -- Vincula
  UPDATE membros SET auth_user_id = v_auth_id WHERE id = v_membro_id;

  -- Cria/atualiza profile
  INSERT INTO profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_auth_id, v_email, v_nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = EXCLUDED.paroquia_id,
        email         = EXCLUDED.email;

  -- Adiciona role 'membro' (não apaga outras roles)
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'membro')
  ON CONFLICT (user_id, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id, 'nome', v_nome);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_auto_link_by_email TO authenticated;

-- ── 3. portal_get_own_membro ──────────────────────────────────────────
-- Retorna dados do membro autenticado (por auth_user_id).
-- Usado pelo hook use-membro-auth como check rápido.
CREATE OR REPLACE FUNCTION portal_get_own_membro()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id UUID := auth.uid();
  v_row     RECORD;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    m.id, m.nome, m.email, m.telefone, m.data_nascimento,
    m.data_ingresso, m.score, m.paroquia_id, m.foto_url,
    p.nome   AS paroquia_nome,
    p.slug   AS paroquia_slug
  INTO v_row
  FROM membros m
  JOIN paroquias p ON p.id = m.paroquia_id
  WHERE m.auth_user_id = v_auth_id
  LIMIT 1;

  IF v_row IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN row_to_json(v_row)::JSONB;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_own_membro TO authenticated;

-- ── 4. Atualizar helper auth_member_paroquia_id ───────────────────────
-- Aceita tanto 'membro' quanto 'servidor' como roles de membro de paróquia.
-- Esta função é usada nas políticas RLS de escalas/ministerios/etc.
CREATE OR REPLACE FUNCTION auth_member_paroquia_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT paroquia_id FROM profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION auth_member_paroquia_id TO authenticated;

-- ── 5. RLS policies ───────────────────────────────────────────────────

-- Membros: leitura própria (por auth_user_id)
DROP POLICY IF EXISTS "member_portal_select_own" ON membros;
CREATE POLICY "member_portal_select_own" ON membros
  FOR SELECT USING (auth_user_id = auth.uid());

-- Membros: atualização de perfil próprio
DROP POLICY IF EXISTS "member_portal_update_own" ON membros;
CREATE POLICY "member_portal_update_own" ON membros
  FOR UPDATE
  USING    (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Membros: ver outros da paróquia (para ranking)
DROP POLICY IF EXISTS "member_portal_select_parish_membros" ON membros;
CREATE POLICY "member_portal_select_parish_membros" ON membros
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Escalas: membro lê as da sua paróquia
DROP POLICY IF EXISTS "member_portal_select_escalas" ON escalas;
CREATE POLICY "member_portal_select_escalas" ON escalas
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Escala_membros: membro lê as próprias
DROP POLICY IF EXISTS "member_portal_select_escala_membros" ON escala_membros;
CREATE POLICY "member_portal_select_escala_membros" ON escala_membros
  FOR SELECT
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Escala_membros: membro confirma/recusa
DROP POLICY IF EXISTS "member_portal_update_escala_membros" ON escala_membros;
CREATE POLICY "member_portal_update_escala_membros" ON escala_membros
  FOR UPDATE
  USING    (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()))
  WITH CHECK (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Indisponibilidades: membro lê/cria/exclui as próprias
DROP POLICY IF EXISTS "member_portal_select_indisps" ON indisponibilidades;
DROP POLICY IF EXISTS "member_portal_insert_indisps" ON indisponibilidades;
DROP POLICY IF EXISTS "member_portal_delete_indisps" ON indisponibilidades;

CREATE POLICY "member_portal_select_indisps" ON indisponibilidades
  FOR SELECT
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

CREATE POLICY "member_portal_insert_indisps" ON indisponibilidades
  FOR INSERT
  WITH CHECK (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

CREATE POLICY "member_portal_delete_indisps" ON indisponibilidades
  FOR DELETE
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Ministérios: membro lê os da paróquia
DROP POLICY IF EXISTS "member_portal_select_ministerios" ON ministerios;
CREATE POLICY "member_portal_select_ministerios" ON ministerios
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Historico: membro lê o próprio
DROP POLICY IF EXISTS "member_portal_select_historico" ON historico_participacoes;
CREATE POLICY "member_portal_select_historico" ON historico_participacoes
  FOR SELECT
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Membro_ministerios: leitura para ranking/perfil
DROP POLICY IF EXISTS "member_portal_select_membro_ministerios" ON membro_ministerios;
CREATE POLICY "member_portal_select_membro_ministerios" ON membro_ministerios
  FOR SELECT
  USING (
    ministerio_id IN (
      SELECT id FROM ministerios WHERE paroquia_id = auth_member_paroquia_id()
    )
  );

-- Paróquias: leitura pelo slug (entrada do portal)
DROP POLICY IF EXISTS "public_read_paroquia_by_slug" ON paroquias;
CREATE POLICY "public_read_paroquia_by_slug" ON paroquias
  FOR SELECT USING (slug IS NOT NULL);

-- ── 6. Validação ──────────────────────────────────────────────────────
SELECT
  'OK — PATCH_MEMBRO_PORTAL_V2 aplicado com sucesso' AS status,
  (SELECT count(*) FROM information_schema.routines
   WHERE routine_name = 'portal_auto_link_by_email') AS fn_auto_link,
  (SELECT count(*) FROM information_schema.routines
   WHERE routine_name = 'portal_get_own_membro') AS fn_get_own;
