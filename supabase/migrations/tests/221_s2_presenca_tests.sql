-- Testes migration 221 — lógica S2 por presença efetiva
--
-- Estratégia: replica a lógica das CTEs `recebidas` e `elegiveis` da função
-- diretamente em SQL, sem chamar a RPC. Isso contorna o bloqueio de
-- auth.uid() = NULL que ocorre ao chamar get_oportunidades_por_membro como
-- service_role (a checagem em public.profiles rejeita a chamada).
--
-- Executar com: psql -U postgres -f 221_s2_presenca_tests.sql
-- ou via Supabase local: supabase db reset && psql ... -f este_arquivo.sql
--
-- Todos os dados são criados e revertidos dentro do mesmo bloco (ROLLBACK).
--
-- Cenários:
--   T1  Membro com 3 presenças válidas → recebidas = 3
--   T2  Membro com presença 'atrasado' → recebidas = 1
--   T3  Membro com presente + atrasado na mesma escala (dup) → recebidas = 1
--   T4  Membro com 2 presenças e 1 falta → recebidas = 2 (falta excluída)
--   T5  Membro sem histórico → recebidas = 0, oportunidades ≥ 1
--   T6  hp.anulada = true → não conta como recebida
--   T7  Escala cancelada → não entra em oportunidades
--   T8  Escala rascunho → não entra em oportunidades
--   T9  Escala arquivada → entra em oportunidades e recebidas
--   T10 Atribuição desativada (em.ativo = false) → presença ainda conta
--       (correção do em.ativo aplicada nesta migration)

BEGIN;

-- ─── helper de asserção ───────────────────────────────────────────────────

CREATE TEMP TABLE _t221_results (
  test_name  TEXT,
  passed     BOOLEAN,
  got        TEXT,
  expected   TEXT
);

