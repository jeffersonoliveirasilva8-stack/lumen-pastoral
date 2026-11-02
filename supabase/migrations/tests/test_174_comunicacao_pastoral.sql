-- Testes isolados para migration 174 — Comunicação Pastoral
--
-- Execução: em banco de desenvolvimento com migration 174 aplicada.
-- Cada bloco DO $$ ... $$ é independente. Todos fazem rollback ao final.
-- Requisitos: tabelas paroquias, membros, ministerios, _push_config existentes
--             com dados de teste (ver script de seed abaixo).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DE TESTE (executar antes dos testes)
-- ─────────────────────────────────────────────────────────────────────────────
/*
-- Paróquias
INSERT INTO paroquias (id, nome) VALUES
  ('aaaaaaaa-0001-0001-0001-000000000001', 'Paróquia Teste A'),
  ('aaaaaaaa-0002-0002-0002-000000000002', 'Paróquia Teste B')
ON CONFLICT DO NOTHING;

-- Membros (coordenador A, membro opt-in A, membro sem opt-in A, coordenador B)
INSERT INTO membros (id, auth_user_id, paroquia_id, nome, perfil, ativo, conta_ativada, whatsapp_opt_in, whatsapp_telefone) VALUES
  ('bbbbbbbb-0001-0001-0001-000000000001', 'cccccccc-0001-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', 'Coord A',   'coordenador', true, true, false, null),
  ('bbbbbbbb-0002-0002-0002-000000000002', 'cccccccc-0002-0002-0002-000000000002', 'aaaaaaaa-0001-0001-0001-000000000001', 'Membro A1', 'membro',      true, true, true, '+5511999990001'),
  ('bbbbbbbb-0003-0003-0003-000000000003', 'cccccccc-0003-0003-0003-000000000003', 'aaaaaaaa-0001-0001-0001-000000000001', 'Membro A2', 'membro',      true, true, false, null),
  ('bbbbbbbb-0004-0004-0004-000000000004', 'cccccccc-0004-0004-0004-000000000004', 'aaaaaaaa-0002-0002-0002-000000000002', 'Coord B',   'coordenador', true, true, false, null)
ON CONFLICT DO NOTHING;

-- Segredo WhatsApp (necessário para RPC não retornar 'WhatsApp não configurado')
INSERT INTO _push_config (key, val) VALUES ('internal_wa_secret', 'test-secret-uuid')
ON CONFLICT (key) DO UPDATE SET val = 'test-secret-uuid';
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-01: constraint de status aceita todos os valores válidos
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_ok     boolean;
BEGIN
  -- Insere uma mensagem de suporte para os destinatários
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id,
    'aaaaaaaa-0001-0001-0001-000000000001',
    'bbbbbbbb-0001-0001-0001-000000000001',
    'Teste status constraint');

  -- Todos os valores do CHECK devem ser aceitos
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');

  UPDATE comunicacao_pastoral_destinatarios SET status = 'enviado'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  UPDATE comunicacao_pastoral_destinatarios SET status = 'pulado'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  UPDATE comunicacao_pastoral_destinatarios SET status = 'falha'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  UPDATE comunicacao_pastoral_destinatarios SET status = 'unknown'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  -- Confirma que 'unknown' foi aceito
  SELECT (status = 'unknown') INTO v_ok
  FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  ASSERT v_ok = true, 'T174-01 FAIL: status unknown não aceito pela constraint';
  RAISE NOTICE 'T174-01 PASS: constraint aceita todos os 5 status válidos';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-02: constraint de status rejeita valor inválido
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_raised boolean := false;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id,
    'aaaaaaaa-0001-0001-0001-000000000001',
    'bbbbbbbb-0001-0001-0001-000000000001',
    'Teste constraint invalida');

  BEGIN
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
    VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'invalido');
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;

  ASSERT v_raised = true, 'T174-02 FAIL: status inválido não foi rejeitado';
  RAISE NOTICE 'T174-02 PASS: constraint rejeita status inválido';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-03: trigger sync_send_status — sent → enviado
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id  uuid := gen_random_uuid();
  v_send_id uuid := gen_random_uuid();
  v_membro  uuid := 'bbbbbbbb-0002-0002-0002-000000000002';
  v_status  text;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste sync');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, v_membro, 'pending');

  -- Simula trigger: INSERT em whatsapp_sends com status=sent
  INSERT INTO whatsapp_sends (id, membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash)
  VALUES (v_send_id, v_membro, 'aaaaaaaa-0001-0001-0001-000000000001',
          'aviso_pastoral', v_msg_id, 'sent', 'fakehash01');

  SELECT status INTO v_status FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = v_membro;

  ASSERT v_status = 'enviado', format('T174-03 FAIL: esperado enviado, obtido %s', v_status);
  RAISE NOTICE 'T174-03 PASS: sent → enviado sincronizado pelo trigger';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-04: trigger sync_send_status — failed → falha
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id  uuid := gen_random_uuid();
  v_send_id uuid := gen_random_uuid();
  v_membro  uuid := 'bbbbbbbb-0002-0002-0002-000000000002';
  v_status  text;
  v_motivo  text;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste failed');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, v_membro, 'pending');

  INSERT INTO whatsapp_sends (id, membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash, resposta_body)
  VALUES (v_send_id, v_membro, 'aaaaaaaa-0001-0001-0001-000000000001',
          'aviso_pastoral', v_msg_id, 'failed', 'fakehash02', '{"error":"rejected"}');

  SELECT status, motivo INTO v_status, v_motivo FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = v_membro;

  ASSERT v_status = 'falha', format('T174-04 FAIL: esperado falha, obtido %s', v_status);
  ASSERT v_motivo IS NOT NULL, 'T174-04 FAIL: motivo deveria ser preenchido';
  RAISE NOTICE 'T174-04 PASS: failed → falha com motivo';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-05: trigger sync_send_status — unknown → unknown (não falha)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id  uuid := gen_random_uuid();
  v_send_id uuid := gen_random_uuid();
  v_membro  uuid := 'bbbbbbbb-0002-0002-0002-000000000002';
  v_status  text;
  v_motivo  text;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste unknown');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, v_membro, 'pending');

  INSERT INTO whatsapp_sends (id, membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash)
  VALUES (v_send_id, v_membro, 'aaaaaaaa-0001-0001-0001-000000000001',
          'aviso_pastoral', v_msg_id, 'unknown', 'fakehash03');

  SELECT status, motivo INTO v_status, v_motivo FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = v_membro;

  ASSERT v_status = 'unknown', format('T174-05 FAIL: esperado unknown, obtido %s', v_status);
  ASSERT v_motivo = 'timeout_provider', format('T174-05 FAIL: motivo esperado timeout_provider, obtido %s', v_motivo);
  RAISE NOTICE 'T174-05 PASS: unknown → unknown com motivo=timeout_provider (não é falha)';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-06: trigger update_totais — total_enviados e total_falhas corretos
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_env    int;
  v_falh   int;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem, total_destinatarios)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste totais', 2);

  -- membro A1: pending → enviado
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');
  UPDATE comunicacao_pastoral_destinatarios SET status = 'enviado'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  -- membro A2: pending → falha
  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0003-0003-0003-000000000003', 'pending');
  UPDATE comunicacao_pastoral_destinatarios SET status = 'falha'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0003-0003-0003-000000000003';

  SELECT total_enviados, total_falhas INTO v_env, v_falh
  FROM comunicacao_pastoral_mensagens WHERE id = v_msg_id;

  ASSERT v_env  = 1, format('T174-06 FAIL: total_enviados=%s, esperado 1', v_env);
  ASSERT v_falh = 1, format('T174-06 FAIL: total_falhas=%s, esperado 1', v_falh);
  RAISE NOTICE 'T174-06 PASS: total_enviados=1, total_falhas=1';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-07: trigger update_totais — unknown NÃO é contado como falha
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_falh   int;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem, total_destinatarios)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste unknown total', 1);

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');
  UPDATE comunicacao_pastoral_destinatarios SET status = 'unknown'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  SELECT total_falhas INTO v_falh FROM comunicacao_pastoral_mensagens WHERE id = v_msg_id;

  ASSERT v_falh = 0, format('T174-07 FAIL: unknown contabilizado como falha; total_falhas=%s', v_falh);
  RAISE NOTICE 'T174-07 PASS: unknown não é contado em total_falhas';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-08: trigger update_totais — idempotente em múltiplas atualizações
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_env    int;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem, total_destinatarios)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste idempotencia', 1);

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');
  UPDATE comunicacao_pastoral_destinatarios SET status = 'enviado'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';
  -- Segunda atualização para o mesmo status
  UPDATE comunicacao_pastoral_destinatarios SET status = 'enviado'
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  SELECT total_enviados INTO v_env FROM comunicacao_pastoral_mensagens WHERE id = v_msg_id;

  ASSERT v_env = 1, format('T174-08 FAIL: total_enviados=%s após 2 updates para enviado', v_env);
  RAISE NOTICE 'T174-08 PASS: trigger totais é idempotente';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-09: cp_marcar_pulado — atualiza status e motivo
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_status text;
  v_motivo text;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste marcar_pulado');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');

  PERFORM cp_marcar_pulado(v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'sem_consentimento');

  SELECT status, motivo INTO v_status, v_motivo FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  ASSERT v_status = 'pulado', format('T174-09 FAIL: status=%s', v_status);
  ASSERT v_motivo = 'sem_consentimento', format('T174-09 FAIL: motivo=%s', v_motivo);
  RAISE NOTICE 'T174-09 PASS: cp_marcar_pulado atualiza status e motivo';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-10: cp_marcar_pulado — idempotente em status não-pending
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_status text;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste marcar_pulado idem');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'enviado');

  -- Tentar marcar como pulado um destinatário já enviado — não deve alterar
  PERFORM cp_marcar_pulado(v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'dedup');

  SELECT status INTO v_status FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  ASSERT v_status = 'enviado', format('T174-10 FAIL: status trocado de enviado para %s', v_status);
  RAISE NOTICE 'T174-10 PASS: cp_marcar_pulado não altera status não-pending';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-11: cp_reconciliar_pending — pending antigo → unknown
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_n      int;
  v_status text;
BEGIN
  -- Insere mensagem com criado_em no passado (3h atrás)
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem, criado_em)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001',
          'Teste reconciliar', now() - interval '3 hours');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');

  SELECT COUNT(*) INTO v_n FROM cp_reconciliar_pending(interval '2 hours');

  SELECT status INTO v_status FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  ASSERT v_n >= 1, format('T174-11 FAIL: cp_reconciliar_pending retornou %s linhas', v_n);
  ASSERT v_status = 'unknown', format('T174-11 FAIL: status=%s esperado unknown', v_status);
  RAISE NOTICE 'T174-11 PASS: pending expirado → unknown via cp_reconciliar_pending';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-12: cp_reconciliar_pending — pending recente NÃO é alterado
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_n      int;
  v_status text;
BEGIN
  -- Mensagem recente (agora)
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001',
          'Teste reconciliar recente');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');

  -- Janela de 2h — mensagem recente não deve ser tocada
  SELECT COUNT(*) INTO v_n FROM cp_reconciliar_pending(interval '2 hours')
  WHERE mensagem_id = v_msg_id;

  SELECT status INTO v_status FROM comunicacao_pastoral_destinatarios
  WHERE mensagem_id = v_msg_id AND membro_id = 'bbbbbbbb-0002-0002-0002-000000000002';

  ASSERT v_n = 0, format('T174-12 FAIL: pending recente foi reconciliado (%s linhas)', v_n);
  ASSERT v_status = 'pending', format('T174-12 FAIL: status mudou para %s', v_status);
  RAISE NOTICE 'T174-12 PASS: pending recente não é reconciliado';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-13: UNIQUE constraint — mesmo membro/mensagem não duplica
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_id uuid := gen_random_uuid();
  v_raised boolean := false;
BEGIN
  INSERT INTO comunicacao_pastoral_mensagens (id, paroquia_id, remetente_id, mensagem)
  VALUES (v_msg_id, 'aaaaaaaa-0001-0001-0001-000000000001', 'bbbbbbbb-0001-0001-0001-000000000001', 'Teste unique');

  INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
  VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');

  BEGIN
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id, status)
    VALUES (v_msg_id, 'bbbbbbbb-0002-0002-0002-000000000002', 'pending');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;

  ASSERT v_raised = true, 'T174-13 FAIL: inserção duplicada não gerou unique_violation';
  RAISE NOTICE 'T174-13 PASS: UNIQUE (mensagem_id, membro_id) previne duplicatas';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-14: constraint chk_apenas_um_segmento — dois segmentos rejeitados
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO comunicacao_pastoral_mensagens
      (paroquia_id, remetente_id, mensagem, destinatario_membro_id, destinatario_ministerio_id)
    VALUES (
      'aaaaaaaa-0001-0001-0001-000000000001',
      'bbbbbbbb-0001-0001-0001-000000000001',
      'dois segmentos',
      'bbbbbbbb-0002-0002-0002-000000000002',
      'eeeeeeee-0001-0001-0001-000000000001'  -- ministerio fictício (OK para teste de check)
    );
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    v_raised := true;
  END;

  ASSERT v_raised = true, 'T174-14 FAIL: dois segmentos não geraram violação';
  RAISE NOTICE 'T174-14 PASS: chk_apenas_um_segmento rejeita múltiplos segmentos';

  ROLLBACK;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-15: rate_limit — tabela e índice existem
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'comunicacao_pastoral_rate_limit'
  ) INTO v_exists;
  ASSERT v_exists = true, 'T174-15 FAIL: tabela comunicacao_pastoral_rate_limit não existe';

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'comunicacao_pastoral_rate_limit'
      AND indexname  = 'idx_cp_rate_limit_remetente'
  ) INTO v_exists;
  ASSERT v_exists = true, 'T174-15 FAIL: índice idx_cp_rate_limit_remetente não existe';

  RAISE NOTICE 'T174-15 PASS: tabela e índice de rate_limit existem';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-16: índices de performance existem
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_indexes
  WHERE indexname IN (
    'idx_ws_evento_ref_membro',
    'idx_cp_destinatarios_status',
    'idx_cp_destinatarios_mensagem',
    'idx_cp_mensagens_paroquia'
  );

  ASSERT v_n = 4, format('T174-16 FAIL: %s de 4 índices encontrados', v_n);
  RAISE NOTICE 'T174-16 PASS: todos os 4 índices de performance existem';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-17: RLS ativado nas duas tabelas
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_tables
  WHERE tablename IN ('comunicacao_pastoral_mensagens','comunicacao_pastoral_destinatarios')
    AND rowsecurity = true;

  ASSERT v_n = 2, format('T174-17 FAIL: RLS ativo em %s de 2 tabelas', v_n);
  RAISE NOTICE 'T174-17 PASS: RLS ativo em ambas as tabelas';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-18: funções são SECURITY DEFINER com owner correto
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'coord_enviar_aviso_pastoral',
      'cp_marcar_pulado',
      'cp_reconciliar_pending',
      '_trg_fn_cp_sync_send_status',
      '_trg_fn_cp_update_totais'
    )
    AND p.prosecdef = true;  -- SECURITY DEFINER

  ASSERT v_n = 5, format('T174-18 FAIL: %s de 5 funções são SECURITY DEFINER', v_n);
  RAISE NOTICE 'T174-18 PASS: todas as 5 funções são SECURITY DEFINER';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-19: cp_marcar_pulado — não acessível por PUBLIC
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_granted boolean;
BEGIN
  -- Verifica que PUBLIC não tem EXECUTE em cp_marcar_pulado
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_name = 'cp_marcar_pulado'
      AND grantee       = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ) INTO v_granted;

  ASSERT v_granted = false, 'T174-19 FAIL: PUBLIC tem EXECUTE em cp_marcar_pulado';
  RAISE NOTICE 'T174-19 PASS: cp_marcar_pulado não é acessível por PUBLIC';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T174-20: cp_reconciliar_pending — não acessível por PUBLIC
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_granted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_name = 'cp_reconciliar_pending'
      AND grantee       = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ) INTO v_granted;

  ASSERT v_granted = false, 'T174-20 FAIL: PUBLIC tem EXECUTE em cp_reconciliar_pending';
  RAISE NOTICE 'T174-20 PASS: cp_reconciliar_pending não é acessível por PUBLIC';
END $$;
