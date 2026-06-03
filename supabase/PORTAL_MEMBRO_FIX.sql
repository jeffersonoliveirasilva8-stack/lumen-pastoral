-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  PORTAL DO MEMBRO — FIX DEFINITIVO                             ║
-- ║  Execute INTEIRO no SQL Editor do Supabase                     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════
-- PASSO 0 — LIMPAR TODAS AS POLICIES DAS TABELAS RELEVANTES
-- Remove qualquer policy antiga com nome diferente que cause recursão.
-- Executar primeiro, antes de recriar com SECURITY DEFINER.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS membros                DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS escalas                DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS escala_membros         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS membro_ministerios     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ministerios            DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS paroquias              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS coordenadores          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS indisponibilidades     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS historico_participacoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS formacoes_eventos      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS presencas_eventos      DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'membros','escalas','escala_membros','membro_ministerios',
        'ministerios','paroquias','coordenadores','indisponibilidades',
        'historico_participacoes','formacoes_eventos','presencas_eventos'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS membros                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS escalas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS escala_membros         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS membro_ministerios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ministerios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS paroquias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS coordenadores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS indisponibilidades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS historico_participacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS formacoes_eventos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS presencas_eventos      ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 1 — FUNÇÕES SECURITY DEFINER
-- Todas as verificações cruzadas de tabelas passam por aqui
-- para evitar recursão no RLS.
-- ════════════════════════════════════════════════════════════════════

-- 1a. Retorna membros.id do usuário logado (por auth_user_id OU email)
CREATE OR REPLACE FUNCTION _portal_membro_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM membros WHERE auth_user_id = auth.uid() AND ativo = true LIMIT 1),
    (SELECT id FROM membros
     WHERE lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),'')))
       AND ativo = true
     LIMIT 1)
  )
$$;

