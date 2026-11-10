-- =============================================================================
-- Sprint B — Testes 211–216 v3 (script autocontido)
-- =============================================================================
-- MODELO DE EXECUÇÃO:
--   Execute como role 'postgres' ou 'service_role' no SQL Editor do Supabase.
--
--   IMPORTANTE — SET LOCAL role = authenticated:
--     Os blocos de teste usam SET LOCAL role para simular um usuário autenticado.
--     Essa operação só é permitida ao role 'postgres' (superuser) ou a um role
--     que tenha explicitamente GRANT SET ON ROLE authenticated.
--     'service_role' NÃO tem esse grant por padrão no Supabase — use 'postgres'.
--     Verificar: SELECT pg_has_role('service_role', 'authenticated', 'member');
--
--   ORDEM:
--   1. Execute o bloco SETUP uma vez.
--      Os dados PERSISTEM no banco até o TEARDOWN — não é auto-rollback.
--   2. Execute cada bloco de teste individualmente e compare com o esperado.
--   3. Execute o TEARDOWN ao final.
--      NÃO interrompa o procedimento sem executar o TEARDOWN.
--
--   TESTES QUE EXIGEM DUAS SESSÕES:
--     T_CONC requer duas conexões simultâneas (ver seção T_CONC abaixo).
--     Execute-o em duas abas do SQL Editor.
--
--   DEPENDÊNCIAS ENTRE TESTES:
--     T1 insere convocações que persistem (fora de BEGIN/ROLLBACK).
--     T2 e T3 dependem dessas convocações — executar em sequência.
--     T8–T12 usam v_membro2 (separado de v_membro, usado no T7).
--
--   PRÉ-REQUISITOS:
--     Migrations 192–216 aplicadas no banco de teste antes de executar T1–T13.
--     T14 deve ser executado em cópia do banco de produção com a variável
--     v_migration_215_aplicada_em preenchida com a data real de deploy.
--
-- ALTERAÇÕES v3:
--   - paroquias INSERT corrigido: adicionado slug (obrigatório), removido uf
--   - coordenadores INSERT corrigido: adicionado nome (obrigatório)
--   - auth.users DELETE expandido para incluir email (evita unique_violation)
--   - SETUP: guard de colisão de UUIDs adicionado
--   - SET LOCAL role: exigência documentada (somente role postgres)
--   - T4: cenário sem permissão adicionado antes dos testes de array
--   - T14: parâmetro v_migration_215_aplicada_em; CTE inclui categoria 'ok'
--   - T_CONC: seção de teste de concorrência com instruções de duas sessões
-- =============================================================================


-- =============================================================================
-- SETUP — executar como postgres
-- =============================================================================
DO $$
DECLARE
  v_paroquia_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_escala_id      UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_min_a_id       UUID := 'aaaaaaaa-0000-0000-0000-000000000003';
  v_min_b_id       UUID := 'aaaaaaaa-0000-0000-0000-000000000004';

  v_membro_id      UUID := 'aaaaaaaa-0000-0000-0000-000000000010';
  v_membro2_id     UUID := 'aaaaaaaa-0000-0000-0000-000000000015';
  v_auxiliar_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000011';
  v_admin_esc_id   UUID := 'aaaaaaaa-0000-0000-0000-000000000012';
  v_admin_nesc_id  UUID := 'aaaaaaaa-0000-0000-0000-000000000013';
  v_sem_vinc_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000014';
  v_coord_id       UUID := 'aaaaaaaa-0000-0000-0000-000000000016';

  v_auth_membro    UUID := 'bbbbbbbb-0000-0000-0000-000000000010';
  v_auth_membro2   UUID := 'bbbbbbbb-0000-0000-0000-000000000015';
  v_auth_auxiliar  UUID := 'bbbbbbbb-0000-0000-0000-000000000011';
  v_auth_adm_esc   UUID := 'bbbbbbbb-0000-0000-0000-000000000012';
  v_auth_adm_nesc  UUID := 'bbbbbbbb-0000-0000-0000-000000000013';
  v_auth_sem_vinc  UUID := 'bbbbbbbb-0000-0000-0000-000000000014';
  v_auth_coord     UUID := 'bbbbbbbb-0000-0000-0000-000000000016';

  v_fixture_member_ids UUID[] := ARRAY[
    'aaaaaaaa-0000-0000-0000-000000000010'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000011'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000012'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000013'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000014'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000015'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000016'::UUID
  ];
  v_fixture_auth_ids UUID[] := ARRAY[
    'bbbbbbbb-0000-0000-0000-000000000010'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000011'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000012'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000013'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000014'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000015'::UUID,
    'bbbbbbbb-0000-0000-0000-000000000016'::UUID
  ];
  v_fixture_emails TEXT[] := ARRAY[
    'sprintb_membro@_test.internal',
    'sprintb_membro2@_test.internal',
    'sprintb_auxiliar@_test.internal',
    'sprintb_adm_esc@_test.internal',
    'sprintb_adm_nesc@_test.internal',
    'sprintb_sem_vinc@_test.internal',
    'sprintb_coord@_test.internal'
  ];
  v_collision_count INTEGER;
