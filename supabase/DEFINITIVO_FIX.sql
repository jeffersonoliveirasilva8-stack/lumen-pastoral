-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  DEFINITIVO FIX — Execute INTEIRO no SQL Editor do Supabase    ║
-- ║  Corrige: escala não aparece para o membro, policies RLS       ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════
-- PASSO 1 — Vincular auth_user_id para todos os membros sem vínculo
-- (corrige o caso de membros autenticados via email mas sem auth_user_id)
-- ════════════════════════════════════════════════════════════════════

UPDATE membros m
SET auth_user_id = au.id
FROM auth.users au
WHERE lower(trim(coalesce(m.email, ''))) = lower(trim(coalesce(au.email, '')))
  AND m.auth_user_id IS NULL
  AND m.ativo = true;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 2 — DROP das funções (obrigatório para renomear parâmetros)
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS _portal_membro_id();
DROP FUNCTION IF EXISTS _portal_membro_paroquia(uuid);
DROP FUNCTION IF EXISTS _portal_escala_paroquia(uuid);
DROP FUNCTION IF EXISTS _portal_is_admin(uuid);
DROP FUNCTION IF EXISTS _portal_is_coord(uuid);

-- ════════════════════════════════════════════════════════════════════
-- PASSO 3 — Recriar funções SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════

CREATE FUNCTION _portal_membro_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM membros WHERE auth_user_id = auth.uid() AND ativo = true LIMIT 1),
    (SELECT id FROM membros
     WHERE lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),'')))
       AND ativo = true LIMIT 1)
  )
$$;

CREATE FUNCTION _portal_membro_paroquia(p_membro_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM membros WHERE id = p_membro_id LIMIT 1
$$;

CREATE FUNCTION _portal_escala_paroquia(p_escala_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM escalas WHERE id = p_escala_id LIMIT 1
$$;

CREATE FUNCTION _portal_is_admin(p_paroquia_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND paroquia_id = p_paroquia_id
      AND role IN ('super_admin', 'admin_paroquial', 'lider')
  )
$$;

CREATE FUNCTION _portal_is_coord(p_membro_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  )
$$;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 4 — DROP de todas as policies existentes
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "membro_read_own"               ON membros;
DROP POLICY IF EXISTS "membro_read_paroquia"          ON membros;
DROP POLICY IF EXISTS "membros_admin_all"             ON membros;

DROP POLICY IF EXISTS "escalas_membro_read"           ON escalas;
DROP POLICY IF EXISTS "escalas_admin_read"            ON escalas;
DROP POLICY IF EXISTS "escalas_admin_all"             ON escalas;
DROP POLICY IF EXISTS "escalas_read"                  ON escalas;

DROP POLICY IF EXISTS "em_membro_read_own"            ON escala_membros;
DROP POLICY IF EXISTS "em_membro_paroquia_read"       ON escala_membros;
DROP POLICY IF EXISTS "em_membro_update_own"          ON escala_membros;
DROP POLICY IF EXISTS "em_coord_read"                 ON escala_membros;
DROP POLICY IF EXISTS "em_coord_update"               ON escala_membros;
DROP POLICY IF EXISTS "em_admin_all"                  ON escala_membros;

DROP POLICY IF EXISTS "mm_read_own"                   ON membro_ministerios;
DROP POLICY IF EXISTS "mm_read_paroquia"              ON membro_ministerios;
DROP POLICY IF EXISTS "mm_admin_all"                  ON membro_ministerios;

DROP POLICY IF EXISTS "ministerios_read_authenticated" ON ministerios;
DROP POLICY IF EXISTS "ministerios_admin_all"          ON ministerios;
DROP POLICY IF EXISTS "ministerios_read"               ON ministerios;

DROP POLICY IF EXISTS "paroquias_membro_read"          ON paroquias;
DROP POLICY IF EXISTS "paroquias_admin_all"            ON paroquias;
DROP POLICY IF EXISTS "paroquias_read"                 ON paroquias;

DROP POLICY IF EXISTS "coord_membro_read"             ON coordenadores;
DROP POLICY IF EXISTS "coord_admin_all"               ON coordenadores;

DROP POLICY IF EXISTS "indisp_membro_own"             ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_admin_all"              ON indisponibilidades;

DROP POLICY IF EXISTS "hist_membro_read"              ON historico_participacoes;
DROP POLICY IF EXISTS "hist_admin_all"                ON historico_participacoes;

DROP POLICY IF EXISTS "eventos_membro_read"           ON formacoes_eventos;
DROP POLICY IF EXISTS "eventos_admin_all"             ON formacoes_eventos;

DROP POLICY IF EXISTS "presenca_membro_own"           ON presencas_eventos;
DROP POLICY IF EXISTS "presenca_admin_all"            ON presencas_eventos;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 5 — Recriar todas as policies
-- ════════════════════════════════════════════════════════════════════

-- membros
CREATE POLICY "membro_read_paroquia" ON membros
  FOR SELECT TO authenticated
  USING (paroquia_id = _portal_membro_paroquia(_portal_membro_id()) OR _portal_is_admin(paroquia_id));

CREATE POLICY "membros_admin_all" ON membros
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- escalas (CRÍTICO — sem essa policy o !inner join retorna zero linhas)
CREATE POLICY "escalas_membro_read" ON escalas
  FOR SELECT TO authenticated
  USING (paroquia_id = _portal_membro_paroquia(_portal_membro_id()) OR _portal_is_admin(paroquia_id));

CREATE POLICY "escalas_admin_all" ON escalas
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- escala_membros
CREATE POLICY "em_membro_read_own" ON escala_membros
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

-- Permite que qualquer membro da paróquia veja todos os escalados de cada escala
CREATE POLICY "em_membro_paroquia_read" ON escala_membros
  FOR SELECT TO authenticated
  USING (_portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id()));

CREATE POLICY "em_membro_update_own" ON escala_membros
  FOR UPDATE TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "em_coord_read" ON escala_membros
  FOR SELECT TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

CREATE POLICY "em_coord_update" ON escala_membros
  FOR UPDATE TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  )
  WITH CHECK (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

CREATE POLICY "em_admin_all" ON escala_membros
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- membro_ministerios
CREATE POLICY "mm_read_paroquia" ON membro_ministerios
  FOR SELECT TO authenticated
  USING (
    _portal_membro_paroquia(membro_id) = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(_portal_membro_paroquia(membro_id))
  );

CREATE POLICY "mm_admin_all" ON membro_ministerios
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_membro_paroquia(membro_id)))
  WITH CHECK (_portal_is_admin(_portal_membro_paroquia(membro_id)));

