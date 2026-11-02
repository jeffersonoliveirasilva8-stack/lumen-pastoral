-- Auditoria de RLS e SECURITY DEFINER — Comunicação Pastoral + Escala Completa
--
-- Executar em banco de desenvolvimento com migrations 173 e 174 aplicadas.
-- Cada bloco valida um aspecto de segurança.

-- ─────────────────────────────────────────────────────────────────────────────
-- A01: Todas as tabelas novas têm RLS ativado
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tabelas text[] := ARRAY[
    'comunicacao_pastoral_mensagens',
    'comunicacao_pastoral_destinatarios',
    'comunicacao_pastoral_rate_limit'
  ];
  v_t       text;
  v_rls     boolean;
BEGIN
  FOREACH v_t IN ARRAY v_tabelas LOOP
    SELECT rowsecurity INTO v_rls FROM pg_tables
    WHERE tablename = v_t AND schemaname = 'public';
    ASSERT v_rls = true, format('A01 FAIL: RLS não ativado em %s', v_t);
  END LOOP;
  RAISE NOTICE 'A01 PASS: RLS ativado em todas as 3 tabelas novas';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A02: rate_limit tem policy RESTRICTIVE que bloqueia acesso direto
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_policies
  WHERE tablename  = 'comunicacao_pastoral_rate_limit'
    AND permissive = 'RESTRICTIVE';

  ASSERT v_n >= 1, 'A02 FAIL: nenhuma policy RESTRICTIVE em comunicacao_pastoral_rate_limit';
  RAISE NOTICE 'A02 PASS: rate_limit tem policy RESTRICTIVE que bloqueia acesso direto';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A03: service_insert_destinatarios restringe a service_role
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol record;
BEGIN
  SELECT * INTO v_pol FROM pg_policies
  WHERE tablename  = 'comunicacao_pastoral_destinatarios'
    AND policyname = 'service_insert_destinatarios';

  ASSERT FOUND, 'A03 FAIL: policy service_insert_destinatarios não existe';
  -- A expressão deve referenciar auth.role() = 'service_role'
  ASSERT v_pol.with_check LIKE '%service_role%',
    format('A03 FAIL: with_check não menciona service_role: %s', v_pol.with_check);
  RAISE NOTICE 'A03 PASS: service_insert_destinatarios restringe a service_role';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A04: service_update_destinatarios restringe a service_role
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol record;
BEGIN
  SELECT * INTO v_pol FROM pg_policies
  WHERE tablename  = 'comunicacao_pastoral_destinatarios'
    AND policyname = 'service_update_destinatarios';

  ASSERT FOUND, 'A04 FAIL: policy service_update_destinatarios não existe';
  ASSERT v_pol.qual LIKE '%service_role%',
    format('A04 FAIL: USING não menciona service_role: %s', v_pol.qual);
  RAISE NOTICE 'A04 PASS: service_update_destinatarios restringe a service_role';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A05: coord_select_mensagens filtra por paróquia E perfil
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol record;
BEGIN
  SELECT * INTO v_pol FROM pg_policies
  WHERE tablename  = 'comunicacao_pastoral_mensagens'
    AND policyname = 'coord_select_mensagens';

  ASSERT FOUND, 'A05 FAIL: policy coord_select_mensagens não existe';
  ASSERT v_pol.qual LIKE '%paroquia_id%',
    'A05 FAIL: policy não filtra por paroquia_id';
  ASSERT v_pol.qual LIKE '%perfil%' OR v_pol.qual LIKE '%coordenador%',
    'A05 FAIL: policy não filtra por perfil';
  ASSERT v_pol.qual LIKE '%auth.uid()%',
    'A05 FAIL: policy não usa auth.uid()';
  RAISE NOTICE 'A05 PASS: coord_select_mensagens filtra paróquia + perfil + uid';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A06: coord_select_destinatarios junta com mensagem (isolamento de paróquia)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol record;
BEGIN
  SELECT * INTO v_pol FROM pg_policies
  WHERE tablename  = 'comunicacao_pastoral_destinatarios'
    AND policyname = 'coord_select_destinatarios';

  ASSERT FOUND, 'A06 FAIL: policy coord_select_destinatarios não existe';
  ASSERT v_pol.qual LIKE '%comunicacao_pastoral_mensagens%',
    'A06 FAIL: policy não faz join com mensagens (sem isolamento de paróquia)';
  ASSERT v_pol.qual LIKE '%auth.uid()%',
    'A06 FAIL: policy não usa auth.uid()';
  RAISE NOTICE 'A06 PASS: coord_select_destinatarios isolamento via join com mensagens';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A07: coord_enviar_aviso_pastoral é SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_secdef boolean;