BEGIN
  -- ── Guard: pré-requisitos de schema ──────────────────────────────────────
  -- tem_convocacao_geral é adicionada pela migration 192.
  -- Se não existir, as migrations 192–216 não foram aplicadas.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'escalas'
      AND column_name  = 'tem_convocacao_geral'
  ) THEN
    RAISE EXCEPTION
      'PRÉ-REQUISITO AUSENTE: coluna escalas.tem_convocacao_geral não encontrada. '
      'Aplicar as migrations 192–216 antes de executar o SETUP.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'escala_convocacoes'
  ) THEN
    RAISE EXCEPTION
      'PRÉ-REQUISITO AUSENTE: tabela escala_convocacoes não encontrada. '
      'Aplicar as migrations 192–216 antes de executar o SETUP.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'participacao_justificativas'
  ) THEN
    RAISE EXCEPTION
      'PRÉ-REQUISITO AUSENTE: tabela participacao_justificativas não encontrada. '
      'Aplicar as migrations 192–216 antes de executar o SETUP.';
  END IF;

  -- ── Guard: colisão de UUIDs ───────────────────────────────────────────────
  -- Verifica se algum UUID de fixture pertence a registros que NÃO são
  -- da paróquia de fixture. Se sim, interrompe antes de qualquer DELETE.
  SELECT COUNT(*) INTO v_collision_count
  FROM public.membros
  WHERE id = ANY(v_fixture_member_ids)
    AND paroquia_id != v_paroquia_id;

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION
      'COLISÃO DE UUIDs: % membro(s) com UUID de fixture pertence(m) a outra paróquia. '
      'Troque os UUIDs de fixture antes de executar o SETUP.',
      v_collision_count;
  END IF;

  SELECT COUNT(*) INTO v_collision_count
  FROM public.escalas
  WHERE id = v_escala_id
    AND paroquia_id != v_paroquia_id;

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION
      'COLISÃO DE UUIDs: escala % pertence a outra paróquia. '
      'Troque os UUIDs de fixture antes de executar o SETUP.',
      v_escala_id;
  END IF;

  -- auth.users — duas verificações independentes:
  -- (a) UUID bbbbbbbb com email que NÃO é de fixture → não tocar
  SELECT COUNT(*) INTO v_collision_count
  FROM auth.users
  WHERE id = ANY(v_fixture_auth_ids)
    AND email != ALL(v_fixture_emails);

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION
      'COLISÃO DE UUIDs: % auth.user(s) com UUID bbbbbbbb-... '
      'não pertence(m) aos emails de fixture. Troque os UUIDs antes de executar.',
      v_collision_count;
  END IF;

  -- (b) email de fixture existe com UUID diferente do esperado → não excluir
  --     (poderia deletar conta real de outro usuário)
  SELECT COUNT(*) INTO v_collision_count
  FROM auth.users
  WHERE email = ANY(v_fixture_emails)
    AND id != ALL(v_fixture_auth_ids);

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION
      'COLISÃO DE E-MAILS: % email(s) de fixture existem no banco com UUID '
      'diferente do conjunto de fixture. Não é seguro deletar — verifique e '
      'troque os emails de fixture antes de executar.',
      v_collision_count;
  END IF;

  -- ── Limpa dados anteriores (idempotência) ──────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'participacao_justificativas') THEN
    DELETE FROM public.participacao_justificativas WHERE paroquia_id = v_paroquia_id;
  END IF;

  DELETE FROM public.historico_participacoes WHERE paroquia_id = v_paroquia_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'escala_convocacoes') THEN
    DELETE FROM public.escala_convocacoes WHERE paroquia_id = v_paroquia_id;
  END IF;

  DELETE FROM public.escala_membros WHERE escala_id = v_escala_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'coordenadores') THEN
    DELETE FROM public.coordenadores WHERE membro_id = v_coord_id;
  END IF;

  DELETE FROM public.membro_ministerios WHERE membro_id = ANY(v_fixture_member_ids);
  DELETE FROM public.membros
  WHERE paroquia_id = v_paroquia_id AND id = ANY(v_fixture_member_ids);
  DELETE FROM public.ministerios
  WHERE paroquia_id = v_paroquia_id AND id IN (v_min_a_id, v_min_b_id);
  -- trg_prevent_delete_published_escala bloqueia DELETE em escalas publicadas/arquivadas.
  -- GUC 'app.force_delete_cascade' = 'true' é o bypass oficial (migration 118).
  PERFORM set_config('app.force_delete_cascade', 'true', true);
  DELETE FROM public.escalas WHERE id = v_escala_id;
  PERFORM set_config('app.force_delete_cascade', 'false', true);
  DELETE FROM public.paroquia_config_escalas WHERE paroquia_id = v_paroquia_id;

  -- auth.users: limpa por ID e por email — evita unique_violation em re-execução
  -- (re-execução pode deixar email ativo com UUID diferente se o DELETE anterior falhou)
  DELETE FROM auth.users
  WHERE id = ANY(v_fixture_auth_ids)
     OR email = ANY(v_fixture_emails);

  -- Paróquia: deletar antes de reinserir (slug tem unique constraint)
  DELETE FROM public.paroquias WHERE id = v_paroquia_id;

  -- ── auth.users (FK obrigatória de membros.auth_user_id) ───────────────────
  -- Requer role 'postgres'; 'service_role' não tem permissão de escrita em
  -- auth.users por padrão no Supabase (apenas via REST Admin API ou role postgres).
  -- Emails com domínio @_test.internal para evitar envio acidental.
  INSERT INTO auth.users
    (id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    (v_auth_membro,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_membro@_test.internal',   '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_membro2,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_membro2@_test.internal',  '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_auxiliar, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_auxiliar@_test.internal', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_adm_esc,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_adm_esc@_test.internal',  '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_adm_nesc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_adm_nesc@_test.internal', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_sem_vinc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_sem_vinc@_test.internal', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    (v_auth_coord,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sprintb_coord@_test.internal',    '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false);

  -- ── DIAGNÓSTICO pré-paróquia ──────────────────────────────────────────────
  -- Verifica se a paróquia persiste do run anterior (teardown incompleto) ou
  -- se o slug está ocupado por outro UUID (impossível de inserir sem conflito).
  IF EXISTS (SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id) THEN
    RAISE NOTICE 'DIAG: paróquia com uuid fixture AINDA EXISTE antes do INSERT (cleanup não deletou)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paroquias WHERE slug = '_sprintb_test'
             AND id != v_paroquia_id) THEN
    RAISE EXCEPTION
      'DIAG BLOQUEIO: slug _sprintb_test existe com UUID diferente — cleanup por id não alcançou essa linha. '
      'Execute: DELETE FROM public.paroquias WHERE slug = ''_sprintb_test''; e tente novamente.';
  END IF;

  -- ── Paróquia ───────────────────────────────────────────────────────────────
  -- slug é NOT NULL sem default — usar valor único de fixture.
  -- cidade é nullable; estado é nullable; uf não existe como coluna.
  -- ativo não existe em paroquias; status tem default 'active'
  INSERT INTO public.paroquias (id, nome, slug, estado)
  VALUES (v_paroquia_id, '_TESTE_SPRINT_B', '_sprintb_test', 'TS')
  ON CONFLICT (id) DO NOTHING;  -- idempotente: row já existe do DIAG acima

  -- Confirma que paróquia foi inserida (FK do historico depende disso)
  IF NOT EXISTS (SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id) THEN
    RAISE EXCEPTION
      'DIAG BLOQUEIO: paróquia não inserida após INSERT — possível conflito de slug ou restrição desconhecida.';
  END IF;

  INSERT INTO public.paroquia_config_escalas (paroquia_id, auto_pontuar)
  VALUES (v_paroquia_id, false)
  ON CONFLICT (paroquia_id) DO UPDATE SET auto_pontuar = false;
  RAISE NOTICE 'DIAG-1: após paroquia_config_escalas — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Ministérios ────────────────────────────────────────────────────────────
  INSERT INTO public.ministerios (id, paroquia_id, nome, ativo)
  VALUES
    (v_min_a_id, v_paroquia_id, '_Ministério A Teste', true),
    (v_min_b_id, v_paroquia_id, '_Ministério B Teste', true)
  ON CONFLICT (id) DO NOTHING;
  RAISE NOTICE 'DIAG-2: após ministerios — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Escala solene publicada ────────────────────────────────────────────────
  INSERT INTO public.escalas
    (id, paroquia_id, titulo, data, status, solene, tem_bispo, tem_convocacao_geral)
  VALUES
    (v_escala_id, v_paroquia_id, '_Missa Solene Teste',
     CURRENT_DATE + 7, 'publicada', true, false, true)
  ON CONFLICT (id) DO NOTHING;
  RAISE NOTICE 'DIAG-3: após escalas — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Membros ────────────────────────────────────────────────────────────────
  INSERT INTO public.membros
    (id, paroquia_id, nome, auth_user_id, ativo, tipo_acesso, conta_ativada, perfil_completo)
  VALUES
    (v_membro_id,     v_paroquia_id, '_Membro T7',           v_auth_membro,   true, 'membro',       true, true),
    (v_membro2_id,    v_paroquia_id, '_Membro T8-T12',       v_auth_membro2,  true, 'membro',       true, true),
    (v_auxiliar_id,   v_paroquia_id, '_Auxiliar',            v_auth_auxiliar, true, 'auxiliar',     true, true),
    (v_admin_esc_id,  v_paroquia_id, '_Admin Escalado',      v_auth_adm_esc,  true, 'administrador',true, true),
    (v_admin_nesc_id, v_paroquia_id, '_Admin Não Escalado',  v_auth_adm_nesc, true, 'administrador',true, true),
    (v_sem_vinc_id,   v_paroquia_id, '_Sem Vínculo',         v_auth_sem_vinc, true, 'membro',       true, true),
    (v_coord_id,      v_paroquia_id, '_Coordenador',         v_auth_coord,    true, 'coordenador',  true, true)
  ON CONFLICT (id) DO NOTHING;
  RAISE NOTICE 'DIAG-4: após membros — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Coordenador na tabela coordenadores (_portal_is_coord lê daqui) ────────
  -- nome é NOT NULL — obrigatório.
  INSERT INTO public.coordenadores (membro_id, paroquia_id, nome, ativo)
  VALUES (v_coord_id, v_paroquia_id, '_Coordenador Teste', true)
  ON CONFLICT DO NOTHING;
  RAISE NOTICE 'DIAG-5: após coordenadores — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Vínculos de ministério ─────────────────────────────────────────────────
  -- membro_ministerios usa nivel TEXT DEFAULT 'ativo', não coluna booleana ativo
  INSERT INTO public.membro_ministerios (membro_id, ministerio_id, nivel)
  VALUES
    (v_membro_id,    v_min_a_id, 'ativo'),
    (v_membro2_id,   v_min_a_id, 'ativo'),
    (v_membro2_id,   v_min_b_id, 'ativo'),
    (v_admin_esc_id, v_min_a_id, 'ativo')
  ON CONFLICT (membro_id, ministerio_id) DO NOTHING;
  RAISE NOTICE 'DIAG-6: após membro_ministerios — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── escala_membros ─────────────────────────────────────────────────────────
  INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, status, ativo)
  VALUES
    (v_escala_id, v_membro_id,    v_min_a_id, 'pendente', true),
    (v_escala_id, v_admin_esc_id, v_min_a_id, 'pendente', true)
  ON CONFLICT DO NOTHING;
  RAISE NOTICE 'DIAG-7: após escala_membros — paroquia_existe=%',
    EXISTS(SELECT 1 FROM public.paroquias WHERE id = v_paroquia_id);

  -- ── Histórico inicial para T7 (pontos=10, ministerio_a) ───────────────────
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos, anulada)
  VALUES
    (v_paroquia_id, v_membro_id, v_escala_id, v_min_a_id,
     'solene', 'escala', 'presente', CURRENT_DATE+7, 10, false)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '=== SETUP CONCLUÍDO ===';
  RAISE NOTICE 'paroquia_id:   %', v_paroquia_id;
  RAISE NOTICE 'escala_id:     %', v_escala_id;
  RAISE NOTICE 'membro_id:     % (T7)', v_membro_id;
  RAISE NOTICE 'membro2_id:    % (T8-T12)', v_membro2_id;
  RAISE NOTICE 'coord_id:      % (T4c)', v_coord_id;
  RAISE NOTICE 'sem_vinc_id:   % (T4a, T5-T6)', v_sem_vinc_id;
  RAISE NOTICE 'admin_esc_id:  % (T2, T13)', v_admin_esc_id;
