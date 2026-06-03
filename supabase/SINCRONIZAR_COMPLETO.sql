-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  SINCRONIZAÇÃO COMPLETA - MOTOR DE ESCALAS + PORTAL DO MEMBRO   ║
-- ║  Execute INTEIRO no SQL Editor do Supabase                      ║
-- ║  https://supabase.com/dashboard/project/[ID]/sql/new            ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Este arquivo consolida TODAS as funções SQL necessárias para:
-- 1. Distribução de membros em escalas (motor)
-- 2. Políticas RLS (Row Level Security)
-- 3. Validações de acesso (coordenadores, admins, membros)
-- 4. Sincronização de auth com membros
-- 5. Personalização de paróquias

-- ════════════════════════════════════════════════════════════════════
-- PASSO 0 — DIAGNOSTICAR ESTADO ATUAL
-- ════════════════════════════════════════════════════════════════════

-- Antes de qualquer mudança, execute estas queries para diagnosticar:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
-- SELECT name FROM pg_proc WHERE proname LIKE '\_portal%' OR proname LIKE 'portal_%';

-- ════════════════════════════════════════════════════════════════════
-- PASSO 1 — LIMPAR RLS TEMPORARIAMENTE
-- Remove qualquer policy antiga que possa causar recursão
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

-- ── Dropear todas as policies de uma vez ──
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
        'historico_participacoes','formacoes_eventos','presencas_eventos',
        'escala_ocorrencias'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Re-ativar RLS
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
-- PASSO 2 — FUNÇÕES SECURITY DEFINER (Base para tudo)
-- Todas as verificações cruzadas de tabelas passam por aqui
-- para evitar recursão no RLS.
-- ════════════════════════════════════════════════════════════════════

-- 2a. Retorna membros.id do usuário logado (por auth_user_id OU email)
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

-- 2b. Retorna paroquia_id de um membro qualquer (sem RLS)
CREATE OR REPLACE FUNCTION _portal_membro_paroquia(p_membro_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM membros WHERE id = p_membro_id LIMIT 1
$$;

-- 2c. Retorna paroquia_id de uma escala (sem RLS)
CREATE OR REPLACE FUNCTION _portal_escala_paroquia(p_escala_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM escalas WHERE id = p_escala_id LIMIT 1
$$;

-- 2d. Verifica se o usuário logado é admin da paróquia (via user_roles)
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

-- 2e. Verifica se um membro é coordenador ativo
CREATE OR REPLACE FUNCTION _portal_is_coord(p_membro_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  )
$$;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 3 — POLICIES para a tabela membros
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 4 — POLICIES para a tabela escalas
-- (CRÍTICO: sem esta policy, o !inner join retorna zero linhas)
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 5 — POLICIES para escala_membros
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 6 — POLICIES para membro_ministerios
-- (Cuidado: não referenciar membros via RLS — usa SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 7 — POLICIES para ministerios
-- ════════════════════════════════════════════════════════════════════

CREATE POLICY "ministerios_read_authenticated" ON ministerios
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ministerios_admin_all" ON ministerios
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 8 — POLICIES para paroquias
-- ════════════════════════════════════════════════════════════════════

CREATE POLICY "paroquias_membro_read" ON paroquias
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "paroquias_admin_all" ON paroquias
  FOR ALL TO authenticated
  USING (_portal_is_admin(id))
  WITH CHECK (_portal_is_admin(id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 9 — POLICIES para coordenadores
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 10 — POLICIES para indisponibilidades
-- ════════════════════════════════════════════════════════════════════

CREATE POLICY "indisp_membro_own" ON indisponibilidades
  FOR ALL TO authenticated
  USING (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

CREATE POLICY "indisp_admin_all" ON indisponibilidades
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 11 — POLICIES para historico_participacoes
-- ════════════════════════════════════════════════════════════════════

CREATE POLICY "hist_membro_read" ON historico_participacoes
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

CREATE POLICY "hist_admin_all" ON historico_participacoes
  FOR ALL TO authenticated
  USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- ════════════════════════════════════════════════════════════════════
-- PASSO 12 — POLICIES para formacoes_eventos
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 13 — POLICIES para presencas_eventos
-- ════════════════════════════════════════════════════════════════════

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
-- PASSO 14 — POLICIES para escala_ocorrencias (se existir)
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'escala_ocorrencias' AND table_schema = 'public') THEN
    EXECUTE $p$ CREATE POLICY "ocorrencia_admin_read" ON escala_ocorrencias
      FOR SELECT TO authenticated
      USING (_portal_is_admin(_portal_escala_paroquia(escala_id))) $p$;

    EXECUTE $p$ CREATE POLICY "ocorrencia_admin_write" ON escala_ocorrencias
      FOR ALL TO authenticated
      USING (_portal_is_admin(_portal_escala_paroquia(escala_id)))
      WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id))) $p$;

    EXECUTE $p$ CREATE POLICY "ocorrencia_coord_insert" ON escala_ocorrencias
      FOR INSERT TO authenticated
      WITH CHECK (
        registrado_por = _portal_membro_id()
        AND _portal_is_coord(_portal_membro_id())
        AND EXISTS (
          SELECT 1 FROM escala_membros em
          WHERE em.escala_id = escala_ocorrencias.escala_id
            AND em.membro_id = _portal_membro_id()
        )
      ) $p$;

    EXECUTE $p$ CREATE POLICY "ocorrencia_coord_read" ON escala_ocorrencias
      FOR SELECT TO authenticated
      USING (
        _portal_is_coord(_portal_membro_id())
        AND EXISTS (
          SELECT 1 FROM escala_membros em
          WHERE em.escala_id = escala_ocorrencias.escala_id
            AND em.membro_id = _portal_membro_id()
        )
      ) $p$;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PASSO 14b — POLICIES adicionais necessárias
-- ════════════════════════════════════════════════════════════════════

-- Paróquias: leitura pública (formulário de inscrição de membro sem login)
CREATE POLICY "paroquias_read_public" ON paroquias
  FOR SELECT TO anon
  USING (true);

-- Membros: INSERT e UPDATE para qualquer usuário com papel na paróquia
-- (coordenadores precisam inserir membros mesmo sem role admin_paroquial)
CREATE POLICY "membros_gestao_roles" ON membros
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = membros.paroquia_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = membros.paroquia_id)
  );