BEGIN
  SELECT prosecdef INTO v_secdef FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'coord_enviar_aviso_pastoral';

  ASSERT v_secdef = true, 'A07 FAIL: coord_enviar_aviso_pastoral não é SECURITY DEFINER';
  RAISE NOTICE 'A07 PASS: coord_enviar_aviso_pastoral é SECURITY DEFINER';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A08: coord_enviar_aviso_pastoral valida auth.uid() internamente
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'coord_enviar_aviso_pastoral';

  ASSERT v_src LIKE '%auth.uid()%',
    'A08 FAIL: coord_enviar_aviso_pastoral não usa auth.uid()';
  ASSERT v_src LIKE '%perfil%' OR v_src LIKE '%coordenador%',
    'A08 FAIL: coord_enviar_aviso_pastoral não valida perfil';
  ASSERT v_src LIKE '%paroquia_id%',
    'A08 FAIL: coord_enviar_aviso_pastoral não valida paróquia';
  ASSERT v_src LIKE '%NOT FOUND%' OR v_src LIKE '%Sem permissão%',
    'A08 FAIL: coord_enviar_aviso_pastoral não tem guard de permissão';
  RAISE NOTICE 'A08 PASS: coord_enviar_aviso_pastoral valida uid + perfil + paróquia';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A09: coord_enviar_aviso_pastoral tem rate limiting e limite de destinatários
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'coord_enviar_aviso_pastoral';

  ASSERT v_src LIKE '%rate_limit%',
    'A09 FAIL: sem referência a rate_limit';
  ASSERT v_src LIKE '%c_max_hora%' OR v_src LIKE '%MAX_DISPAROS%',
    'A09 FAIL: sem constante de limite de disparos por hora';
  ASSERT v_src LIKE '%c_max_dest%' OR v_src LIKE '%MAX_DEST%',
    'A09 FAIL: sem constante de limite de destinatários';
  RAISE NOTICE 'A09 PASS: coord_enviar_aviso_pastoral tem rate limiting + limite de destinatários';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A10: triggers de escala_completa são SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_trg_fn_whatsapp_escala_completa_membros',
      '_trg_fn_whatsapp_escala_completa_publicacao',
      '_trg_fn_whatsapp_escala_completa_funcoes'
    )
    AND p.prosecdef = true;

  ASSERT v_n = 3, format('A10 FAIL: %s de 3 funções de trigger são SECURITY DEFINER', v_n);
  RAISE NOTICE 'A10 PASS: todas as 3 funções de trigger de escala_completa são SECURITY DEFINER';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A11: trigger em escala_membros só processa INSERT e reativação (não toda UPDATE)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = '_trg_fn_whatsapp_escala_completa_membros';

  ASSERT v_src LIKE '%OLD.ativo%' OR v_src LIKE '%TG_OP%',
    'A11 FAIL: trigger não tem guard de reativação (OLD.ativo)';
  RAISE NOTICE 'A11 PASS: trigger de membros tem guard contra atualizações sem reativação';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A12: trigger de publicação só processa transição → 'publicada'
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = '_trg_fn_whatsapp_escala_completa_publicacao';

  ASSERT v_src LIKE '%OLD.status%',
    'A12 FAIL: trigger de publicação não verifica OLD.status (permite republicação)';
  ASSERT v_src LIKE '%publicada%',
    'A12 FAIL: trigger de publicação não verifica novo status';
  RAISE NOTICE 'A12 PASS: trigger de publicação tem guard contra republicação';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A13: trigger de funcoes só processa REDUÇÃO de quantidade
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = '_trg_fn_whatsapp_escala_completa_funcoes';

  ASSERT v_src LIKE '%OLD.quantidade%' OR v_src LIKE '%NEW.quantidade%',
    'A13 FAIL: trigger de funcoes não compara OLD/NEW.quantidade';
  RAISE NOTICE 'A13 PASS: trigger de funcoes tem guard para processar apenas reduções';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A14: cp_marcar_pulado — REVOKE de PUBLIC confirmado
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_granted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_name   = 'cp_marcar_pulado'
      AND grantee        = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ) INTO v_granted;

  ASSERT v_granted = false,
    'A14 FAIL: PUBLIC tem EXECUTE em cp_marcar_pulado — REVOKE não funcionou';
  RAISE NOTICE 'A14 PASS: cp_marcar_pulado — PUBLIC não tem EXECUTE';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A15: coord_enviar_aviso_pastoral acessível por authenticated
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_granted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_name   = 'coord_enviar_aviso_pastoral'
      AND grantee        IN ('authenticated', 'PUBLIC')
      AND privilege_type = 'EXECUTE'
  ) INTO v_granted;

  ASSERT v_granted = true,
    'A15 FAIL: coord_enviar_aviso_pastoral não é acessível por authenticated';
  RAISE NOTICE 'A15 PASS: coord_enviar_aviso_pastoral acessível por authenticated (validação interna na função)';
END $$;