END;
$$;


-- =============================================================================
-- T1 — Auxiliar lê convocações de outros membros (Migration 211)
-- NOTA: INSERTs abaixo são fora de transação — persistem para T2 e T3.
-- =============================================================================
INSERT INTO public.escala_convocacoes (escala_id, membro_id, paroquia_id)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000010',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000011',
   'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT (escala_id, membro_id) DO NOTHING;

BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000011"}';

SELECT count(*) AS convocacoes_de_outros_visiveis
FROM public.escala_convocacoes
WHERE escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND membro_id  != public._portal_membro_id();
-- ESPERADO: 1

ROLLBACK;


-- =============================================================================
-- T2 — Administrador escalado lê convocações (Migration 211)
-- DEPENDE: convocações inseridas no T1
-- =============================================================================
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000012"}';

SELECT count(*) AS total_convocacoes_visiveis
FROM public.escala_convocacoes
WHERE escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- ESPERADO: 2

ROLLBACK;


-- =============================================================================
-- T3 — Administrador NÃO escalado não lê convocações de outros (Migration 211)
-- DEPENDE: convocações inseridas no T1
-- =============================================================================
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000013"}';

SELECT count(*) AS convocacoes_de_outros
FROM public.escala_convocacoes
WHERE escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND membro_id != public._portal_membro_id();
-- ESPERADO: 0