-- 1b. Retorna paroquia_id de um membro qualquer (sem RLS)
CREATE OR REPLACE FUNCTION _portal_membro_paroquia(p_membro_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM membros WHERE id = p_membro_id LIMIT 1
$$;

-- 1c. Retorna paroquia_id de uma escala (sem RLS)
CREATE OR REPLACE FUNCTION _portal_escala_paroquia(p_escala_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM escalas WHERE id = p_escala_id LIMIT 1
$$;

-- 1d. Verifica se o usuário logado é admin da paróquia (via user_roles)
CREATE OR REPLACE FUNCTION _portal_is_admin(p_paroquia_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND paroquia_id = p_paroquia_id
      AND role IN ('super_admin', 'admin_paroquial', 'lider')
  )
$$;

-- 1e. Verifica se um membro é coordenador ativo
CREATE OR REPLACE FUNCTION _portal_is_coord(p_membro_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  )
$$;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 2 — POLICIES para a tabela membros
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "membro_read_own"      ON membros;
DROP POLICY IF EXISTS "membro_read_paroquia" ON membros;
DROP POLICY IF EXISTS "membros_admin_all"    ON membros;

-- Membro vê todos os membros da mesma paróquia (necessário para ranking e seleção)
CREATE POLICY "membro_read_paroquia" ON membros
  FOR SELECT TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Admin gerencia membros da sua paróquia
CREATE POLICY "membros_admin_all" ON membros
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 3 — POLICIES para a tabela escalas
-- (CRÍTICO: sem esta policy, o !inner join retorna zero linhas)
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "escalas_membro_read" ON escalas;
DROP POLICY IF EXISTS "escalas_admin_read"  ON escalas;
DROP POLICY IF EXISTS "escalas_admin_all"   ON escalas;
DROP POLICY IF EXISTS "escalas_read"        ON escalas;

-- Membro vê escalas da sua paróquia (filtro de status fica no front-end)
CREATE POLICY "escalas_membro_read" ON escalas
  FOR SELECT TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Admin gerencia escalas da sua paróquia
CREATE POLICY "escalas_admin_all" ON escalas
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 4 — POLICIES para escala_membros
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "em_membro_read_own"   ON escala_membros;
DROP POLICY IF EXISTS "em_membro_update_own" ON escala_membros;
DROP POLICY IF EXISTS "em_coord_read"        ON escala_membros;
DROP POLICY IF EXISTS "em_coord_update"      ON escala_membros;
DROP POLICY IF EXISTS "em_admin_all"         ON escala_membros;

-- Membro lê suas próprias linhas
CREATE POLICY "em_membro_read_own" ON escala_membros
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

-- Membro atualiza seu próprio status (confirmado/recusado)
CREATE POLICY "em_membro_update_own" ON escala_membros
  FOR UPDATE TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

-- Coordenador lê todos os membros de escalas na sua paróquia
CREATE POLICY "em_coord_read" ON escala_membros
  FOR SELECT TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

-- Coordenador atualiza status de qualquer membro nas escalas da sua paróquia
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

-- Admin gerencia tudo
CREATE POLICY "em_admin_all" ON escala_membros
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 5 — POLICIES para membro_ministerios
-- (Cuidado: não referenciar membros via RLS — usa SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "mm_read_own"      ON membro_ministerios;
DROP POLICY IF EXISTS "mm_read_paroquia" ON membro_ministerios;
DROP POLICY IF EXISTS "mm_admin_all"     ON membro_ministerios;

-- Lê vínculos de ministerio dos membros da mesma paróquia
-- (usa _portal_membro_paroquia que é SECURITY DEFINER — sem recursão)
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

-- ════════════════════════════════════════════════════════════════════
-- PASSO 6 — POLICIES para ministerios
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ministerios_read_authenticated" ON ministerios;
DROP POLICY IF EXISTS "ministerios_admin_all"          ON ministerios;
DROP POLICY IF EXISTS "ministerios_read"               ON ministerios;

CREATE POLICY "ministerios_read_authenticated" ON ministerios
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ministerios_admin_all" ON ministerios
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 7 — POLICIES para paroquias
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "paroquias_membro_read" ON paroquias;
DROP POLICY IF EXISTS "paroquias_admin_all"   ON paroquias;
DROP POLICY IF EXISTS "paroquias_read"        ON paroquias;

CREATE POLICY "paroquias_membro_read" ON paroquias
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "paroquias_admin_all" ON paroquias
  FOR ALL TO authenticated
  USING (_portal_is_admin(id))
  WITH CHECK (_portal_is_admin(id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 8 — POLICIES para coordenadores
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "coord_membro_read" ON coordenadores;
DROP POLICY IF EXISTS "coord_admin_all"   ON coordenadores;

CREATE POLICY "coord_membro_read" ON coordenadores
  FOR SELECT TO authenticated
  USING (
    membro_id = _portal_membro_id()
    OR _portal_is_admin(paroquia_id)
  );

CREATE POLICY "coord_admin_all" ON coordenadores
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 9 — POLICIES para indisponibilidades
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "indisp_membro_own" ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_admin_all"  ON indisponibilidades;

CREATE POLICY "indisp_membro_own" ON indisponibilidades
  FOR ALL TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "indisp_admin_all" ON indisponibilidades
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 10 — POLICIES para historico_participacoes
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "hist_membro_read" ON historico_participacoes;
DROP POLICY IF EXISTS "hist_admin_all"   ON historico_participacoes;

CREATE POLICY "hist_membro_read" ON historico_participacoes
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

CREATE POLICY "hist_admin_all" ON historico_participacoes
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 11 — POLICIES para formacoes_eventos
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "eventos_membro_read" ON formacoes_eventos;
DROP POLICY IF EXISTS "eventos_admin_all"   ON formacoes_eventos;

CREATE POLICY "eventos_membro_read" ON formacoes_eventos
  FOR SELECT TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

CREATE POLICY "eventos_admin_all" ON formacoes_eventos
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 12 — POLICIES para presencas_eventos
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "presenca_membro_own" ON presencas_eventos;
DROP POLICY IF EXISTS "presenca_admin_all"  ON presencas_eventos;

CREATE POLICY "presenca_membro_own" ON presencas_eventos
  FOR ALL TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "presenca_admin_all" ON presencas_eventos
  FOR ALL TO authenticated
  USING (
    _portal_is_admin(
      (SELECT fe.paroquia_id FROM formacoes_eventos fe WHERE fe.id = evento_id LIMIT 1)
    )
  )
  WITH CHECK (
    _portal_is_admin(
      (SELECT fe.paroquia_id FROM formacoes_eventos fe WHERE fe.id = evento_id LIMIT 1)
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- PASSO 13 — Recarregar schema PostgREST
-- ════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- PASSO 14 — DIAGNÓSTICO: execute estas queries separadamente
-- para verificar se tudo está funcionando para o usuário logado
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- PASSO 15 — SINCRONIZAR auth_user_id nos membros pelo email
-- Vincula todos os membros que têm conta Auth mas não estão linkados.
-- ════════════════════════════════════════════════════════════════════

UPDATE membros m
SET auth_user_id = u.id
FROM auth.users u
WHERE lower(trim(coalesce(m.email, ''))) = lower(trim(u.email))
  AND m.auth_user_id IS NULL
  AND m.ativo = true;

-- Resultado da sincronização
SELECT
  COUNT(*) FILTER (WHERE auth_user_id IS NOT NULL) AS membros_sincronizados,
  COUNT(*) FILTER (WHERE auth_user_id IS NULL)     AS sem_conta_auth,
  COUNT(*)                                          AS total_ativos
FROM membros WHERE ativo = true;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 16 — GRANTS finais
-- ════════════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 14a. Verificar se o membro é encontrado pelo usuário logado:
SELECT
  _portal_membro_id() AS membro_id_encontrado,
  auth.uid()          AS auth_uid,
  auth.email()        AS auth_email;

-- 14b. Ver escala_membros + escalas do membro logado (testa o join):
SELECT
  em.id              AS em_id,
  em.membro_id,
  em.status          AS em_status,
  e.titulo,
  e.data,
  e.status           AS escala_status
FROM escala_membros em
JOIN escalas e ON e.id = em.escala_id
WHERE em.membro_id = _portal_membro_id()
ORDER BY e.data;

-- 14c. Verificar políticas ativas em cada tabela relevante:
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('escalas','escala_membros','membros','ministerios','membro_ministerios')
ORDER BY tablename, policyname;
