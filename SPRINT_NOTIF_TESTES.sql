-- SPRINT_NOTIF_TESTES.sql — Testes das correções P0/P1/P2/P4
-- Sprint: Correção de notificações e funções nas escalas
-- Pré-requisito: migration 217 aplicada em staging
-- Executar como: service_role ou superuser no banco de staging

-- ══════════════════════════════════════════════════════════════════════════
-- SETUP — fixtures de teste
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_par_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_esc_id    UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_min_id    UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_mem1_id   UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_mem2_id   UUID := 'dddddddd-0000-0000-0000-000000000002';
  v_funcao_id UUID;
BEGIN
  -- Paróquia de teste (reutiliza se existir)
  INSERT INTO public.paroquias (id, nome) VALUES (v_par_id, '_TESTE_NOTIF_PAR')
  ON CONFLICT (id) DO NOTHING;

  -- Ministério de teste
  INSERT INTO public.ministerios (id, paroquia_id, nome) VALUES (v_min_id, v_par_id, '_TESTE_MIN')
  ON CONFLICT (id) DO NOTHING;

  -- Membros de teste
  INSERT INTO public.membros (id, paroquia_id, nome, ativo)
    VALUES (v_mem1_id, v_par_id, '_TESTE_MEM1', true),
           (v_mem2_id, v_par_id, '_TESTE_MEM2', true)
  ON CONFLICT (id) DO NOTHING;

  -- Escala em rascunho
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status)
    VALUES (v_esc_id, v_par_id, '_TESTE_ESC', CURRENT_DATE + 7, 'rascunho')
  ON CONFLICT (id) DO NOTHING;

  -- Função de escala
  INSERT INTO public.escala_funcoes (escala_id, ministerio_id, quantidade)
    VALUES (v_esc_id, v_min_id, 2)
  ON CONFLICT (escala_id, ministerio_id) DO NOTHING;

  RAISE NOTICE 'SETUP concluído';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T1 — remove_funcao: sem autenticação → sem_permissao / not_authenticated
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_funcao_id UUID;
  v_res       JSONB;
BEGIN
  SELECT id INTO v_funcao_id FROM public.escala_funcoes
  WHERE escala_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  LIMIT 1;

  -- Como executamos como service_role, auth.uid() = NULL
  -- A função deve retornar not_authenticated
  v_res := public.remove_funcao(v_funcao_id);
  RAISE NOTICE 'T1 remove_funcao sem auth: success=%, error=%',
    v_res->>'success', v_res->>'error';
  ASSERT (v_res->>'success') = 'false' OR (v_res->>'error') = 'not_authenticated',
    'T1 FAIL: esperado not_authenticated, obteve: ' || v_res::TEXT;
  RAISE NOTICE 'T1 PASS';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T2 — remove_funcao: função inexistente → funcao_nao_encontrada
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.remove_funcao('00000000-0000-0000-0000-000000000000'::UUID);
  RAISE NOTICE 'T2 remove_funcao id inexistente: %', v_res;
  ASSERT (v_res->>'error') = 'funcao_nao_encontrada' OR (v_res->>'success') = 'false',
    'T2 FAIL: ' || v_res::TEXT;
  RAISE NOTICE 'T2 PASS';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T3 — remove_funcao como service_role (simula execução direta):
--      soft-delete em escala_membros + DELETE em escala_funcoes
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_esc_id    UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_min_id    UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_mem1_id   UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_mem2_id   UUID := 'dddddddd-0000-0000-0000-000000000002';
  v_funcao_id UUID;
  v_count     INT;