ROLLBACK;


-- =============================================================================
-- T4 — Migration 212: segurança de autorização e cardinality()
-- =============================================================================

-- ── T4a — Usuário sem permissão recebe sem_permissao ANTES de ver detalhes ───
-- Verifica que a autorização é verificada antes de revelar tipo, status ou
-- ministérios da escala (migration 212: auth order fix).
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000014"}';
-- sem_vinc_id — tipo_acesso='membro', sem entrada em coordenadores

SELECT public.convocar_pastoral_solene(
  'aaaaaaaa-0000-0000-0000-000000000002',
  ARRAY['aaaaaaaa-0000-0000-0000-000000000003']::uuid[]
) AS resultado_sem_permissao;
-- ESPERADO: {"success": false, "error": "sem_permissao"}
-- FALHOU SE: retornou "escala_nao_solene", "ministerio_nao_vinculado" ou
-- qualquer erro que revele detalhes da escala lidos antes da autorização

ROLLBACK;

-- ── T4b — Verificação do comportamento de cardinality() vs array_length() ───
SELECT
  array_length('{}'::uuid[], 1) AS array_length_vazio,   -- ESPERADO: NULL (bug antigo)
  cardinality('{}'::uuid[])     AS cardinality_vazio,     -- ESPERADO: 0 (correto)
  cardinality(NULL::uuid[])     AS cardinality_null;      -- ESPERADO: NULL

-- ── T4c — Array vazio e NULL bloqueados com coordenador autorizado ────────────
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000016"}';
-- coord_id — _portal_is_coord retorna true (tabela coordenadores)

