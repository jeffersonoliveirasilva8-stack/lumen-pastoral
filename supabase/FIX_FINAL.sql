-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  FIX FINAL — Execute INTEIRO no SQL Editor                     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════
-- PASSO 1 — DROP das funções ANTES de recriar
-- (obrigatório quando o nome do parâmetro mudou)
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS _portal_membro_id();
DROP FUNCTION IF EXISTS _portal_membro_paroquia(uuid);
DROP FUNCTION IF EXISTS _portal_escala_paroquia(uuid);
DROP FUNCTION IF EXISTS _portal_is_admin(uuid);
DROP FUNCTION IF EXISTS _portal_is_coord(uuid);

-- ════════════════════════════════════════════════════════════════════
-- PASSO 2 — Recriar as funções SECURITY DEFINER
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
-- PASSO 3 — DROP de todas as policies conflitantes
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "membro_read_own"               ON membros;
DROP POLICY IF EXISTS "membro_read_paroquia"          ON membros;
DROP POLICY IF EXISTS "membros_admin_all"             ON membros;

DROP POLICY IF EXISTS "escalas_membro_read"           ON escalas;
DROP POLICY IF EXISTS "escalas_admin_read"            ON escalas;
DROP POLICY IF EXISTS "escalas_admin_all"             ON escalas;
DROP POLICY IF EXISTS "escalas_read"                  ON escalas;

DROP POLICY IF EXISTS "em_membro_read_own"            ON escala_membros;
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
-- PASSO 4 — Recriar policies
-- ════════════════════════════════════════════════════════════════════

-- membros
CREATE POLICY "membro_read_paroquia" ON membros
  FOR SELECT TO authenticated
  USING (paroquia_id = _portal_membro_paroquia(_portal_membro_id()) OR _portal_is_admin(paroquia_id));

CREATE POLICY "membros_admin_all" ON membros
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- escalas (CRÍTICO — sem isso o !inner join retorna zero linhas)
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
-- PASSO 5 — Recarregar PostgREST
-- ════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- PASSO 6 — DIAGNÓSTICO (roda como superuser, sem RLS)
-- Mostre os resultados para identificar o problema
-- ════════════════════════════════════════════════════════════════════

-- A) O membro tem auth_user_id preenchido?
SELECT
  id,
  nome,
  email,
  ativo,
  CASE WHEN auth_user_id IS NULL THEN '⚠ SEM auth_user_id' ELSE '✓ vinculado' END AS vinculo,
  auth_user_id
FROM membros
ORDER BY nome;

-- B) Que escalas existem e em qual status?
SELECT
  e.id,
  e.titulo,
  e.data,
  e.status,
  e.paroquia_id,
  COUNT(em.id) AS membros_escalados
FROM escalas e
LEFT JOIN escala_membros em ON em.escala_id = e.id
GROUP BY e.id, e.titulo, e.data, e.status, e.paroquia_id
ORDER BY e.data DESC;

-- C) Quais membros estão escalados em qual escala?
SELECT
  em.id AS em_id,
  m.nome AS membro,
  m.email,
  m.auth_user_id,
  e.titulo AS escala,
  e.data,
  e.status AS escala_status,
  em.status AS confirmacao
FROM escala_membros em
JOIN membros m ON m.id = em.membro_id
JOIN escalas e ON e.id = em.escala_id
ORDER BY e.data, m.nome;