-- Escalas: INSERT e UPDATE para qualquer usuário com papel na paróquia
CREATE POLICY "escalas_gestao_roles" ON escalas
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = escalas.paroquia_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = escalas.paroquia_id)
  );

-- escala_membros: INSERT e DELETE para qualquer usuário com papel na paróquia
CREATE POLICY "em_gestao_roles" ON escala_membros
  FOR ALL TO authenticated
  USING (
    _portal_is_admin(_portal_escala_paroquia(escala_id))
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = _portal_escala_paroquia(escala_id))
  )
  WITH CHECK (
    _portal_is_admin(_portal_escala_paroquia(escala_id))
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND paroquia_id = _portal_escala_paroquia(escala_id))
  );

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

-- ════════════════════════════════════════════════════════════════════
-- PASSO 17 — RECARREGAR SCHEMA PGRST
-- ════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- PASSO 18 — VERIFICAÇÕES FINAIS
-- Execute cada query separadamente para validar o resultado
-- ════════════════════════════════════════════════════════════════════

-- 18a. Verificar se o membro é encontrado pelo usuário logado:
-- SELECT
--   _portal_membro_id() AS membro_id_encontrado,
--   auth.uid()          AS auth_uid,
--   auth.email()        AS auth_email;

-- 18b. Ver escala_membros + escalas do membro logado (testa o join):
-- SELECT
--   em.id              AS em_id,
--   em.membro_id,
--   em.status          AS em_status,
--   e.titulo,
--   e.data,
--   e.status           AS escala_status
-- FROM escala_membros em
-- JOIN escalas e ON e.id = em.escala_id
-- WHERE em.membro_id = _portal_membro_id()
-- ORDER BY e.data;

-- 18c. Verificar políticas ativas em cada tabela relevante:
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('escalas','escala_membros','membros','ministerios','membro_ministerios')
-- ORDER BY tablename, policyname;

-- 18d. Verificar se personalização de paróquias foi carregada:
-- SELECT id, nome, usa_tochas, usa_turibulo, usa_naveta, regras_escala
-- FROM paroquias
-- LIMIT 5;

-- ════════════════════════════════════════════════════════════════════
-- FIM DA SINCRONIZAÇÃO
-- ════════════════════════════════════════════════════════════════════
-- ✅ Se você chegou aqui sem erros, a sincronização foi bem-sucedida!
-- 
-- Próximas etapas:
-- 1. Volte para o aplicativo e recarregue (F5)
-- 2. Crie uma nova escala com "Tipo de celebração" obrigatoriamente
-- 3. Verifique se os membros aparecem automaticamente sugeridos
-- 4. Publish a escala e confirme no Portal do Membro
-- ════════════════════════════════════════════════════════════════════