SELECT public.convocar_pastoral_solene(
  'aaaaaaaa-0000-0000-0000-000000000002',
  ARRAY[]::uuid[]
) AS resultado_array_vazio;
-- ESPERADO: {"success": false, "error": "ministerio_ids_obrigatorio"}

SELECT public.convocar_pastoral_solene(
  'aaaaaaaa-0000-0000-0000-000000000002',
  NULL::uuid[]
) AS resultado_null;
-- ESPERADO: {"success": false, "error": "ministerio_ids_obrigatorio"}

ROLLBACK;


-- =============================================================================
-- T5 — Membro sem vínculo não justifica (Migration 213)
-- =============================================================================
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000014"}';

SELECT public.solicitar_justificativa(
  'aaaaaaaa-0000-0000-0000-000000000002',
  'ausencia',
  'Motivo teste sem vínculo'
) AS resultado;
-- ESPERADO: {"success": false, "error": "nao_vinculado_a_celebracao"}

SELECT count(*) AS justificativas_inseridas
FROM public.participacao_justificativas
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000014'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- ESPERADO: 0

ROLLBACK;


-- =============================================================================
-- T6 — p_tipo NULL e valor inválido bloqueados (Migration 213)
-- =============================================================================
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000010"}';

SELECT public.solicitar_justificativa(
  'aaaaaaaa-0000-0000-0000-000000000002', NULL, 'Motivo') AS resultado_null;
-- ESPERADO: {"success": false, "error": "tipo_invalido"}

SELECT public.solicitar_justificativa(
  'aaaaaaaa-0000-0000-0000-000000000002', 'invalido', 'Motivo') AS resultado_invalido;
-- ESPERADO: {"success": false, "error": "tipo_invalido"}

ROLLBACK;


-- =============================================================================
-- T7 — Pontos preservados com auto_pontuar=false (Migration 214)
-- =============================================================================
SELECT pontos AS pontos_antes
FROM public.historico_participacoes
WHERE membro_id    = 'aaaaaaaa-0000-0000-0000-000000000010'
  AND escala_id    = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND ministerio_id = 'aaaaaaaa-0000-0000-0000-000000000003'
  AND anulada = false;
-- ESPERADO: 10

UPDATE public.escala_membros
SET status = 'presente'
WHERE membro_id   = 'aaaaaaaa-0000-0000-0000-000000000010'
  AND escala_id   = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND ministerio_id = 'aaaaaaaa-0000-0000-0000-000000000003'
  AND status = 'pendente';

SELECT pontos AS pontos_apos_trigger
FROM public.historico_participacoes
WHERE membro_id    = 'aaaaaaaa-0000-0000-0000-000000000010'
  AND escala_id    = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND ministerio_id = 'aaaaaaaa-0000-0000-0000-000000000003'
  AND anulada = false;
-- ESPERADO: 10 (preservado — migration 214)
-- FALHOU SE: 0 (zeraria — bug da 210)

UPDATE public.escala_membros SET status = 'pendente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000010'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';


-- =============================================================================
-- T8 — SUM de duas funções com membro2 (Migration 215)
-- =============================================================================
SELECT count(*) AS historico_membro2_antes
FROM public.historico_participacoes
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- ESPERADO: 0

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos, anulada)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   'solene', 'escala', 'presente', CURRENT_DATE+7, 8, false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004',
   'solene', 'escala', 'presente', CURRENT_DATE+7, 6, false)
ON CONFLICT DO NOTHING;

INSERT INTO public.escala_convocacoes (escala_id, membro_id, paroquia_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000015',
        'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT (escala_id, membro_id) DO NOTHING;

UPDATE public.escala_convocacoes SET status = 'presente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT tipo_evento, ministerio_id, pontos, anulada
FROM public.historico_participacoes
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002'
ORDER BY anulada, tipo_evento;
-- ESPERADO:
--   convocacao_solene | NULL     | 14 | false
--   solene            | min_a_id |  8 | true
--   solene            | min_b_id |  6 | true


-- =============================================================================
-- T9 — Idempotência: ausente → presente preservam canonical=14
-- =============================================================================
SELECT pontos AS canonical_antes, presenca
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: pontos=14, presenca='presente'

UPDATE public.escala_convocacoes SET status = 'ausente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT pontos AS pontos_apos_ausente, presenca
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: pontos=14, presenca='faltou'
-- FALHOU SE: pontos=0

SELECT count(*) AS canonicos_ativos_apos_ausente
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: 1

UPDATE public.escala_convocacoes SET status = 'presente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT pontos AS pontos_apos_retorno_presente
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: 14


-- =============================================================================
-- T10 — Canonical com 12 preservado sem históricos antigos (Migration 215)
-- =============================================================================
DELETE FROM public.historico_participacoes
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos, anulada)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', NULL,
   'convocacao_solene', 'convocacao_geral', 'presente', CURRENT_DATE+7, 12, false);

UPDATE public.escala_convocacoes SET status = 'convocado'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

UPDATE public.escala_convocacoes SET status = 'ausente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

UPDATE public.escala_convocacoes SET status = 'presente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT pontos AS pontos_preservados
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: 12


