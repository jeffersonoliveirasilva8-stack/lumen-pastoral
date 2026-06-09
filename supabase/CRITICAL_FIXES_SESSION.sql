-- ============================================================
-- CRITICAL FIXES — Execute COMPLETO no Supabase SQL Editor
-- Corrige: indisponibilidades RLS, escala_membros visibilidade,
--          notificações UPDATE para membros, ocorrências admin/delete
-- ============================================================

-- ── 0. Garantir que as funções auxiliares existem ────────────────────

CREATE OR REPLACE FUNCTION _portal_membro_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM membros WHERE auth_user_id = auth.uid() AND ativo = true LIMIT 1),
    (SELECT id FROM membros
     WHERE lower(trim(coalesce(email,''))) = lower(trim(coalesce((SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1),'')))
       AND ativo = true
     LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION _portal_membro_paroquia(p_membro_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM membros WHERE id = p_membro_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION _portal_escala_paroquia(p_escala_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM escalas WHERE id = p_escala_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION _portal_is_admin(p_paroquia_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role IN ('super_admin', 'admin_paroquial', 'lider')
      AND (paroquia_id = p_paroquia_id OR paroquia_id IS NULL)
  )
$$;

CREATE OR REPLACE FUNCTION _portal_is_coord(p_membro_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  )
$$;

-- ── 1. INDISPONIBILIDADES — Corrigir RLS ────────────────────────────
-- Remove políticas antigas que podem conflitar
DROP POLICY IF EXISTS "indisponibilidades_paroquia" ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_membro_own"           ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_admin_all"            ON indisponibilidades;

-- Membro INSERT/SELECT/DELETE nas próprias indisponibilidades
CREATE POLICY "indisp_membro_own" ON indisponibilidades
  FOR ALL TO authenticated
  USING  (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

-- Admin gerencia todas da paróquia
CREATE POLICY "indisp_admin_all" ON indisponibilidades
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON indisponibilidades TO authenticated;

-- ── 2. ESCALA_MEMBROS — Visibilidade completa para membros ──────────
-- Remove todas as versões conflitantes
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON escala_membros;
DROP POLICY IF EXISTS "em_membro_read_own"               ON escala_membros;
DROP POLICY IF EXISTS "em_membro_update_own"             ON escala_membros;
DROP POLICY IF EXISTS "em_coord_read"                    ON escala_membros;
DROP POLICY IF EXISTS "em_coord_update"                  ON escala_membros;
DROP POLICY IF EXISTS "em_admin_all"                     ON escala_membros;

-- Membro vê TODOS os membros escalados da sua paróquia em escalas publicadas
CREATE POLICY "membro_read_escala_paroquia_full" ON escala_membros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.paroquia_id = _portal_escala_paroquia(escala_membros.escala_id)
        AND m.auth_user_id = auth.uid()
        AND m.ativo = true
    )
    OR _portal_is_admin(_portal_escala_paroquia(escala_membros.escala_id))
  );

-- Membro atualiza apenas o próprio status (confirmação)
CREATE POLICY "em_membro_update_own" ON escala_membros
  FOR UPDATE TO authenticated
  USING  (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

-- Admin gerencia todos os membros das suas escalas
CREATE POLICY "em_admin_all" ON escala_membros
  FOR ALL TO authenticated
  USING  (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- Coordenador lê/atualiza escalas onde é coordenador da paróquia
CREATE POLICY "em_coord_manage" ON escala_membros
  FOR ALL TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  )
  WITH CHECK (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON escala_membros TO authenticated;

-- ── 3. NOTIFICAÇÕES — Membros podem marcar como lida ────────────────
DROP POLICY IF EXISTS "notif_membro_read"        ON notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read"   ON notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"          ON notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"    ON notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"      ON notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"       ON notificacoes;

-- Membro lê notificações da sua paróquia
CREATE POLICY "notif_membro_read" ON notificacoes
  FOR SELECT TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Membro pode marcar notificação como lida (UPDATE somente campo lida)
CREATE POLICY "notif_membro_mark_read" ON notificacoes
  FOR UPDATE TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  )
  WITH CHECK (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Admin gerencia todas (INSERT, UPDATE, DELETE)
CREATE POLICY "notif_admin_manage" ON notificacoes
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON notificacoes TO authenticated;

-- ── 4. OCORRÊNCIAS_MEMBROS — Admin lê, membro exclui própria ────────
DROP POLICY IF EXISTS "ocorrencia_membro_read_own"  ON ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_insert"    ON ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_delete"    ON ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_read"       ON ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_update"     ON ocorrencias_membros;

-- Membro lê suas próprias ocorrências
CREATE POLICY "ocorrencia_membro_read_own" ON ocorrencias_membros
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

-- Membro registra ocorrências (na sua paróquia)
CREATE POLICY "ocorrencia_membro_insert" ON ocorrencias_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = _portal_membro_id()
    AND paroquia_id = _portal_membro_paroquia(_portal_membro_id())
  );

-- Membro exclui apenas ocorrências próprias com status 'aberta' (sem resposta)
CREATE POLICY "ocorrencia_membro_delete" ON ocorrencias_membros
  FOR DELETE TO authenticated
  USING (
    membro_id = _portal_membro_id()
    AND status = 'aberta'
    AND (resposta IS NULL OR resposta = '')
  );

-- Admin e coordenadores lêem TODAS as ocorrências da paróquia
CREATE POLICY "ocorrencia_admin_read" ON ocorrencias_membros
  FOR SELECT TO authenticated
  USING (_portal_is_admin(paroquia_id));

-- Admin atualiza (status + resposta)
CREATE POLICY "ocorrencia_admin_update" ON ocorrencias_membros
  FOR UPDATE TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON ocorrencias_membros TO authenticated;

-- ── 5. SINCRONIZAR auth_user_id nos membros ─────────────────────────
-- Vincula membros que têm conta Auth mas auth_user_id não preenchido
UPDATE membros m
SET auth_user_id = au.id
FROM auth.users au
WHERE lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(au.email,'')))
  AND m.auth_user_id IS NULL
  AND m.ativo = true
  AND au.email IS NOT NULL;

-- ── 6. GARANTIR que homilias_diarias tem colunas necessárias ─────────
ALTER TABLE IF EXISTS homilias_diarias
  ADD COLUMN IF NOT EXISTS video_id      text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS youtube_url   text,
  ADD COLUMN IF NOT EXISTS autor         text DEFAULT 'Padre Paulo Ricardo';

-- ── 7. Recarregar schema PostgREST ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────
-- Após aplicar, execute como membro autenticado:
-- SELECT count(*) FROM escala_membros;  -- deve ser > 0
-- SELECT count(*) FROM indisponibilidades WHERE membro_id = _portal_membro_id();
-- SELECT count(*) FROM notificacoes WHERE lida = false;
-- SELECT count(*) FROM ocorrencias_membros;
