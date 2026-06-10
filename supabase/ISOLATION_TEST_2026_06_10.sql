-- ============================================================
-- ISOLATION_TEST_2026_06_10.sql
-- Teste de isolamento multi-tenant — Paróquia A vs Paróquia B
-- ============================================================
-- Execute no SQL Editor do Supabase (super_admin).
--
-- O que este script testa:
--   1. Dados de paróquias vizinhas não vaze via RLS
--   2. RPCs do portal só devolvem dados do token owner
--   3. Coordenação de A não consegue ler registros de B
--      mesmo passando o ID diretamente
--
-- Resultado esperado: todos os blocos devem retornar 0 (zero) ou
-- mensagens de "ISOLADO". Qualquer contagem > 0 é uma brecha.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SETUP: Identificar as duas paróquias de teste
-- Substitua os UUIDs abaixo pelos IDs reais do seu banco.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- UUIDs das duas paróquias de teste
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_nome_a     TEXT;
  v_nome_b     TEXT;

  v_membros_a  BIGINT;
  v_membros_b  BIGINT;
  v_escalas_a  BIGINT;
  v_escalas_b  BIGINT;
  v_notif_a    BIGINT;
  v_notif_b    BIGINT;

  v_ok         BOOLEAN := TRUE;
BEGIN
  -- Pega as duas primeiras paróquias (ajuste conforme seu ambiente de teste)
  SELECT id, nome INTO v_paroquia_a, v_nome_a
  FROM public.paroquias ORDER BY created_at LIMIT 1;

  SELECT id, nome INTO v_paroquia_b, v_nome_b
  FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  IF v_paroquia_a IS NULL OR v_paroquia_b IS NULL THEN
    RAISE EXCEPTION 'São necessárias pelo menos 2 paróquias para executar este teste.';
  END IF;

  RAISE NOTICE '==========================================';
  RAISE NOTICE 'TESTE DE ISOLAMENTO MULTI-TENANT';
  RAISE NOTICE 'Paróquia A: % (%)', v_nome_a, v_paroquia_a;
  RAISE NOTICE 'Paróquia B: % (%)', v_nome_b, v_paroquia_b;
  RAISE NOTICE '==========================================';

  -- ── Contagens para referência ──────────────────────────────
  SELECT COUNT(*) INTO v_membros_a FROM public.membros WHERE paroquia_id = v_paroquia_a;
  SELECT COUNT(*) INTO v_membros_b FROM public.membros WHERE paroquia_id = v_paroquia_b;
  SELECT COUNT(*) INTO v_escalas_a FROM public.escalas WHERE paroquia_id = v_paroquia_a;
  SELECT COUNT(*) INTO v_escalas_b FROM public.escalas WHERE paroquia_id = v_paroquia_b;
  SELECT COUNT(*) INTO v_notif_a   FROM public.notificacoes WHERE paroquia_id = v_paroquia_a;
  SELECT COUNT(*) INTO v_notif_b   FROM public.notificacoes WHERE paroquia_id = v_paroquia_b;

  RAISE NOTICE 'Membros A: % | Membros B: %', v_membros_a, v_membros_b;
  RAISE NOTICE 'Escalas A: % | Escalas B: %', v_escalas_a, v_escalas_b;
  RAISE NOTICE 'Notif A:   % | Notif B:   %', v_notif_a,   v_notif_b;
  RAISE NOTICE '';

  RAISE NOTICE '-- INICIANDO TESTES DE ISOLAMENTO --';
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 1: RLS em membros
-- Simula SELECT de um usuário autenticado da paróquia A.
-- Deve retornar 0 membros da paróquia B.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_count      BIGINT;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  -- Pega um usuário da paróquia A (admin_paroquial)
  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  IF v_user_a IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 1 — Nenhum admin na paróquia A para simular. Crie um coordenador de teste.';
    RETURN;
  END IF;

  -- set_config simula auth.uid() = v_user_a para o restante da transação
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  SELECT COUNT(*) INTO v_count
  FROM public.membros
  WHERE paroquia_id = v_paroquia_b;

  IF v_count = 0 THEN
    RAISE NOTICE '[OK] Bloco 1 — RLS membros: usuário A não vê membros de B (0 registros vazados)';
  ELSE
    RAISE WARNING '[FALHA] Bloco 1 — RLS membros: % membros da paróquia B visíveis para usuário A!', v_count;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 2: RLS em escalas
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_count      BIGINT;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  IF v_user_a IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 2 — Nenhum admin na paróquia A.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  SELECT COUNT(*) INTO v_count
  FROM public.escalas
  WHERE paroquia_id = v_paroquia_b;

  IF v_count = 0 THEN
    RAISE NOTICE '[OK] Bloco 2 — RLS escalas: usuário A não vê escalas de B';
  ELSE
    RAISE WARNING '[FALHA] Bloco 2 — RLS escalas: % escalas de B visíveis para A!', v_count;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 3: RLS em notificações
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_count      BIGINT;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  IF v_user_a IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 3 — Nenhum admin na paróquia A.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  SELECT COUNT(*) INTO v_count
  FROM public.notificacoes
  WHERE paroquia_id = v_paroquia_b;

  IF v_count = 0 THEN
    RAISE NOTICE '[OK] Bloco 3 — RLS notificações: usuário A não vê notificações de B';
  ELSE
    RAISE WARNING '[FALHA] Bloco 3 — RLS notificações: % notificações de B visíveis para A!', v_count;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 4: RLS em indisponibilidades
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_count      BIGINT;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  IF v_user_a IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 4 — Nenhum admin na paróquia A.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  SELECT COUNT(*) INTO v_count
  FROM public.indisponibilidades
  WHERE paroquia_id = v_paroquia_b;

  IF v_count = 0 THEN
    RAISE NOTICE '[OK] Bloco 4 — RLS indisponibilidades: usuário A não vê dados de B';
  ELSE
    RAISE WARNING '[FALHA] Bloco 4 — RLS indisponibilidades: % registros de B visíveis para A!', v_count;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 5: Tentativa de INSERT na paróquia B por usuário de A
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_blocked    BOOLEAN := TRUE;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  IF v_user_a IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 5 — Nenhum admin na paróquia A.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  BEGIN
    -- Tentativa de INSERT em notificacoes da paróquia B
    INSERT INTO public.notificacoes (paroquia_id, tipo, titulo, mensagem)
    VALUES (v_paroquia_b, 'aviso', 'TESTE ISOLAMENTO — DEVE FALHAR', 'Se aparecer, há brecha de isolamento');
    v_blocked := FALSE;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;

  IF v_blocked THEN
    RAISE NOTICE '[OK] Bloco 5 — INSERT cross-tenant bloqueado por RLS';
  ELSE
    RAISE WARNING '[FALHA] Bloco 5 — INSERT cross-tenant PERMITIDO! Verificar política de notificacoes.';
    -- Rollback do INSERT indevido
    DELETE FROM public.notificacoes
    WHERE paroquia_id = v_paroquia_b
      AND titulo = 'TESTE ISOLAMENTO — DEVE FALHAR';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 6: RPC portal — membro de A não acessa dados de B