-- =============================================================================
-- T11 — Soma zero: antigos +10 e -10 (Migration 215)
-- =============================================================================
DELETE FROM public.historico_participacoes
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos, anulada)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   'solene', 'escala', 'presente', CURRENT_DATE+7, 10, false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004',
   'solene', 'escala', 'presente', CURRENT_DATE+7, -10, false);

UPDATE public.escala_convocacoes SET status = 'convocado'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

UPDATE public.escala_convocacoes SET status = 'presente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT pontos AS pontos_soma_zero
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: 0 (v_tem_historicos_antigos=true, v_soma_antigas=0)


-- =============================================================================
-- T12 — Soma negativa: antigos -5 e -3 (Migration 215)
-- =============================================================================
DELETE FROM public.historico_participacoes
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos, anulada)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   'solene', 'escala', 'presente', CURRENT_DATE+7, -5, false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000015',
   'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004',
   'solene', 'escala', 'presente', CURRENT_DATE+7, -3, false);

UPDATE public.escala_convocacoes SET status = 'convocado'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

UPDATE public.escala_convocacoes SET status = 'presente'
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT pontos AS pontos_soma_negativa
FROM public.historico_participacoes
WHERE membro_id  = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id  = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND tipo_evento = 'convocacao_solene' AND anulada = false;
-- ESPERADO: -8


-- =============================================================================
-- T13 — p_avaliacao NULL e inválido bloqueados (Migration 216)
-- admin está autorizado: tipo_acesso IN ('vice','coordenador','administrador')
-- =============================================================================
INSERT INTO public.participacao_justificativas
  (paroquia_id, escala_id, membro_id, tipo, motivo, solicitado_por, avaliacao)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000015',
   'ausencia', 'Motivo para T13',
   'bbbbbbbb-0000-0000-0000-000000000015',
   'pendente')
ON CONFLICT DO NOTHING;

BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000012"}';

SELECT public.avaliar_justificativa(
  (SELECT id FROM public.participacao_justificativas
   WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
     AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     AND avaliacao = 'pendente' LIMIT 1),
  NULL, NULL
) AS resultado_null;
-- ESPERADO: {"success": false, "error": "avaliacao_obrigatoria"}

SELECT public.avaliar_justificativa(
  (SELECT id FROM public.participacao_justificativas
   WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
     AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     AND avaliacao = 'pendente' LIMIT 1),
  'talvez', NULL
) AS resultado_invalido;
-- ESPERADO: {"success": false, "error": "avaliacao_invalida"}

SELECT avaliacao AS avaliacao_permanece_pendente
FROM public.participacao_justificativas
WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000015'
  AND escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- ESPERADO: 'pendente'

ROLLBACK;


-- =============================================================================
-- T_CONC — SIMULAÇÃO PARCIAL de concorrência (migration 213)
-- =============================================================================
-- LIMITAÇÃO: este teste simula `salvar_presencas_escala` com um UPDATE direto
-- em escala_membros. Isso verifica o comportamento de bloqueio de linha, mas
-- NÃO comprova o comportamento completo da função real com seus triggers e
-- toda a sua ordem de aquisição de locks.
-- Para comprovação integral seria necessário chamar salvar_presencas_escala
-- diretamente em duas sessões com fixtures isoladas.
--
-- EXIGE DUAS CONEXÕES SIMULTÂNEAS (duas abas no SQL Editor do Supabase).
-- NÃO é possível simular com updates sequenciais em uma única sessão.
--
-- PRÉ-CONDIÇÃO: SETUP executado; executar as linhas abaixo para garantir
-- que membro2 tem convocação e linha em escala_membros com status pendente:

INSERT INTO public.escala_convocacoes (escala_id, membro_id, paroquia_id, status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000015',
        'aaaaaaaa-0000-0000-0000-000000000001', 'convocado')
ON CONFLICT (escala_id, membro_id) DO UPDATE SET status = 'convocado';

INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, status, ativo)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000015',
        'aaaaaaaa-0000-0000-0000-000000000003', 'pendente', true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- ABA 1 — SESSÃO A: solicitar_justificativa
-- Executar PASSO 1A e manter aberta (não fazer ROLLBACK/COMMIT ainda).
-- ─────────────────────────────────────────────────────────────────────────────
/*
-- PASSO 1A (aba 1):
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "bbbbbbbb-0000-0000-0000-000000000015"}';

SELECT public.solicitar_justificativa(
  'aaaaaaaa-0000-0000-0000-000000000002',
  'ausencia',
  'Teste concorrência T_CONC'
);
-- Manter aberta. Ir para a aba 2 (PASSO 2B).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- ABA 2 — SESSÃO B: salvar_presencas_escala (simulado por UPDATE direto)
-- Executar PASSO 2B com a sessão A ainda aberta.
-- ─────────────────────────────────────────────────────────────────────────────
/*
-- PASSO 2B (aba 2):
BEGIN;
-- salvar_presencas_escala (migration 190) faz UPDATE por em.id (TID).
-- Simula aqui o lock que a função adquiriria:
UPDATE public.escala_membros
SET status = 'presente'
WHERE escala_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND membro_id = 'aaaaaaaa-0000-0000-0000-000000000015';
-- ESPERADO: sessão B fica waiting (bloqueada) até A completar.
-- NÃO sofre deadlock — migration 213 garante ordem ec → em.
-- Ir para a aba 1 (PASSO 3A).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3A (aba 1): liberar sessão A
-- ─────────────────────────────────────────────────────────────────────────────
/*
COMMIT; -- aba 1 — a sessão B deve desbloquear imediatamente
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4B (aba 2): verificar e finalizar
-- ─────────────────────────────────────────────────────────────────────────────
/*
SELECT status FROM public.escala_membros
WHERE escala_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND membro_id = 'aaaaaaaa-0000-0000-0000-000000000015';
-- ESPERADO: 'presente'
COMMIT;
*/