-- ministerios
CREATE POLICY "ministerios_read_authenticated" ON ministerios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ministerios_admin_all" ON ministerios
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- paroquias
CREATE POLICY "paroquias_membro_read" ON paroquias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "paroquias_admin_all" ON paroquias
  FOR ALL TO authenticated
  USING (_portal_is_admin(id))
  WITH CHECK (_portal_is_admin(id));

-- coordenadores
CREATE POLICY "coord_membro_read" ON coordenadores
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id() OR _portal_is_admin(paroquia_id));

CREATE POLICY "coord_admin_all" ON coordenadores
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- indisponibilidades
CREATE POLICY "indisp_membro_own" ON indisponibilidades
  FOR ALL TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "indisp_admin_all" ON indisponibilidades
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- historico_participacoes
CREATE POLICY "hist_membro_read" ON historico_participacoes
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

CREATE POLICY "hist_admin_all" ON historico_participacoes
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- formacoes_eventos
CREATE POLICY "eventos_membro_read" ON formacoes_eventos
  FOR SELECT TO authenticated
  USING (paroquia_id = _portal_membro_paroquia(_portal_membro_id()) OR _portal_is_admin(paroquia_id));

CREATE POLICY "eventos_admin_all" ON formacoes_eventos
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- presencas_eventos
CREATE POLICY "presenca_membro_own" ON presencas_eventos
  FOR ALL TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "presenca_admin_all" ON presencas_eventos
  FOR ALL TO authenticated
  USING (_portal_is_admin((SELECT fe.paroquia_id FROM formacoes_eventos fe WHERE fe.id = evento_id LIMIT 1)))
  WITH CHECK (_portal_is_admin((SELECT fe.paroquia_id FROM formacoes_eventos fe WHERE fe.id = evento_id LIMIT 1)));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 6 — Recarregar PostgREST
-- ════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — Execute como superuser para verificar o estado
-- ════════════════════════════════════════════════════════════════════

-- A) Ver quais membros foram vinculados e quais ainda precisam
SELECT
  m.id,
  m.nome,
  m.email,
  m.ativo,
  CASE
    WHEN m.auth_user_id IS NOT NULL THEN '✓ Vinculado: ' || m.auth_user_id::text
    WHEN au.id IS NOT NULL          THEN '⚠ Auth existe mas não vinculado'
    ELSE                                 '✗ Nenhum auth encontrado'
  END AS status_vinculo
FROM membros m
LEFT JOIN auth.users au ON lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(au.email,'')))
ORDER BY m.nome;

-- B) Escalas publicadas com seus membros escalados
SELECT
  e.titulo,
  e.data,
  e.status,
  m.nome AS membro,
  m.email,
  m.auth_user_id,
  em.status AS confirmacao
FROM escalas e
JOIN escala_membros em ON em.escala_id = e.id
JOIN membros m ON m.id = em.membro_id
WHERE e.status = 'publicada'
ORDER BY e.data, m.nome;

-- C) Policies ativas nas tabelas críticas
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('escalas','escala_membros','membros','historico_participacoes')
ORDER BY tablename, policyname;