-- Testa que portal_get_membro() não retorna dados de outro tenant
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a   UUID;
  v_paroquia_b   UUID;
  v_token_b      UUID;
  v_result       JSON;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  -- Pega um token_acesso válido de um membro de B
  SELECT token_acesso INTO v_token_b
  FROM public.membros
  WHERE paroquia_id = v_paroquia_b
    AND ativo = true
    AND token_acesso IS NOT NULL
    AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now())
  LIMIT 1;

  IF v_token_b IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 6 — Nenhum membro ativo com token em B.';
    RETURN;
  END IF;

  -- A RPC é SECURITY DEFINER — não usa RLS, mas deve validar o token
  -- Se retornar null, o isolamento está correto (token de B não retorna dados de A)
  v_result := public.portal_get_membro(v_token_b);

  IF v_result IS NOT NULL THEN
    RAISE NOTICE '[OK] Bloco 6 — RPC portal: token de B retorna dados de B (esperado)';
    -- Verificar se retornou dados de B, não de A
    IF (v_result::jsonb ->> 'paroquia_id') = v_paroquia_b::text THEN
      RAISE NOTICE '[OK] Bloco 6b — paroquia_id no retorno corresponde à paróquia B (isolamento correto)';
    ELSE
      RAISE WARNING '[FALHA] Bloco 6b — RPC retornou paroquia_id diferente de B!';
    END IF;
  ELSE
    RAISE NOTICE '[INFO] Bloco 6 — RPC retornou null para token de B (token pode estar expirado)';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 7: Cross-tenant via URL manipulation (escalas por ID)
-- Simula admin de A tentando ler escalas de B passando IDs diretamente
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_paroquia_a UUID;
  v_paroquia_b UUID;
  v_user_a     UUID;
  v_escala_b   UUID;
  v_count      BIGINT;
BEGIN
  SELECT id INTO v_paroquia_a FROM public.paroquias ORDER BY created_at LIMIT 1;
  SELECT id INTO v_paroquia_b FROM public.paroquias ORDER BY created_at LIMIT 1 OFFSET 1;

  SELECT ur.user_id INTO v_user_a
  FROM public.user_roles ur
  WHERE ur.paroquia_id = v_paroquia_a
    AND ur.role IN ('admin_paroquial', 'coordenador')
  LIMIT 1;

  SELECT id INTO v_escala_b
  FROM public.escalas
  WHERE paroquia_id = v_paroquia_b
  LIMIT 1;

  IF v_user_a IS NULL OR v_escala_b IS NULL THEN
    RAISE WARNING '[SKIP] Bloco 7 — Dados insuficientes para o teste.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true);

  -- Tenta ler escala de B passando o UUID diretamente (simula manipulação de URL)
  SELECT COUNT(*) INTO v_count
  FROM public.escalas
  WHERE id = v_escala_b;

  IF v_count = 0 THEN
    RAISE NOTICE '[OK] Bloco 7 — RLS escalas (by ID): admin A não consegue ler escala de B por UUID direto';
  ELSE
    RAISE WARNING '[FALHA] Bloco 7 — Admin A conseguiu ler escala de B por UUID direto! Brecha de isolamento.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- BLOCO 8: Verificação de políticas via pg_policies
-- Gera relatório de todas as políticas ativas
-- ────────────────────────────────────────────────────────────
SELECT
  tablename           AS tabela,
  policyname          AS política,
  cmd                 AS comando,
  qual                AS condição_using,
  with_check          AS condição_with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- ────────────────────────────────────────────────────────────
-- BLOCO 9: Resumo das tabelas SEM RLS
-- Qualquer tabela aqui merece atenção
-- ────────────────────────────────────────────────────────────
SELECT
  tablename             AS "Tabela sem RLS",
  'VERIFICAR'           AS "Ação recomendada"
FROM pg_tables
WHERE schemaname = 'public'
  AND NOT rowsecurity
ORDER BY tablename;

-- ────────────────────────────────────────────────────────────
-- FIM DO TESTE
-- Resultado esperado: todos os blocos [OK], nenhuma tabela
-- crítica na lista "Tabela sem RLS" acima.
-- ────────────────────────────────────────────────────────────
SELECT 'Teste de isolamento concluído. Verifique os NOTICE e WARNING acima.' AS resultado;