-- Diagnóstico pós-execução (rodar após ambas as sessões completarem):
SELECT pid, state, wait_event_type, wait_event, left(query,80) AS query_trunc
FROM pg_stat_activity
WHERE state != 'idle'
  AND query LIKE '%aaaaaaaa-0000-0000-0000-000000000002%';
-- ESPERADO: nenhuma linha (todas terminadas sem deadlock)


-- =============================================================================
-- T14 — Diagnóstico retroativo (executar em cópia do banco de produção)
-- =============================================================================
-- DIAGNÓSTICO — não é teste conclusivo de integridade.
--
-- INSTRUÇÃO: substituir a data abaixo pela data/hora real em que a migration 215
-- foi aplicada ao banco de produção (UTC). O valor atual é o commit local —
-- o deploy pode ter ocorrido depois.
--
-- CATEGORIAS:
--   ok                   — exatamente 1 canônico ativo, nenhuma função ativa
--   funcao_nao_anulada   — histórico de função ativo criado APÓS a 215 (bug ativo)
--   funcao_anterior_215  — histórico de função ativo criado ANTES da 215
--                          ATENÇÃO: um registro anterior pode ter continuado ativo
--                          se não houve nova transição após o deploy. Classificação
--                          como "anterior" não comprova que o estado atual está correto
--                          — interpretar manualmente caso a caso.
--   canonical_ausente    — zero canônicos ativos (convocação sem registro canônico)
--   canonical_multiplo   — mais de 1 canônico ativo — investigar manualmente
--
-- ATENÇÃO: canonical_criado_em = NULL indica que nenhum canônico foi criado
-- (categoria canonical_ausente), não que o registro seja anterior à migration.
--
-- NÃO executar correções automáticas — apenas diagnosticar.
-- =============================================================================

-- ════════════════════════════════════════════════════════════════════════
-- SUBSTITUIR a data abaixo pela data real de deploy em produção (UTC).
-- A data do commit é limite inferior — o deploy pode ter sido posterior.
-- Ocorre em DOIS lugares neste bloco (marcados com ← SUBSTITUIR).
-- ════════════════════════════════════════════════════════════════════════
-- Data do commit local (limite inferior): 2026-11-09T22:30:20-03:00

WITH ref AS (
  SELECT '2026-11-09T22:30:20-03:00'::TIMESTAMPTZ AS migration_215_em  -- ← SUBSTITUIR
),
base AS (
  SELECT
    e.id                                                             AS escala_id,
    e.titulo,
    e.data,
    ec.membro_id,
    ec.status,

    COUNT(hp.id) FILTER (
      WHERE hp.tipo_evento = 'convocacao_solene' AND hp.anulada = false
    )                                                                AS canonicos_ativos,

    COUNT(hp.id) FILTER (
      WHERE hp.tipo_evento IN ('escala','solene','bispo')
        AND hp.ministerio_id IS NOT NULL AND hp.anulada = false
    )                                                                AS funcoes_ativas,

    MIN(hp.created_at) FILTER (
      WHERE hp.tipo_evento = 'convocacao_solene'
    )                                                                AS canonical_criado_em,

    MIN(hp.created_at) FILTER (
      WHERE hp.tipo_evento IN ('escala','solene','bispo')
        AND hp.ministerio_id IS NOT NULL AND hp.anulada = false
    )                                                                AS funcao_ativa_criada_em

  FROM public.escalas e
  JOIN public.escala_convocacoes ec ON ec.escala_id = e.id
  LEFT JOIN public.historico_participacoes hp
    ON hp.escala_id = ec.escala_id AND hp.membro_id = ec.membro_id
  WHERE e.solene               = true
    AND e.tem_convocacao_geral = true
    AND ec.status IN ('presente','ausente','justificou')
    AND e.paroquia_id != 'aaaaaaaa-0000-0000-0000-000000000001'
  GROUP BY e.id, e.titulo, e.data, ec.membro_id, ec.status
),
classificado AS (
  SELECT b.*,
    CASE
      WHEN b.funcoes_ativas > 0
        AND b.funcao_ativa_criada_em > r.migration_215_em
      THEN 'funcao_nao_anulada'
      WHEN b.funcoes_ativas > 0
      THEN 'funcao_anterior_215'
      WHEN b.canonicos_ativos = 0
      THEN 'canonical_ausente'
      WHEN b.canonicos_ativos > 1
      THEN 'canonical_multiplo'
      ELSE 'ok'
    END AS classificacao
  FROM base b, ref r
)
SELECT
  escala_id,
  titulo,
  data,
  membro_id,
  status,
  canonicos_ativos,
  funcoes_ativas,
  canonical_criado_em,
  funcao_ativa_criada_em,
  classificacao