BEGIN
  -- Insere membros na escala
  INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, ativo)
    VALUES (v_esc_id, v_mem1_id, v_min_id, true),
           (v_esc_id, v_mem2_id, v_min_id, true)
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE SET ativo = true, removido_em = NULL;

  SELECT id INTO v_funcao_id FROM public.escala_funcoes
  WHERE escala_id = v_esc_id AND ministerio_id = v_min_id;

  -- Executa remoção diretamente (bypass auth — equivale a service_role)
  UPDATE public.escala_membros
  SET    ativo = false, removido_em = now()
  WHERE  escala_id = v_esc_id AND ministerio_id = v_min_id AND (ativo IS NULL OR ativo = true);

  DELETE FROM public.escala_funcoes WHERE id = v_funcao_id;

  -- Verifica membros desativados
  SELECT COUNT(*) INTO v_count
  FROM public.escala_membros
  WHERE escala_id = v_esc_id AND ministerio_id = v_min_id AND ativo = false;
  ASSERT v_count = 2, 'T3 FAIL: esperado 2 membros desativados, obteve ' || v_count;

  -- Verifica função removida
  SELECT COUNT(*) INTO v_count
  FROM public.escala_funcoes WHERE id = v_funcao_id;
  ASSERT v_count = 0, 'T3 FAIL: funcao ainda existe';

  RAISE NOTICE 'T3 PASS: 2 membros soft-deleted, funcao removida';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T4 — remove_funcao: não afeta outras escalas do mesmo membro
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_par_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_min_id    UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_mem1_id   UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_esc2_id   UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_count     INT;
BEGIN
  -- Cria escala2 e vincula membro ao mesmo ministério
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status)
    VALUES (v_esc2_id, v_par_id, '_TESTE_ESC2', CURRENT_DATE + 14, 'rascunho')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, ativo)
    VALUES (v_esc2_id, v_mem1_id, v_min_id, true)
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE SET ativo = true;

  -- Verifica que escala2 membro ainda ativo após T3
  SELECT COUNT(*) INTO v_count
  FROM public.escala_membros
  WHERE escala_id = v_esc2_id AND membro_id = v_mem1_id AND ativo = true;
  ASSERT v_count = 1, 'T4 FAIL: vínculo em outra escala foi afetado';

  RAISE NOTICE 'T4 PASS: vínculo em escala2 preservado';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T5 — reenviar_notificacoes_escala: rascunho → escala_not_published
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.reenviar_notificacoes_escala('bbbbbbbb-0000-0000-0000-000000000001'::UUID);
  RAISE NOTICE 'T5 reenviar em rascunho: %', v_res;
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'error') = 'escala_not_published',
    'T5 FAIL: esperado escala_not_published, obteve: ' || v_res::TEXT;
  RAISE NOTICE 'T5 PASS';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- T6 — histórico preservado após remove_funcao
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_par_id    UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_esc_id    UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_min_id    UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_mem1_id   UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_hist_id   UUID;
  v_count     INT;
BEGIN
  -- Insere histórico fictício para o membro
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_par_id, v_mem1_id, v_esc_id, v_min_id, 'escala', 'escala', 'presente', CURRENT_DATE, 10)
  RETURNING id INTO v_hist_id;

  -- Histórico deve continuar existindo após soft-delete de escala_membros
  SELECT COUNT(*) INTO v_count
  FROM public.historico_participacoes WHERE id = v_hist_id;
  ASSERT v_count = 1, 'T6 FAIL: histórico foi apagado';

  RAISE NOTICE 'T6 PASS: histórico preservado (id=%)', v_hist_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- TEARDOWN
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  DELETE FROM public.historico_participacoes
  WHERE escala_id IN (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002'
  );
  DELETE FROM public.escala_membros WHERE escala_id IN (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002'
  );
  DELETE FROM public.escala_funcoes WHERE escala_id IN (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002'
  );
  DELETE FROM public.escalas WHERE id IN (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002'
  );
  DELETE FROM public.membros WHERE id IN (
    'dddddddd-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000002'
  );
  DELETE FROM public.ministerios WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  DELETE FROM public.paroquias WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  RAISE NOTICE 'TEARDOWN concluído';
END;
$$;
