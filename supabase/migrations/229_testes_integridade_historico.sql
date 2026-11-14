-- Migration 229 — Testes de integridade: histórico, arquivamento e duplicidade manual
--
-- Execute com: npx supabase db query --linked --file supabase/migrations/229_testes_integridade_historico.sql
-- Todos os testes devem retornar ok=true.

DO $$
DECLARE
  v_count    INT;
  v_result   BOOLEAN;
  v_txt      TEXT;
BEGIN

  -- ── T1: RPC verificar_pendentes_arquivamento existe e é callable ──────────
  PERFORM public.verificar_pendentes_arquivamento('00000000-0000-0000-0000-000000000000'::UUID);
  RAISE NOTICE 'T1 ok=true: verificar_pendentes_arquivamento callable';

  -- ── T2: RPC retorna vazio para escala inexistente ─────────────────────────
  SELECT COUNT(*) INTO v_count
  FROM public.verificar_pendentes_arquivamento('00000000-0000-0000-0000-000000000000'::UUID);
  IF v_count <> 0 THEN RAISE EXCEPTION 'T2 FAIL: esperado 0 linhas para escala inexistente, recebeu %', v_count; END IF;
  RAISE NOTICE 'T2 ok=true: RPC retorna vazio para escala inexistente';

  -- ── T3: RPC verificar_membro_ja_escalado existe e é callable ─────────────
  SELECT ja_escalado INTO v_result
  FROM public.verificar_membro_ja_escalado(
    '00000000-0000-0000-0000-000000000000'::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID
  );
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T3 FAIL: esperado false para IDs inexistentes, recebeu %', v_result;
  END IF;
  RAISE NOTICE 'T3 ok=true: verificar_membro_ja_escalado retorna false para IDs inexistentes';

  -- ── T4: Gustavo Calado — historico presente após migration 226 ─────────────
  SELECT COUNT(*) INTO v_count
  FROM public.historico_participacoes hp
  JOIN public.escala_membros em ON em.id = 'c91d5fd1-f2bc-418c-8894-2bd118f4e44f'::UUID
  WHERE hp.membro_id    = em.membro_id
    AND hp.escala_id    = em.escala_id
    AND hp.ministerio_id = em.ministerio_id
    AND hp.presenca     = 'presente'
    AND (hp.anulada IS NULL OR hp.anulada = false);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'T4 FAIL: historico de Gustavo Calado 23/10 não encontrado — migration 226 não aplicada?';
  END IF;
  RAISE NOTICE 'T4 ok=true: historico de Gustavo Calado 23/10 presente (count=%)', v_count;

  -- ── T5: Gustavo — sem duplicidade (exatamente 1 registro) ─────────────────
  SELECT COUNT(*) INTO v_count
  FROM public.historico_participacoes hp
  JOIN public.escala_membros em ON em.id = 'c91d5fd1-f2bc-418c-8894-2bd118f4e44f'::UUID
  WHERE hp.membro_id    = em.membro_id
    AND hp.escala_id    = em.escala_id
    AND hp.ministerio_id = em.ministerio_id
    AND (hp.anulada IS NULL OR hp.anulada = false);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL: esperado exatamente 1 registro para Gustavo 23/10, encontrado %', v_count;
  END IF;
  RAISE NOTICE 'T5 ok=true: exatamente 1 registro de historico para Gustavo 23/10';

  -- ── T6: RPC duplicidade — escala e paróquia inexistentes retornam false ───
  SELECT ja_escalado INTO v_result
  FROM public.verificar_membro_ja_escalado(
    '00000000-0000-0000-0000-000000000001'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID
  );
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T6 FAIL: esperado false para IDs inexistentes, recebeu %', v_result;
  END IF;
  RAISE NOTICE 'T6 ok=true: RPC retorna false para paróquia/escala inexistentes';

  RAISE NOTICE '────────────────────────────────────────────';
  RAISE NOTICE 'Todos os testes concluídos.';
END;
$$;