FROM classificado
ORDER BY
  CASE classificacao
    WHEN 'funcao_nao_anulada'  THEN 1
    WHEN 'canonical_multiplo'  THEN 2
    WHEN 'canonical_ausente'   THEN 3
    WHEN 'funcao_anterior_215' THEN 4
    ELSE                            5
  END,
  data DESC, membro_id;

-- Resumo por categoria:
WITH ref AS (
  SELECT '2026-11-09T22:30:20-03:00'::TIMESTAMPTZ AS migration_215_em  -- ← SUBSTITUIR
),
base AS (
  SELECT
    e.id AS escala_id, ec.membro_id,
    COUNT(hp.id) FILTER (
      WHERE hp.tipo_evento = 'convocacao_solene' AND hp.anulada = false
    ) AS canonicos_ativos,
    COUNT(hp.id) FILTER (
      WHERE hp.tipo_evento IN ('escala','solene','bispo')
        AND hp.ministerio_id IS NOT NULL AND hp.anulada = false
    ) AS funcoes_ativas,
    MIN(hp.created_at) FILTER (
      WHERE hp.tipo_evento IN ('escala','solene','bispo')
        AND hp.ministerio_id IS NOT NULL AND hp.anulada = false
    ) AS funcao_ativa_criada_em
  FROM public.escalas e
  JOIN public.escala_convocacoes ec ON ec.escala_id = e.id
  LEFT JOIN public.historico_participacoes hp
    ON hp.escala_id = ec.escala_id AND hp.membro_id = ec.membro_id
  WHERE e.solene = true AND e.tem_convocacao_geral = true
    AND ec.status IN ('presente','ausente','justificou')
    AND e.paroquia_id != 'aaaaaaaa-0000-0000-0000-000000000001'
  GROUP BY e.id, ec.membro_id
),
classificado AS (
  SELECT b.*,
    CASE
      WHEN b.funcoes_ativas > 0
        AND b.funcao_ativa_criada_em > r.migration_215_em
        THEN 'funcao_nao_anulada'
      WHEN b.funcoes_ativas > 0  THEN 'funcao_anterior_215'
      WHEN b.canonicos_ativos = 0 THEN 'canonical_ausente'
      WHEN b.canonicos_ativos > 1 THEN 'canonical_multiplo'
      ELSE 'ok'
    END AS classificacao
  FROM base b, ref r
)
SELECT classificacao, COUNT(*) AS qtd
FROM classificado
GROUP BY classificacao
ORDER BY qtd DESC;
-- RESULTADO IDEAL: apenas uma linha com classificacao='ok'


-- =============================================================================
-- TEARDOWN — executar sempre ao final
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'participacao_justificativas') THEN
    DELETE FROM public.participacao_justificativas
    WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  END IF;

  DELETE FROM public.historico_participacoes
  WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'escala_convocacoes') THEN
    DELETE FROM public.escala_convocacoes
    WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  END IF;

  DELETE FROM public.escala_membros
  WHERE escala_id = 'aaaaaaaa-0000-0000-0000-000000000002';

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'coordenadores') THEN
    DELETE FROM public.coordenadores
    WHERE membro_id = 'aaaaaaaa-0000-0000-0000-000000000016';
  END IF;

  DELETE FROM public.membro_ministerios WHERE membro_id = ANY(ARRAY[
    'aaaaaaaa-0000-0000-0000-000000000010'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000011'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000012'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000013'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000014'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000015'::UUID,
    'aaaaaaaa-0000-0000-0000-000000000016'::UUID
  ]);

  DELETE FROM public.membros WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND id = ANY(ARRAY[
      'aaaaaaaa-0000-0000-0000-000000000010'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000011'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000012'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000013'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000014'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000015'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000016'::UUID
    ]);

  DELETE FROM public.ministerios WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND id = ANY(ARRAY[
      'aaaaaaaa-0000-0000-0000-000000000003'::UUID,
      'aaaaaaaa-0000-0000-0000-000000000004'::UUID
    ]);

  PERFORM set_config('app.force_delete_cascade', 'true', true);
  DELETE FROM public.escalas WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
  PERFORM set_config('app.force_delete_cascade', 'false', true);
  DELETE FROM public.paroquia_config_escalas
  WHERE paroquia_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  DELETE FROM public.paroquias WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  DELETE FROM auth.users
  WHERE id = ANY(ARRAY[
      'bbbbbbbb-0000-0000-0000-000000000010'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000011'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000012'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000013'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000014'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000015'::UUID,
      'bbbbbbbb-0000-0000-0000-000000000016'::UUID
    ])
    OR email = ANY(ARRAY[
      'sprintb_membro@_test.internal',
      'sprintb_membro2@_test.internal',
      'sprintb_auxiliar@_test.internal',
      'sprintb_adm_esc@_test.internal',
      'sprintb_adm_nesc@_test.internal',
      'sprintb_sem_vinc@_test.internal',
      'sprintb_coord@_test.internal'
    ]);

  RAISE NOTICE 'Teardown concluído — todos os dados de fixture removidos.';
END;
$$;