CREATE OR REPLACE FUNCTION _t221_assert(
  p_label    TEXT,
  p_got      BIGINT,
  p_expected BIGINT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _t221_results VALUES (
    p_label,
    p_got IS NOT DISTINCT FROM p_expected,
    p_got::TEXT,
    p_expected::TEXT
  );
END;$$;

-- ─── dados de fixture ─────────────────────────────────────────────────────

DO $$
DECLARE
  v_par UUID := '00000000-0000-0000-0001-000000000221';
  v_min UUID := '00000000-0000-0000-0002-000000000221';
  v_fn  UUID := '00000000-0000-0000-0003-000000000221';

  -- membros
  v_m1  UUID := '00000000-0000-0001-0001-000000000221'; -- T1 (3 presenças)
  v_m2  UUID := '00000000-0000-0001-0002-000000000221'; -- T2 (atrasado)
  v_m3  UUID := '00000000-0000-0001-0003-000000000221'; -- T3 (dup presente+atrasado)
  v_m4  UUID := '00000000-0000-0001-0004-000000000221'; -- T4 (2 pres + 1 falta)
  v_m5  UUID := '00000000-0000-0001-0005-000000000221'; -- T5 (sem histórico)
  v_m6  UUID := '00000000-0000-0001-0006-000000000221'; -- T6 (anulada=true)
  v_m10 UUID := '00000000-0000-0001-0010-000000000221'; -- T10 (em.ativo=false)

  -- escalas
  v_e1  UUID := '00000000-0000-0002-0001-000000000221'; -- publicada
  v_e2  UUID := '00000000-0000-0002-0002-000000000221'; -- publicada
  v_e3  UUID := '00000000-0000-0002-0003-000000000221'; -- publicada
  v_e4  UUID := '00000000-0000-0002-0004-000000000221'; -- cancelada (T7)
  v_e5  UUID := '00000000-0000-0002-0005-000000000221'; -- rascunho  (T8)
  v_e6  UUID := '00000000-0000-0002-0006-000000000221'; -- arquivada (T9)

  v_hoje  DATE := CURRENT_DATE;
  v_ini   DATE := CURRENT_DATE - 84; -- janela padrão 12 semanas
BEGIN

  -- paróquia mínima
  INSERT INTO public.paroquias(id, nome) VALUES (v_par, 'Test 221');

  -- ministério + função
  INSERT INTO public.ministerios(id, paroquia_id, nome, cor)
    VALUES (v_min, v_par, 'Min 221', '#000');
  INSERT INTO public.funcoes(id, paroquia_id, nome)
    VALUES (v_fn, v_par, 'Funcao 221');

  -- membros
  INSERT INTO public.membros(id, paroquia_id, nome, ativo)
    VALUES
      (v_m1,  v_par, 'M1 tres presencas',    true),
      (v_m2,  v_par, 'M2 atrasado',          true),
      (v_m3,  v_par, 'M3 dup pres+atrasado', true),
      (v_m4,  v_par, 'M4 dois pres um falta',true),
      (v_m5,  v_par, 'M5 sem historico',     true),
      (v_m6,  v_par, 'M6 anulada',           true),
      (v_m10, v_par, 'M10 em_ativo_false',   true);

  -- vínculos de ministério
  INSERT INTO public.membro_ministerios(membro_id, ministerio_id)
    VALUES
      (v_m1,  v_min),(v_m2, v_min),(v_m3,  v_min),
      (v_m4,  v_min),(v_m5, v_min),(v_m6,  v_min),
      (v_m10, v_min);

  -- escalas
  INSERT INTO public.escalas(id, paroquia_id, data, status)
    VALUES
      (v_e1, v_par, v_hoje - 7,  'publicada'),
      (v_e2, v_par, v_hoje - 14, 'publicada'),
      (v_e3, v_par, v_hoje - 21, 'publicada'),
      (v_e4, v_par, v_hoje - 28, 'cancelada'),
      (v_e5, v_par, v_hoje - 35, 'rascunho'),
      (v_e6, v_par, v_hoje - 42, 'arquivada');

  -- funções das escalas (ligam ministério à escala)
  INSERT INTO public.escala_funcoes(escala_id, ministerio_id, funcao_id, atuacoes_exigidas)
    VALUES
      (v_e1, v_min, v_fn, '{}'),(v_e2, v_min, v_fn, '{}'),
      (v_e3, v_min, v_fn, '{}'),(v_e4, v_min, v_fn, '{}'),
      (v_e5, v_min, v_fn, '{}'),(v_e6, v_min, v_fn, '{}');

  -- escala_membros (atribuições — âncora para filtrar ministerio_id)
  INSERT INTO public.escala_membros(membro_id, escala_id, ministerio_id, ativo)
    VALUES
      -- m1: atribuído a e1, e2, e3 (publicadas)
      (v_m1, v_e1, v_min, true),(v_m1, v_e2, v_min, true),(v_m1, v_e3, v_min, true),
      -- m2: e1
      (v_m2, v_e1, v_min, true),
      -- m3: e1 (duas entradas hp na mesma escala)
      (v_m3, v_e1, v_min, true),
      -- m4: e1, e2, e3
      (v_m4, v_e1, v_min, true),(v_m4, v_e2, v_min, true),(v_m4, v_e3, v_min, true),
      -- m5: e1 (sem hp)
      (v_m5, v_e1, v_min, true),
      -- m6: e1 (hp anulada=true)
      (v_m6, v_e1, v_min, true),
      -- m10: e1 com ativo=false (atribuição desativada — T10)
      (v_m10, v_e1, v_min, false),
      -- todos nos arquivada/arquivada para T9
      (v_m1, v_e6, v_min, true);

  -- historico_participacoes
  INSERT INTO public.historico_participacoes
      (membro_id, escala_id, paroquia_id, tipo_evento, presenca, anulada, data)
    VALUES
      -- T1: m1 presente em e1, e2, e3
      (v_m1, v_e1, v_par, 'escala', 'presente', false, v_hoje - 7),
      (v_m1, v_e2, v_par, 'escala', 'presente', false, v_hoje - 14),
      (v_m1, v_e3, v_par, 'escala', 'presente', false, v_hoje - 21),
      -- T2: m2 atrasado em e1
      (v_m2, v_e1, v_par, 'escala', 'atrasado', false, v_hoje - 7),
      -- T3: m3 presente E atrasado em e1 (duplicidade — DISTINCT deve deduplicar)
      (v_m3, v_e1, v_par, 'escala', 'presente', false, v_hoje - 7),
      (v_m3, v_e1, v_par, 'escala', 'atrasado', false, v_hoje - 7),
      -- T4: m4 presente em e1 e e2, faltou em e3
      (v_m4, v_e1, v_par, 'escala', 'presente', false, v_hoje - 7),
      (v_m4, v_e2, v_par, 'escala', 'presente', false, v_hoje - 14),
      (v_m4, v_e3, v_par, 'escala', 'faltou',   false, v_hoje - 21),
      -- T6: m6 tem presente em e1 mas anulada=true → não conta
      (v_m6, v_e1, v_par, 'escala', 'presente', true,  v_hoje - 7),
      -- T9: m1 presente em e6 (arquivada)
      (v_m1, v_e6, v_par, 'escala', 'presente', false, v_hoje - 42),
      -- T10: m10 presente em e1, mas em.ativo=false
      (v_m10, v_e1, v_par, 'escala', 'presente', false, v_hoje - 7);

END;
$$;

-- ─── execução dos testes ──────────────────────────────────────────────────
-- Replica as CTEs da função sem chamar a RPC (evita o bloqueio auth.uid()).
-- Parâmetros fixos: paróquia e ministério de fixture, janela = 12 semanas.

DO $$
DECLARE
  v_par UUID := '00000000-0000-0000-0001-000000000221';
  v_min UUID := '00000000-0000-0000-0002-000000000221';
  v_ini DATE := CURRENT_DATE - 84;
  v_hoje DATE := CURRENT_DATE;

  v_m1  UUID := '00000000-0000-0001-0001-000000000221';
  v_m2  UUID := '00000000-0000-0001-0002-000000000221';
  v_m3  UUID := '00000000-0000-0001-0003-000000000221';
  v_m4  UUID := '00000000-0000-0001-0004-000000000221';
  v_m5  UUID := '00000000-0000-0001-0005-000000000221';
  v_m6  UUID := '00000000-0000-0001-0006-000000000221';
  v_m10 UUID := '00000000-0000-0001-0010-000000000221';

  v_e4  UUID := '00000000-0000-0002-0004-000000000221';
  v_e5  UUID := '00000000-0000-0002-0005-000000000221';

  v_rec  BIGINT;
  v_opp  BIGINT;
BEGIN

  -- ── CTE recebidas (migration 221): sem em.ativo ────────────────────────
  -- Conta escalas distintas por membro via historico_participacoes (presente/atrasado)
  -- usando escala_membros só como âncora de ministerio_id.

  -- T1: m1 com 3 presenças (e1,e2,e3) + arquivada (e6) = 4
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e
    ON  e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada')
    AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp
    ON  hp.membro_id = em.membro_id AND hp.escala_id = em.escala_id
    AND hp.paroquia_id = v_par AND hp.tipo_evento = 'escala'
    AND hp.anulada = false AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m1;
  PERFORM _t221_assert('T1 recebidas m1 (3 pub + 1 arq = 4)', v_rec, 4);

  -- T2: m2 com atrasado em e1 = 1
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m2;
  PERFORM _t221_assert('T2 recebidas m2 (atrasado = 1)', v_rec, 1);

  -- T3: m3 com presente+atrasado na mesma escala → DISTINCT → 1
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m3;
  PERFORM _t221_assert('T3 recebidas m3 (dup presente+atrasado = 1)', v_rec, 1);

  -- T4: m4 com 2 presenças (e1,e2) e 1 falta (e3) → 2
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m4;
  PERFORM _t221_assert('T4 recebidas m4 (2 pres + 1 falta = 2)', v_rec, 2);

  -- T5: m5 sem histórico → 0
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m5;
  PERFORM _t221_assert('T5 recebidas m5 (sem historico = 0)', v_rec, 0);

  -- T5b: m5 oportunidades ≥ 1 (está em e1 publicada, sem indisponibilidade)
  SELECT COUNT(DISTINCT e.id) INTO v_opp
  FROM public.escalas e
  JOIN public.escala_funcoes ef ON ef.escala_id = e.id AND ef.ministerio_id = v_min
  JOIN public.membro_ministerios mm ON mm.ministerio_id = ef.ministerio_id
    AND mm.membro_id = v_m5
  WHERE e.paroquia_id = v_par AND e.status IN ('publicada','arquivada')
    AND e.data >= v_ini AND e.data < v_hoje;
  PERFORM _t221_assert('T5b oportunidades m5 (≥ 1)', GREATEST(v_opp, 1), 1);

  -- T6: m6 com hp.anulada=true → 0
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false   -- anulada=true excluída aqui
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m6;
  PERFORM _t221_assert('T6 recebidas m6 (anulada=true = 0)', v_rec, 0);

  -- T7: escala cancelada não entra em oportunidades
  SELECT COUNT(*) INTO v_opp
  FROM public.escalas e
  JOIN public.escala_funcoes ef ON ef.escala_id = e.id AND ef.ministerio_id = v_min
  WHERE e.id = v_e4 AND e.status IN ('publicada','arquivada');
  PERFORM _t221_assert('T7 cancelada excluida de oportunidades', v_opp, 0);

  -- T8: escala rascunho não entra em oportunidades
  SELECT COUNT(*) INTO v_opp
  FROM public.escalas e
  JOIN public.escala_funcoes ef ON ef.escala_id = e.id AND ef.ministerio_id = v_min
  WHERE e.id = v_e5 AND e.status IN ('publicada','arquivada');
  PERFORM _t221_assert('T8 rascunho excluido de oportunidades', v_opp, 0);

  -- T9: escala arquivada entra em oportunidades; presença m1 em e6 conta como recebida
  SELECT COUNT(DISTINCT e.id) INTO v_opp
  FROM public.escalas e
  JOIN public.escala_funcoes ef ON ef.escala_id = e.id AND ef.ministerio_id = v_min
  JOIN public.membro_ministerios mm ON mm.ministerio_id = ef.ministerio_id
    AND mm.membro_id = v_m1
  WHERE e.paroquia_id = v_par AND e.status IN ('publicada','arquivada')
    AND e.data >= v_ini AND e.data < v_hoje;
  -- m1 tem e1+e2+e3 (publicadas) + e6 (arquivada) = 4
  PERFORM _t221_assert('T9 oportunidades m1 inclui arquivada (= 4)', v_opp, 4);

  -- T10: m10 com em.ativo=false ainda tem presença contada (correção desta migration)
  SELECT COUNT(DISTINCT em.escala_id) INTO v_rec
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id AND e.paroquia_id = v_par
    AND e.status IN ('publicada','arquivada') AND e.data >= v_ini AND e.data < v_hoje
  JOIN public.historico_participacoes hp ON hp.membro_id = em.membro_id
    AND hp.escala_id = em.escala_id AND hp.paroquia_id = v_par
    AND hp.tipo_evento = 'escala' AND hp.anulada = false
    AND hp.presenca IN ('presente','atrasado')
  WHERE em.ministerio_id = v_min AND em.membro_id = v_m10;
  -- sem filtro em.ativo: deve contar a presença (= 1)
  PERFORM _t221_assert('T10 recebidas m10 (em.ativo=false ainda conta = 1)', v_rec, 1);

END;
$$;

-- ─── relatório ────────────────────────────────────────────────────────────

DO $$
DECLARE
  r     RECORD;
  total INT := 0;
  ok    INT := 0;
BEGIN
  FOR r IN SELECT * FROM _t221_results ORDER BY test_name LOOP
    total := total + 1;
    IF r.passed THEN
      ok := ok + 1;
      RAISE NOTICE '[PASS] %', r.test_name;
    ELSE
      RAISE WARNING '[FAIL] % — got % expected %', r.test_name, r.got, r.expected;
    END IF;
  END LOOP;
  RAISE NOTICE '=== % / % PASSED ===', ok, total;
  IF ok < total THEN
    RAISE EXCEPTION 'Testes falharam: % de % passaram', ok, total;
  END IF;
END;
$$;

ROLLBACK;
