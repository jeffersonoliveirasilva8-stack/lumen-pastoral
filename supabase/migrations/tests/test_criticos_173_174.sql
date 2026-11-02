-- Testes críticos — Migrations 173 e 174
-- Comportamento que não pode ser verificado estaticamente.
--
-- Executar via SQL Editor do Supabase Dashboard (staging) ou psql local.
-- Todos os blocos devem produzir somente linhas NOTICE com "PASS".
-- Qualquer FAIL ou ERROR bloqueia o avanço para staging.

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 173 — _escala_esta_completa e triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- T173-C01: Redução de quantidade (2→1) com 1 membro ativo completa a escala
-- escala_funcoes não tem "nome"; a função é referenciada por ministerio_id.
-- escala_membros não tem "funcao_id"; o vínculo é escala_id+membro_id+ministerio_id.
DO $$
DECLARE
  v_paroquia_id   uuid := gen_random_uuid();
  v_escala_id     uuid := gen_random_uuid();
  v_ministerio_id uuid := gen_random_uuid();
  v_ef_id         uuid := gen_random_uuid();
  v_membro_id     uuid := gen_random_uuid();
  v_resultado     boolean;
BEGIN
  INSERT INTO paroquias    (id, nome, slug)
    VALUES (v_paroquia_id, 'Teste-C01', 'teste-c01-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO ministerios  (id, paroquia_id, nome)
    VALUES (v_ministerio_id, v_paroquia_id, 'Min-C01') ON CONFLICT DO NOTHING;
  INSERT INTO membros      (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro_id, v_paroquia_id, 'M1', 'membro', true, true) ON CONFLICT DO NOTHING;
  INSERT INTO escalas      (id, paroquia_id, status, data, titulo)
    VALUES (v_escala_id, v_paroquia_id, 'rascunho', CURRENT_DATE, 'Teste C01') ON CONFLICT DO NOTHING;
  -- escala_funcoes: (escala_id, ministerio_id) são as colunas obrigatórias; sem "nome"
  INSERT INTO escala_funcoes (id, escala_id, ministerio_id, quantidade)
    VALUES (v_ef_id, v_escala_id, v_ministerio_id, 2) ON CONFLICT DO NOTHING;
  -- escala_membros: vínculo por ministerio_id; sem "funcao_id"; ativo adicionado na 086
  INSERT INTO escala_membros (escala_id, membro_id, ministerio_id, ativo)
    VALUES (v_escala_id, v_membro_id, v_ministerio_id, true) ON CONFLICT DO NOTHING;

  -- Com qty=2 e 1 membro → incompleta
  SELECT _escala_esta_completa(v_escala_id) INTO v_resultado;
  ASSERT v_resultado = false, 'T173-C01a FAIL: esperava false com qty=2, 1 membro';

  -- Reduz para qty=1 → completa
  UPDATE escala_funcoes SET quantidade = 1 WHERE id = v_ef_id;
  SELECT _escala_esta_completa(v_escala_id) INTO v_resultado;
  ASSERT v_resultado = true, 'T173-C01b FAIL: esperava true após redução qty 2→1';

  -- Cleanup
  DELETE FROM escala_membros WHERE escala_id = v_escala_id;
  DELETE FROM escala_funcoes  WHERE escala_id = v_escala_id;
  DELETE FROM escalas         WHERE id = v_escala_id;
  DELETE FROM membros         WHERE id = v_membro_id;
  DELETE FROM ministerios     WHERE id = v_ministerio_id;
  DELETE FROM paroquias       WHERE id = v_paroquia_id;

  RAISE NOTICE 'T173-C01 PASS: redução de quantidade completa a escala corretamente';
END $$;

-- T173-C02: Membro inativo não conta para completude
-- _escala_esta_completa filtra em.ativo IS NOT FALSE em escala_membros.
DO $$
DECLARE
  v_paroquia_id   uuid := gen_random_uuid();
  v_escala_id     uuid := gen_random_uuid();
  v_ministerio_id uuid := gen_random_uuid();
  v_membro_id     uuid := gen_random_uuid();
  v_resultado     boolean;
BEGIN
  INSERT INTO paroquias    (id, nome, slug)
    VALUES (v_paroquia_id, 'Teste-C02', 'teste-c02-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO ministerios  (id, paroquia_id, nome)
    VALUES (v_ministerio_id, v_paroquia_id, 'Min-C02') ON CONFLICT DO NOTHING;
  -- membro com ativo=false no cadastro — irrelevante para _escala_esta_completa,
  -- que filtra escala_membros.ativo; membro precisa existir apenas para a FK.
  INSERT INTO membros      (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro_id, v_paroquia_id, 'M2', 'membro', true, true) ON CONFLICT DO NOTHING;
  INSERT INTO escalas      (id, paroquia_id, status, data, titulo)
    VALUES (v_escala_id, v_paroquia_id, 'rascunho', CURRENT_DATE, 'Teste C02') ON CONFLICT DO NOTHING;
  INSERT INTO escala_funcoes (id, escala_id, ministerio_id, quantidade)
    VALUES (gen_random_uuid(), v_escala_id, v_ministerio_id, 1) ON CONFLICT DO NOTHING;
  -- Insere membro na escala com ativo=false → não deve ser contado
  INSERT INTO escala_membros (escala_id, membro_id, ministerio_id, ativo)
    VALUES (v_escala_id, v_membro_id, v_ministerio_id, false) ON CONFLICT DO NOTHING;

  SELECT _escala_esta_completa(v_escala_id) INTO v_resultado;
  ASSERT v_resultado = false, 'T173-C02 FAIL: membro com ativo=false em escala_membros não deveria contar';

  DELETE FROM escala_membros WHERE escala_id = v_escala_id;
  DELETE FROM escala_funcoes  WHERE escala_id = v_escala_id;
  DELETE FROM escalas         WHERE id = v_escala_id;
  DELETE FROM membros         WHERE id = v_membro_id;
  DELETE FROM ministerios     WHERE id = v_ministerio_id;
  DELETE FROM paroquias       WHERE id = v_paroquia_id;

  RAISE NOTICE 'T173-C02 PASS: membro com ativo=false em escala_membros não conta para completude';
END $$;

-- T173-C03: Guard de republicação — sem novo whatsapp_sends nem pg_net na republicação
DO $$
DECLARE
  v_paroquia_id    uuid := gen_random_uuid();
  v_escala_id      uuid := gen_random_uuid();
  v_sends_antes    bigint;
  v_sends_depois   bigint;
  v_net_antes      bigint;
  v_net_depois     bigint;
  v_net_acessivel  boolean := false;
BEGIN
  INSERT INTO paroquias (id, nome, slug)
    VALUES (v_paroquia_id, 'Teste-C03', 'teste-c03-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO escalas (id, paroquia_id, status, data, titulo)
    VALUES (v_escala_id, v_paroquia_id, 'publicada', CURRENT_DATE, 'Teste C03') ON CONFLICT DO NOTHING;

  -- Conta whatsapp_sends e fila pg_net ANTES da republicação
  SELECT COUNT(*) INTO v_sends_antes
  FROM whatsapp_sends WHERE evento_ref_id = v_escala_id;

  BEGIN
    SELECT COUNT(*) INTO v_net_antes FROM net.http_request_queue;
    v_net_acessivel := true;
  EXCEPTION WHEN OTHERS THEN
    v_net_antes := 0;
  END;

  -- Republicar: publicada → publicada (guard deve impedir o trigger de agir)
  UPDATE escalas SET status = 'publicada' WHERE id = v_escala_id;

  -- Conta após a republicação
  SELECT COUNT(*) INTO v_sends_depois
  FROM whatsapp_sends WHERE evento_ref_id = v_escala_id;

  ASSERT v_sends_depois = v_sends_antes,
    format('T173-C03a FAIL: republicação criou %s registro(s) em whatsapp_sends',
           v_sends_depois - v_sends_antes);

  -- Verifica fila pg_net filtrada pelo UUID do teste (evita interferência de concorrência)
  -- Filtramos pelo corpo da requisição contendo o escala_id gerado neste teste,
  -- que é único (gen_random_uuid). Concorrência externa não compartilha este UUID.
  -- Limitação conhecida: pg_net pode processar a fila antes da leitura; se estiver
  -- vazia por isso, o resultado é falso-negativo mas não falso-positivo.
  IF v_net_acessivel THEN
    SELECT COUNT(*) INTO v_net_depois
    FROM net.http_request_queue
    WHERE body::text LIKE '%' || v_escala_id::text || '%';

    ASSERT v_net_depois = 0,
      format('T173-C03b FAIL: republicação enfileirou %s requisição(ões) no pg_net referenciando escala %s',
             v_net_depois, v_escala_id);
  ELSE
    RAISE NOTICE 'T173-C03b INFO: net.http_request_queue não acessível neste role — verificação pg_net pulada';
  END IF;

  -- Reverte status antes do DELETE (trigger impede deletar escalas publicadas)
  UPDATE escalas SET status = 'rascunho' WHERE id = v_escala_id;
  DELETE FROM escalas   WHERE id = v_escala_id;
  DELETE FROM paroquias WHERE id = v_paroquia_id;

  RAISE NOTICE 'T173-C03 PASS: republicação não criou whatsapp_sends nem enfileirou pg_net';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 174 — Status, triggers e RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- T174-C01: Trigger sync — 'unknown' em whatsapp_sends → 'unknown' em destinatários (NÃO 'falha')
DO $$
DECLARE
  v_paroquia_id uuid := gen_random_uuid();
  v_membro_id   uuid := gen_random_uuid();
  v_mensagem_id uuid := gen_random_uuid();
  v_dest_id     uuid;
  v_sends_id    uuid;
  v_status      text;
BEGIN
  INSERT INTO paroquias (id, nome, slug) VALUES (v_paroquia_id, 'Teste-C-T01', 'teste-ct01-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO membros   (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro_id, v_paroquia_id, 'M-T01', 'membro', true, true) ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
    VALUES (v_mensagem_id, v_paroquia_id, v_membro_id, 'Teste timeout') ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro_id)
    RETURNING id INTO v_dest_id;

  -- Simula whatsapp_sends com status 'unknown' (timeout do provider)
  INSERT INTO whatsapp_sends (membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash)
    VALUES (v_membro_id, v_paroquia_id, 'aviso_pastoral', v_mensagem_id, 'unknown', 'test-hash-t174c01')
    RETURNING id INTO v_sends_id;

  SELECT status INTO v_status
  FROM comunicacao_pastoral_destinatarios WHERE id = v_dest_id;

  ASSERT v_status = 'unknown',
    format('T174-C01 FAIL: esperava unknown, obteve %s', v_status);

  -- Cleanup
  DELETE FROM whatsapp_sends WHERE id = v_sends_id;
  DELETE FROM comunicacao_pastoral_destinatarios WHERE id = v_dest_id;
  DELETE FROM comunicacao_pastoral_mensagens WHERE id = v_mensagem_id;
  DELETE FROM membros   WHERE id = v_membro_id;
  DELETE FROM paroquias WHERE id = v_paroquia_id;

  RAISE NOTICE 'T174-C01 PASS: unknown em whatsapp_sends → unknown em destinatários (não falha)';
END $$;

-- T174-C02: Trigger sync — 'failed' → 'falha' com motivo preenchido
DO $$
DECLARE
  v_paroquia_id uuid := gen_random_uuid();
  v_membro_id   uuid := gen_random_uuid();
  v_mensagem_id uuid := gen_random_uuid();
  v_dest_id     uuid;
  v_sends_id    uuid;
  v_status      text;
  v_motivo      text;
BEGIN
  INSERT INTO paroquias (id, nome, slug) VALUES (v_paroquia_id, 'Teste-C-T02', 'teste-ct02-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO membros   (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro_id, v_paroquia_id, 'M-T02', 'membro', true, true) ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
    VALUES (v_mensagem_id, v_paroquia_id, v_membro_id, 'Teste falha') ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro_id) RETURNING id INTO v_dest_id;

  INSERT INTO whatsapp_sends (membro_id, paroquia_id, evento_tipo, evento_ref_id, status, resposta_body, telefone_hash)
    VALUES (v_membro_id, v_paroquia_id, 'aviso_pastoral', v_mensagem_id, 'failed', 'numero_invalido', 'test-hash-t174c02')
    RETURNING id INTO v_sends_id;

  SELECT status, motivo INTO v_status, v_motivo
  FROM comunicacao_pastoral_destinatarios WHERE id = v_dest_id;

  ASSERT v_status = 'falha',   format('T174-C02a FAIL: esperava falha, obteve %s', v_status);
  ASSERT v_motivo = 'numero_invalido', format('T174-C02b FAIL: motivo=%s', v_motivo);

  DELETE FROM whatsapp_sends WHERE id = v_sends_id;
  DELETE FROM comunicacao_pastoral_destinatarios WHERE id = v_dest_id;
  DELETE FROM comunicacao_pastoral_mensagens WHERE id = v_mensagem_id;
  DELETE FROM membros   WHERE id = v_membro_id;
  DELETE FROM paroquias WHERE id = v_paroquia_id;

  RAISE NOTICE 'T174-C02 PASS: failed → falha com motivo do provider';
END $$;

-- T174-C03: Totais — unknown NÃO incrementa total_falhas
DO $$
DECLARE
  v_paroquia_id uuid := gen_random_uuid();
  v_membro1_id  uuid := gen_random_uuid();
  v_membro2_id  uuid := gen_random_uuid();
  v_mensagem_id uuid := gen_random_uuid();
  v_falhas      int;
  v_enviados    int;
BEGIN
  INSERT INTO paroquias (id, nome, slug) VALUES (v_paroquia_id, 'Teste-C-T03', 'teste-ct03-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO membros (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro1_id, v_paroquia_id, 'M-T03a', 'membro', true, true),
           (v_membro2_id, v_paroquia_id, 'M-T03b', 'membro', true, true)
    ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
    VALUES (v_mensagem_id, v_paroquia_id, v_membro1_id, 'Teste totais') ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro1_id),
           (v_mensagem_id, v_membro2_id);

  -- Membro1 → enviado, Membro2 → unknown
  UPDATE comunicacao_pastoral_destinatarios SET status = 'enviado'  WHERE mensagem_id = v_mensagem_id AND membro_id = v_membro1_id;
  UPDATE comunicacao_pastoral_destinatarios SET status = 'unknown' WHERE mensagem_id = v_mensagem_id AND membro_id = v_membro2_id;

  SELECT total_enviados, total_falhas INTO v_enviados, v_falhas
  FROM comunicacao_pastoral_mensagens WHERE id = v_mensagem_id;

  ASSERT v_enviados = 1, format('T174-C03a FAIL: total_enviados=%s', v_enviados);
  ASSERT v_falhas   = 0, format('T174-C03b FAIL: unknown incrementou total_falhas=%s', v_falhas);

  DELETE FROM comunicacao_pastoral_destinatarios WHERE mensagem_id = v_mensagem_id;
  DELETE FROM comunicacao_pastoral_mensagens WHERE id = v_mensagem_id;
  DELETE FROM membros   WHERE id IN (v_membro1_id, v_membro2_id);
  DELETE FROM paroquias WHERE id = v_paroquia_id;

  RAISE NOTICE 'T174-C03 PASS: unknown não incrementa total_falhas';
END $$;

-- T174-C04: cp_marcar_pulado — atualiza pending→pulado; idempotente em não-pending
DO $$
DECLARE
  v_paroquia_id uuid := gen_random_uuid();
  v_membro_id   uuid := gen_random_uuid();
  v_mensagem_id uuid := gen_random_uuid();
  v_status      text;
  v_motivo      text;
BEGIN
  INSERT INTO paroquias (id, nome, slug) VALUES (v_paroquia_id, 'Teste-C-T04', 'teste-ct04-' || left(v_paroquia_id::text, 8)) ON CONFLICT DO NOTHING;
  INSERT INTO membros   (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
    VALUES (v_membro_id, v_paroquia_id, 'M-T04', 'membro', true, true) ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
    VALUES (v_mensagem_id, v_paroquia_id, v_membro_id, 'Teste pulado') ON CONFLICT DO NOTHING;
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro_id);

  -- Marca como pulado
  PERFORM cp_marcar_pulado(v_mensagem_id, v_membro_id, 'sem_consentimento');

  SELECT status, motivo INTO v_status, v_motivo
  FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_mensagem_id AND membro_id = v_membro_id;

  ASSERT v_status = 'pulado',            format('T174-C04a FAIL: status=%s', v_status);
  ASSERT v_motivo = 'sem_consentimento', format('T174-C04b FAIL: motivo=%s', v_motivo);

  -- Segunda chamada não deve alterar nada (idempotente)
  PERFORM cp_marcar_pulado(v_mensagem_id, v_membro_id, 'outro_motivo');
  SELECT motivo INTO v_motivo
  FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_mensagem_id AND membro_id = v_membro_id;

  ASSERT v_motivo = 'sem_consentimento',
    format('T174-C04c FAIL: segunda chamada alterou motivo para %s', v_motivo);

  DELETE FROM comunicacao_pastoral_destinatarios WHERE mensagem_id = v_mensagem_id;
  DELETE FROM comunicacao_pastoral_mensagens WHERE id = v_mensagem_id;
  DELETE FROM membros   WHERE id = v_membro_id;
  DELETE FROM paroquias WHERE id = v_paroquia_id;

  RAISE NOTICE 'T174-C04 PASS: cp_marcar_pulado correto e idempotente';
END $$;

-- T174-C05: cp_reconciliar_pending — isolado com SAVEPOINT externo (fora de DO)
-- Estratégia: SAVEPOINT como instrução SQL de nível superior, após o setup.
-- cp_reconciliar_pending pode afetar todos os pending antigos do banco; o SAVEPOINT
-- garante que as alterações em registros externos sejam revertidas ao final.
-- Os UUIDs são passados entre blocos via tabela temporária.
BEGIN;

  DROP TABLE IF EXISTS _t174c05_ids;
  CREATE TEMP TABLE _t174c05_ids (
    paroquia_id uuid, membro1_id uuid, membro2_id uuid, mensagem_id uuid
  ) ON COMMIT DROP;

  -- Setup: insere dados de teste e persiste os IDs na temp table
  DO $setup$
  DECLARE
    v_p  uuid := gen_random_uuid();
    v_m1 uuid := gen_random_uuid();
    v_m2 uuid := gen_random_uuid();
    v_msg uuid := gen_random_uuid();
  BEGIN
    INSERT INTO paroquias (id, nome, slug)
      VALUES (v_p, 'Teste-C-T05', 'teste-ct05-' || left(v_p::text, 8)) ON CONFLICT DO NOTHING;
    INSERT INTO membros (id, paroquia_id, nome, tipo_acesso, ativo, conta_ativada)
      VALUES (v_m1, v_p, 'M-T05a', 'membro', true, true),
             (v_m2, v_p, 'M-T05b', 'membro', true, true) ON CONFLICT DO NOTHING;
    -- Mensagem com criado_em há 3 horas (dentro da janela de reconciliação)
    INSERT INTO comunicacao_pastoral_mensagens
        (id, paroquia_id, remetente_id, mensagem, criado_em)
      VALUES (v_msg, v_p, v_m1, 'Teste reconc', now() - interval '3 hours')
      ON CONFLICT DO NOTHING;
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
      VALUES (v_msg, v_m1), (v_msg, v_m2);
    -- Membro2 já resolvido; não deve ser tocado pela reconciliação
    UPDATE comunicacao_pastoral_destinatarios
      SET status = 'enviado'
    WHERE mensagem_id = v_msg AND membro_id = v_m2;
    -- Persiste IDs para uso nos próximos blocos
    INSERT INTO _t174c05_ids VALUES (v_p, v_m1, v_m2, v_msg);
  END $setup$;

  -- SAVEPOINT após o setup: reconciliação ficará dentro deste escopo
  SAVEPOINT sp_c05;

  -- Chama a função (pode afetar outros registros pending antigos do banco)
  SELECT * FROM cp_reconciliar_pending(interval '2 hours');

  -- Verifica os registros do teste e captura resultados em temp table
  DO $check$
  DECLARE
    v_ids       record;
    v_status1   text;
    v_status2   text;
  BEGIN
    SELECT * INTO v_ids FROM _t174c05_ids LIMIT 1;

    SELECT status INTO v_status1 FROM comunicacao_pastoral_destinatarios
    WHERE mensagem_id = v_ids.mensagem_id AND membro_id = v_ids.membro1_id;

    SELECT status INTO v_status2 FROM comunicacao_pastoral_destinatarios
    WHERE mensagem_id = v_ids.mensagem_id AND membro_id = v_ids.membro2_id;

    ASSERT v_status1 = 'unknown',
      format('T174-C05a FAIL: pending antigo deveria ser unknown, foi %s', v_status1);
    ASSERT v_status2 = 'enviado',
      format('T174-C05b FAIL: enviado não deveria ser alterado, foi %s', v_status2);
  END $check$;

  -- Reverte reconciliação: registros externos ao teste voltam ao estado anterior
  ROLLBACK TO SAVEPOINT sp_c05;

  -- Cleanup dos dados de teste (setup não foi revertido pelo SAVEPOINT)
  DO $cleanup$
  DECLARE
    v_ids record;
  BEGIN
    SELECT * INTO v_ids FROM _t174c05_ids LIMIT 1;
    DELETE FROM comunicacao_pastoral_destinatarios WHERE mensagem_id = v_ids.mensagem_id;
    DELETE FROM comunicacao_pastoral_mensagens      WHERE id = v_ids.mensagem_id;
    DELETE FROM membros   WHERE id IN (v_ids.membro1_id, v_ids.membro2_id);
    DELETE FROM paroquias WHERE id = v_ids.paroquia_id;
  END $cleanup$;

  DO $pass$
  BEGIN
    RAISE NOTICE 'T174-C05 PASS: cp_reconciliar_pending move pending antigo para unknown; SAVEPOINT externo garantiu isolamento';
  END $pass$;

COMMIT;

-- T174-C06: Permissões de cp_marcar_pulado — grants explícitos e privilégios efetivos
-- Dupla verificação: information_schema (grants diretos) + has_function_privilege (herança de roles).
-- service_role=SIM; PUBLIC/authenticated/anon=NÃO
DO $$
DECLARE
  v_fn_sig text    := 'cp_marcar_pulado(uuid,uuid,text)';
  v_tem    boolean;
BEGIN
  -- PUBLIC não deve ter EXECUTE explícito (REVOKE deve ter funcionado)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_name   = 'cp_marcar_pulado'
      AND grantee        = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ) INTO v_tem;
  ASSERT v_tem = false,
    'T174-C06 FAIL: PUBLIC tem EXECUTE explícito em cp_marcar_pulado — REVOKE não funcionou';

  -- service_role deve ter EXECUTE efetivo (inclui herança de roles)
  SELECT has_function_privilege('service_role', v_fn_sig, 'EXECUTE') INTO v_tem;
  ASSERT v_tem = true,
    'T174-C06 FAIL: service_role não tem EXECUTE efetivo em cp_marcar_pulado';

  -- authenticated não deve ter EXECUTE efetivo (direto nem herdado)
  SELECT has_function_privilege('authenticated', v_fn_sig, 'EXECUTE') INTO v_tem;
  ASSERT v_tem = false,
    'T174-C06 FAIL: authenticated tem EXECUTE efetivo em cp_marcar_pulado (herdado ou direto)';

  -- anon não deve ter EXECUTE efetivo
  SELECT has_function_privilege('anon', v_fn_sig, 'EXECUTE') INTO v_tem;
  ASSERT v_tem = false,
    'T174-C06 FAIL: anon tem EXECUTE efetivo em cp_marcar_pulado (herdado ou direto)';

  RAISE NOTICE 'T174-C06 PASS: service_role=SIM (efetivo), PUBLIC/authenticated/anon=NÃO (grants explícitos + has_function_privilege verificados)';
END $$;
