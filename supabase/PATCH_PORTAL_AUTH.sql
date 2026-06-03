-- =====================================================================
-- PATCH_PORTAL_AUTH.sql
-- Portal dos membros com autenticação própria (email + senha)
-- Execute no Supabase SQL Editor
-- =====================================================================

-- ── 1. paroquias: slug para URL amigável ─────────────────────────────
ALTER TABLE paroquias
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS paroquias_slug_idx
  ON paroquias (slug) WHERE slug IS NOT NULL;

-- ── 2. membros: vínculo com auth.users + campos de perfil estendido ──
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS auth_user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cpf                    TEXT,
  ADD COLUMN IF NOT EXISTS rg                     TEXT,
  ADD COLUMN IF NOT EXISTS foto_url               TEXT,
  ADD COLUMN IF NOT EXISTS endereco               TEXT,
  ADD COLUMN IF NOT EXISTS cidade                 TEXT,
  ADD COLUMN IF NOT EXISTS cep                    TEXT,
  ADD COLUMN IF NOT EXISTS nome_emergencia        TEXT,
  ADD COLUMN IF NOT EXISTS telefone_emergencia    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS membros_auth_user_id_idx
  ON membros (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ── 3. Helper SECURITY DEFINER (evita recursão nas policies RLS) ─────
-- USA profiles (não membros) para evitar recursão infinita:
-- se usasse membros aqui, qualquer SELECT/INSERT-RETURNING em membros
-- avaliaria esta função → consultaria membros → recursão infinita.
-- portal_link_auth_user() garante que profiles.paroquia_id está preenchido
-- para todos os usuários (coordenadores e servidores).
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

-- ── 4. RPC: portal_check_member_email ────────────────────────────────
-- Verifica se um e-mail está cadastrado como membro ativo da paróquia.
-- Chamada pública (anon) antes do signUp.
CREATE OR REPLACE FUNCTION portal_check_member_email(
  p_slug  TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  v_nome        TEXT;
  v_linked      BOOLEAN;
BEGIN
  SELECT id INTO v_paroquia_id
  FROM paroquias WHERE slug = p_slug;

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'parish_not_found');
  END IF;

  SELECT nome, (auth_user_id IS NOT NULL)
  INTO   v_nome, v_linked
  FROM   membros
  WHERE  paroquia_id = v_paroquia_id
    AND  LOWER(email) = LOWER(p_email)
    AND  ativo = true
  LIMIT 1;

  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'nome', v_nome,
    'already_registered', v_linked
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portal_check_member_email TO anon, authenticated;

-- ── 5. RPC: portal_link_auth_user ────────────────────────────────────
-- Chamada após signUp + confirmação de e-mail.
-- Vincula auth.uid() ao registro do membro, cria profile e role.
CREATE OR REPLACE FUNCTION portal_link_auth_user(
  p_slug  TEXT,
  p_email TEXT
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

  SELECT id INTO v_paroquia_id FROM paroquias WHERE slug = p_slug;
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'parish_not_found');
  END IF;

  SELECT id, nome INTO v_membro_id, v_nome
  FROM membros
  WHERE paroquia_id = v_paroquia_id
    AND LOWER(email) = LOWER(p_email)
    AND (auth_user_id IS NULL OR auth_user_id = v_auth_id)
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  UPDATE membros SET auth_user_id = v_auth_id WHERE id = v_membro_id;

  -- Cria/atualiza perfil no auth
  INSERT INTO profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_auth_id, p_email, v_nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = EXCLUDED.paroquia_id;

  -- Adiciona role 'servidor'
  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'servidor')
  ON CONFLICT (user_id, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_link_auth_user TO authenticated;

-- ── 6. RLS: acesso ao portal do membro autenticado ───────────────────

-- Paróquias: leitura pública pelo slug (página de entrada do portal)
DROP POLICY IF EXISTS "public_read_paroquia_by_slug" ON paroquias;
CREATE POLICY "public_read_paroquia_by_slug" ON paroquias
  FOR SELECT USING (slug IS NOT NULL);

-- Membros: membro pode ler o próprio registro (direto em auth_user_id)
DROP POLICY IF EXISTS "member_portal_select_own" ON membros;
CREATE POLICY "member_portal_select_own" ON membros
  FOR SELECT USING (auth_user_id = auth.uid());

-- Membros: membro pode atualizar apenas campos de perfil do próprio registro
DROP POLICY IF EXISTS "member_portal_update_own" ON membros;
CREATE POLICY "member_portal_update_own" ON membros
  FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Escalas: membro pode ler escalas da sua paróquia
DROP POLICY IF EXISTS "member_portal_select_escalas" ON escalas;
CREATE POLICY "member_portal_select_escalas" ON escalas
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Escala_membros: membro pode ler as próprias alocações
DROP POLICY IF EXISTS "member_portal_select_escala_membros" ON escala_membros;
CREATE POLICY "member_portal_select_escala_membros" ON escala_membros
  FOR SELECT
  USING (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  );

-- Escala_membros: membro pode confirmar/recusar a própria participação
DROP POLICY IF EXISTS "member_portal_update_escala_membros" ON escala_membros;
CREATE POLICY "member_portal_update_escala_membros" ON escala_membros
  FOR UPDATE
  USING (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid())
  );

-- Indisponibilidades: membro pode ler/criar/excluir as próprias
DROP POLICY IF EXISTS "member_portal_select_indisps" ON indisponibilidades;
CREATE POLICY "member_portal_select_indisps" ON indisponibilidades
  FOR SELECT
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "member_portal_insert_indisps" ON indisponibilidades;
CREATE POLICY "member_portal_insert_indisps" ON indisponibilidades
  FOR INSERT
  WITH CHECK (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "member_portal_delete_indisps" ON indisponibilidades;
CREATE POLICY "member_portal_delete_indisps" ON indisponibilidades
  FOR DELETE
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Ministérios: membro pode ler os da sua paróquia (para ranking/perfil)
DROP POLICY IF EXISTS "member_portal_select_ministerios" ON ministerios;
CREATE POLICY "member_portal_select_ministerios" ON ministerios
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Historico_participacoes: membro lê o próprio histórico
DROP POLICY IF EXISTS "member_portal_select_historico" ON historico_participacoes;
CREATE POLICY "member_portal_select_historico" ON historico_participacoes
  FOR SELECT
  USING (membro_id IN (SELECT id FROM membros WHERE auth_user_id = auth.uid()));

-- Membros: membro pode ver outros membros da paróquia (ranking)
DROP POLICY IF EXISTS "member_portal_select_parish_membros" ON membros;
CREATE POLICY "member_portal_select_parish_membros" ON membros
  FOR SELECT
  USING (paroquia_id = auth_member_paroquia_id());

-- Membro_ministerios: membro pode ler associações da paróquia (para ranking)
DROP POLICY IF EXISTS "member_portal_select_membro_ministerios" ON membro_ministerios;
CREATE POLICY "member_portal_select_membro_ministerios" ON membro_ministerios
  FOR SELECT
  USING (
    ministerio_id IN (
      SELECT id FROM ministerios WHERE paroquia_id = auth_member_paroquia_id()
    )
  );
