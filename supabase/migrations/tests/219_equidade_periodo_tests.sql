-- Testes para get_equidade_periodo (migration 219 v5 — I5: indisponibilidade sincronizada)
-- Pré-requisito: migration 219 aplicada
-- Executar como service_role ou superuser
-- ============================================================

DO $$
DECLARE
  v_par   UUID := 'aaaaaaaa-1900-0000-0000-000000000001';
  v_min1  UUID := 'cccccccc-1900-0000-0000-000000000001';
  v_min2  UUID := 'cccccccc-1900-0000-0000-000000000002';
  v_m1    UUID := 'dddddddd-1900-0000-0000-000000000001'; -- membro com 2 funções mesma escala
  v_m2    UUID := 'dddddddd-1900-0000-0000-000000000002'; -- membro com indisponibilidade
  v_m3    UUID := 'dddddddd-1900-0000-0000-000000000003'; -- membro elegível sem escala
  v_m4    UUID := 'dddddddd-1900-0000-0000-000000000004'; -- membro que somente faltou
  v_e1    UUID := 'eeeeeeee-1900-0000-0000-000000000001'; -- escala passada publicada (2 funções) - 2026-10-15
  v_e2    UUID := 'eeeeeeee-1900-0000-0000-000000000002'; -- escala futura publicada (data 2030)
  v_e3    UUID := 'eeeeeeee-1900-0000-0000-000000000003'; -- escala cancelada
  v_e4    UUID := 'eeeeeeee-1900-0000-0000-000000000004'; -- escala passada posterior a e1 - 2026-10-20
  v_e5    UUID := 'eeeeeeee-1900-0000-0000-000000000005'; -- escala para T12/T13 (I5) - 2026-10-22
  v_m5    UUID := 'dddddddd-1900-0000-0000-000000000005'; -- membro para T12/T13 (I5): indisp. intervalo/cancelada
  v_inicio DATE := '2026-10-01';
  v_fim    DATE := '2026-10-31';

  v_rows   BIGINT;
  v_date   DATE;
  v_media  NUMERIC;
  v_gini   NUMERIC;
BEGIN
  RAISE NOTICE '=== Setup fixtures 219 ===';

  -- Paróquia
  INSERT INTO public.paroquias (id, nome) VALUES (v_par, '_TESTE_EQ_PAR')
  ON CONFLICT (id) DO NOTHING;

  -- Ministérios
  INSERT INTO public.ministerios (id, paroquia_id, nome) VALUES
    (v_min1, v_par, '_EQ_MIN1'),
    (v_min2, v_par, '_EQ_MIN2')
  ON CONFLICT (id) DO NOTHING;

  -- Membros
  INSERT INTO public.membros (id, paroquia_id, nome, ativo) VALUES
    (v_m1, v_par, '_EQ_MEM1', true),
    (v_m2, v_par, '_EQ_MEM2', true),
    (v_m3, v_par, '_EQ_MEM3', true),
    (v_m4, v_par, '_EQ_MEM4', true)   -- somente faltou
  ON CONFLICT (id) DO NOTHING;

  -- Vínculo de ministérios
  INSERT INTO public.membro_ministerios (membro_id, ministerio_id) VALUES
    (v_m1, v_min1), (v_m1, v_min2),
    (v_m2, v_min1),
    (v_m3, v_min1),
    (v_m4, v_min1)
  ON CONFLICT (membro_id, ministerio_id) DO NOTHING;

  -- Escala 1: passada, publicada, 2 funções (m1 tem ambas)
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status) VALUES
    (v_e1, v_par, '_EQ_ESC1', '2026-10-15', 'publicada')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.escala_funcoes (escala_id, ministerio_id, quantidade) VALUES
    (v_e1, v_min1, 1), (v_e1, v_min2, 1)
  ON CONFLICT (escala_id, ministerio_id) DO NOTHING;

  -- Escala 2: futura, publicada (data em 2030, bem no futuro)
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status) VALUES
    (v_e2, v_par, '_EQ_ESC2', '2030-10-20', 'publicada')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.escala_funcoes (escala_id, ministerio_id, quantidade) VALUES
    (v_e2, v_min1, 1)
  ON CONFLICT (escala_id, ministerio_id) DO NOTHING;

  -- Escala 3: cancelada (deve ser ignorada)
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status) VALUES
    (v_e3, v_par, '_EQ_ESC3', '2026-10-25', 'cancelada')
  ON CONFLICT (id) DO NOTHING;

  -- Escala 4: passada publicada, posterior a e1 — para testar que falta não altera
  -- data_ultimo_servico (m1 terá 'presente' em e1=10-15 e 'faltou' em e4=10-20)
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status) VALUES
    (v_e4, v_par, '_EQ_ESC4', '2026-10-20', 'publicada')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.escala_funcoes (escala_id, ministerio_id, quantidade) VALUES
    (v_e4, v_min1, 1)
  ON CONFLICT (escala_id, ministerio_id) DO NOTHING;

  -- m1 atribuído nas 2 funções da escala 1 e na escala 2
  INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, ativo) VALUES
    (v_e1, v_m1, v_min1, true),
    (v_e1, v_m1, v_min2, true),
    (v_e2, v_m1, v_min1, true)
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE SET ativo = true;

  -- m2 atribuído na escala 1, mas tem indisponibilidade nessa data
  INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, ativo) VALUES
    (v_e1, v_m2, v_min1, true)
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE SET ativo = true;

  -- m5: membro para testes I5 (indisponibilidade por intervalo e cancelada)
  INSERT INTO public.membros (id, paroquia_id, nome, ativo) VALUES
    (v_m5, v_par, '_EQ_MEM5', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.membro_ministerios (membro_id, ministerio_id) VALUES
    (v_m5, v_min1)
  ON CONFLICT (membro_id, ministerio_id) DO NOTHING;

  -- e5: escala dentro do intervalo de indisponibilidade de m5 - 2026-10-22
  INSERT INTO public.escalas (id, paroquia_id, titulo, data, status) VALUES
    (v_e5, v_par, '_EQ_ESC5', '2026-10-22', 'publicada')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.escala_funcoes (escala_id, ministerio_id, quantidade) VALUES
    (v_e5, v_min1, 1)
  ON CONFLICT (escala_id, ministerio_id) DO NOTHING;

  -- Indisponibilidades de m2 (tipo 'dia', padrão — testar comportamento existente)
  INSERT INTO public.indisponibilidades (paroquia_id, membro_id, data, tipo, cancelada) VALUES
    (v_par, v_m2, '2026-10-15', 'dia', false),  -- e1 (tipo dia, não cancelada)
    (v_par, v_m2, '2026-10-20', 'dia', false),  -- e4
    (v_par, v_m2, '2026-10-22', 'dia', false)   -- e5 (bloqueia todas as oportunidades do período)
  ON CONFLICT DO NOTHING;

  -- Indisponibilidades de m5 para T12 e T13 (I5):
  --   T12: indisponibilidade por intervalo (2026-10-18 a 2026-10-25) bloqueia e5 (10-22)
  --   T13: indisponibilidade cancelada NÃO bloqueia e1 (10-15)
  INSERT INTO public.indisponibilidades (paroquia_id, membro_id, data, data_fim, tipo, cancelada) VALUES
    (v_par, v_m5, '2026-10-18', '2026-10-25', 'intervalo', false),  -- T12: bloqueia e5
    (v_par, v_m5, '2026-10-15', NULL,          'dia',       true)   -- T13: cancelada, não bloqueia e1
  ON CONFLICT DO NOTHING;

  -- Histórico de presenças (fonte canônica)
  -- m1: 'presente' em e1 (2026-10-15) — serviço efetivo
  -- m1: 'faltou'   em e4 (2026-10-20) — falta posterior; não deve alterar data_ultimo_servico
  -- m2: sem historico — testa distinção entre atribuição e realização
  -- m4: 'faltou'   em e1 (2026-10-15) — somente faltou; escalas_realizadas deve ser 0
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_par, v_m1, v_e1, v_min1, 'escala', 'escala', 'presente', '2026-10-15', 10),
    (v_par, v_m1, v_e4, v_min1, 'escala', 'escala', 'faltou',   '2026-10-20',  0),
    (v_par, v_m4, v_e1, v_min1, 'escala', 'escala', 'faltou',   '2026-10-15',  0)
  ON CONFLICT (membro_id, escala_id, ministerio_id) DO NOTHING;

  RAISE NOTICE 'Setup OK';

  -- ───────────────────────────────────────────────────────────────
  -- T1: Período sem dados → retorna todos os membros com escalas_total=0
  -- ───────────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_rows
  FROM public.get_equidade_periodo(v_par, '2020-01-01', '2020-01-31');
  ASSERT v_rows = 5,
    'T1 FAIL: esperado 5 membros (m1–m5), obteve ' || v_rows;

  SELECT COUNT(*) INTO v_rows
  FROM public.get_equidade_periodo(v_par, '2020-01-01', '2020-01-31')
  WHERE escalas_total > 0 OR escalas_realizadas > 0;
  ASSERT v_rows = 0, 'T1 FAIL: esperado 0 atribuições e 0 realizadas no período sem dados';
  RAISE NOTICE 'T1 PASS: período sem dados retorna 5 membros com 0 escalas';

  -- ───────────────────────────────────────────────────────────────
  -- T2: Atribuição (escala_membros) vs realização efetiva (presente/atrasado)
  -- Escala cancelada não conta em nenhum dos dois.
  -- m1 tem: 'presente' em e1 (10-15) + 'faltou' em e4 (10-20)
  --   escalas_total = atribuições em escala_membros para o período
  --   escalas_realizadas = somente escalas com presença efetiva (apenas e1)
  -- ───────────────────────────────────────────────────────────────
  -- m1: escalas_total conta atribuições em escala_membros (e1=2 funções→1; e3 cancelada ignorada)
  SELECT escalas_total INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T2 FAIL: escalas_total m1; esperado 1, obteve ' || v_rows;

  -- m1: escalas_realizadas=1 (apenas e1 com 'presente'; e4 com 'faltou' excluída)
  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T2 FAIL: escalas_realizadas m1; esperado 1 (apenas presente), obteve ' || v_rows;

  -- m1: faltas=1 (registro de 'faltou' em e4 ainda contabilizado em faltas)
  SELECT faltas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T2 FAIL: faltas m1; esperado 1 (falta em e4), obteve ' || v_rows;

  -- m2: escalas_total=1 (atribuído em e1) mas escalas_realizadas=0 (sem historico)
  SELECT escalas_total INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m2;
  ASSERT v_rows = 1, 'T2 FAIL: escalas_total m2; esperado 1, obteve ' || v_rows;

  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m2;
  ASSERT v_rows = 0, 'T2 FAIL: escalas_realizadas m2; esperado 0 (sem historico), obteve ' || v_rows;

  RAISE NOTICE 'T2 PASS: escala cancelada ignorada; atribuição != realização corretamente distintos; falta não conta como realização';

  -- ───────────────────────────────────────────────────────────────
  -- T3: Múltiplas funções na mesma escala = 1 oportunidade / 1 atribuição
  -- ───────────────────────────────────────────────────────────────
  SELECT oportunidades INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  -- m1 é elegível em e1 (min1+min2→deduplica para 1) e em e4 (min1) → total=2
  ASSERT v_rows = 3, 'T3 FAIL: oportunidades m1; esperado 3 (e1+e4+e5, sem dup. dentro de e1), obteve ' || v_rows;

  -- escalas_realizadas também não deve duplicar (escala_id DISTINCT no historico)
  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T3 FAIL: múltiplas funções duplicaram escalas_realizadas; esperado 1, obteve ' || v_rows;

  RAISE NOTICE 'T3 PASS: 2 funções em e1 contam 1x; oportunidades=3 (e1+e4+e5); realizadas=1';

  -- ───────────────────────────────────────────────────────────────
  -- T4: Indisponibilidade remove a oportunidade
  -- ───────────────────────────────────────────────────────────────
  SELECT oportunidades INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m2;
  ASSERT v_rows = 0, 'T4 FAIL: indisponibilidade não excluiu oportunidade; esperado 0, obteve ' || v_rows;
  RAISE NOTICE 'T4 PASS: indisponibilidade exclui oportunidade';

  -- ───────────────────────────────────────────────────────────────
  -- T5: Membro elegível sem escalas aparece na lista (necessário para Gini correto)
  -- ───────────────────────────────────────────────────────────────
  SELECT escalas_total INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m3;
  ASSERT v_rows = 0, 'T5 FAIL: m3 deveria ter 0 escalas, obteve ' || v_rows;

  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m3;
  ASSERT v_rows = 0, 'T5 FAIL: m3 deveria ter 0 realizadas, obteve ' || v_rows;

  -- Gini > 0 porque m1 tem 1 (realizado), m2 tem 1 (atribuído), m3 tem 0
  SELECT gini_periodo INTO v_gini
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  RAISE NOTICE 'T5 PASS: m3 aparece com 0 escalas; Gini=%', v_gini;

  -- ───────────────────────────────────────────────────────────────
  -- T6: Separação correta entre futuras e realizadas
  -- escalas_futuras vem de escala_membros (data >= hoje)
  -- escalas_realizadas vem de historico_participacoes (sem histórico para escalas futuras)
  -- ───────────────────────────────────────────────────────────────

  -- No período out/26, e2 (data 2030) está fora → escalas_futuras = 0
  SELECT escalas_futuras INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 0, 'T6 FAIL: escala fora do período contou como futura; esperado 0, obteve ' || v_rows;

  -- No período 2030-10, e2 é futura → escalas_futuras = 1, escalas_realizadas = 0
  SELECT escalas_futuras INTO v_rows
  FROM public.get_equidade_periodo(v_par, '2030-10-01', '2030-10-31')
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T6b FAIL: escala futura não apareceu no período correto; esperado 1, obteve ' || v_rows;

  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, '2030-10-01', '2030-10-31')
  WHERE membro_id = v_m1;
  ASSERT v_rows = 0, 'T6b FAIL: escala futura contou como realizada (via historico); esperado 0, obteve ' || v_rows;

  RAISE NOTICE 'T6 PASS: escalas_futuras e escalas_realizadas diferenciadas corretamente';

  -- ───────────────────────────────────────────────────────────────
  -- T7: Histórico usa fonte canônica (anulada=false)
  -- Presença e data_ultimo_servico vêm de historico_participacoes
  -- ───────────────────────────────────────────────────────────────
  SELECT presencas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_rows = 1, 'T7 FAIL: esperado 1 presença para m1, obteve ' || v_rows;

  -- data_ultimo_servico = 2026-10-15 (última presença efetiva em e1)
  -- m1 tem 'faltou' em e4 (2026-10-20) mas falta NÃO deve alterar data_ultimo_servico
  SELECT data_ultimo_servico INTO v_date
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_date = '2026-10-15'::DATE,
    'T7 FAIL: data_ultimo_servico esperado 2026-10-15 (falta em 10-20 não deve contar), obteve ' || v_date;

  -- m2 não tem historico → data_ultimo_servico NULL mesmo tendo atribuição
  SELECT data_ultimo_servico INTO v_date
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m2;
  ASSERT v_date IS NULL,
    'T7 FAIL: data_ultimo_servico de m2 deveria ser NULL (sem historico), obteve ' || v_date;

  RAISE NOTICE 'T7 PASS: presença, data_ultimo_servico e fonte canônica corretos; falta não altera ultimo_servico';

  -- ───────────────────────────────────────────────────────────────
  -- T9: Membro que somente faltou — escalas_realizadas=0, data_ultimo_servico=NULL
  -- m4 tem 'faltou' em e1 (2026-10-15) mas nenhuma presença efetiva
  -- ───────────────────────────────────────────────────────────────
  SELECT escalas_realizadas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m4;
  ASSERT v_rows = 0,
    'T9 FAIL: m4 somente faltou; esperado escalas_realizadas=0, obteve ' || v_rows;

  SELECT faltas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m4;
  ASSERT v_rows = 1,
    'T9 FAIL: m4 deveria ter faltas=1, obteve ' || v_rows;

  SELECT presencas INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m4;
  ASSERT v_rows = 0,
    'T9 FAIL: m4 deveria ter presencas=0, obteve ' || v_rows;

  SELECT data_ultimo_servico INTO v_date
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m4;
  ASSERT v_date IS NULL,
    'T9 FAIL: data_ultimo_servico de m4 deveria ser NULL (somente falta), obteve ' || v_date;

  RAISE NOTICE 'T9 PASS: membro com somente falta → escalas_realizadas=0, data_ultimo_servico=NULL, faltas=1';

  -- ───────────────────────────────────────────────────────────────
  -- T10: Falta posterior não altera data_ultimo_servico nem media_dias_intervalo
  -- m1: 'presente' em e1 (2026-10-15), 'faltou' em e4 (2026-10-20)
  -- data_ultimo_servico deve ser 2026-10-15 (última presença efetiva)
  -- media_dias_intervalo deve ser NULL (apenas 1 presença efetiva, requer ≥ 2)
  -- ───────────────────────────────────────────────────────────────
  SELECT data_ultimo_servico INTO v_date
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_date = '2026-10-15'::DATE,
    'T10 FAIL: falta posterior em 10-20 alterou data_ultimo_servico; esperado 2026-10-15, obteve ' || v_date;

  SELECT media_dias_intervalo INTO v_media
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_media IS NULL,
    'T10 FAIL: media_dias_intervalo deveria ser NULL (apenas 1 presença efetiva), obteve ' || v_media;

  RAISE NOTICE 'T10 PASS: falta posterior não altera data_ultimo_servico; media_dias_intervalo=NULL com 1 presença';

  -- ───────────────────────────────────────────────────────────────
  -- T11: Gini com empates — distribuição [0,0,1,1] deve produzir Gini=0.500
  --
  -- Fixtures no período v_inicio–v_fim: m3=0, m4=0, m1=1, m2=1 (escalas_total)
  -- avg_rk: valores 0 → rank_asc=1, count_empate=2 → 1+(2-1)/2=1.5
  --         valores 1 → rank_asc=3, count_empate=2 → 3+(2-1)/2=3.5
  -- Σ(avg_rk×v) = 1.5×0+1.5×0+3.5×1+3.5×1 = 7
  -- G = (2×7)/(4×2) − (4+1)/4 = 14/8 − 10/8 = 4/8 = 0.500
  -- ───────────────────────────────────────────────────────────────
  SELECT gini_periodo INTO v_gini
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m1;
  ASSERT v_gini = 0.500,
    'T11 FAIL: Gini [0,0,1,1] esperado 0.500, obteve ' || v_gini;
  RAISE NOTICE 'T11 PASS: Gini=0.500 para distribuição [0,0,1,1] com empates';

  -- ───────────────────────────────────────────────────────────────
  -- T12: I5 — indisponibilidade por intervalo bloqueia oportunidade
  -- m5 tem indisponibilidade tipo='intervalo' de 2026-10-18 a 2026-10-25
  -- e5 tem data 2026-10-22 → dentro do intervalo → 0 oportunidades em e5
  -- e1 (2026-10-15) está fora do intervalo → m5 tem oportunidade em e1
  -- e4 (2026-10-20) está dentro do intervalo → 0 oportunidades em e4
  -- Total oportunidades m5 = 1 (apenas e1; e4 e e5 bloqueadas)
  -- ───────────────────────────────────────────────────────────────
  SELECT oportunidades INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m5;
  ASSERT v_rows = 1,
    'T12 FAIL: indisponibilidade intervalo 10-18..10-25 deveria bloquear e4+e5; esperado oportunidades=1 (só e1), obteve ' || v_rows;
  RAISE NOTICE 'T12 PASS: indisponibilidade tipo=intervalo bloqueia escalas no range, e1 fora do range permanece elegível';

  -- ───────────────────────────────────────────────────────────────
  -- T13: I5 — indisponibilidade cancelada não bloqueia oportunidade
  -- m5 tem indisponibilidade tipo='dia' em 2026-10-15 mas cancelada=true
  -- Resultado: e1 (10-15) não é bloqueada → oportunidades continua = 1 (só e1)
  -- (se a cancelada bloqueasse, oportunidades seria 0)
  -- ───────────────────────────────────────────────────────────────
  -- Verifica que m5 ainda tem a oportunidade em e1 (cancelada não bloqueia)
  SELECT oportunidades INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim)
  WHERE membro_id = v_m5;
  ASSERT v_rows = 1,
    'T13 FAIL: indisponibilidade cancelada não deveria bloquear e1; esperado oportunidades=1, obteve ' || v_rows;
  RAISE NOTICE 'T13 PASS: indisponibilidade cancelada=true não bloqueia oportunidade';

  -- ───────────────────────────────────────────────────────────────
  -- T8: I1b — correspondência por e-mail restrita a auth_user_id IS NULL
  -- (verificação estrutural: a lógica do CTE está em lugar correto)
  -- Este teste verifica apenas que a RPC retorna resultado quando chamada
  -- via service_role (que bypassa auth.uid() = NULL devolvendo empty).
  -- Testes de autenticação real requerem sessão autenticada.
  -- ───────────────────────────────────────────────────────────────
  -- Como service_role, auth.uid() = NULL → _auth_check retorna 0 linhas → result vazio
  SELECT COUNT(*) INTO v_rows
  FROM public.get_equidade_periodo(v_par, v_inicio, v_fim);
  ASSERT v_rows = 0,
    'T8 FAIL: sem auth.uid() deveria retornar 0 linhas, obteve ' || v_rows;
  RAISE NOTICE 'T8 PASS: sem auth.uid() retorna 0 linhas (gate funciona)';

END;
$$;

-- ── TEARDOWN ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DELETE FROM public.historico_participacoes
  WHERE escala_id IN (
    'eeeeeeee-1900-0000-0000-000000000001',
    'eeeeeeee-1900-0000-0000-000000000002',
    'eeeeeeee-1900-0000-0000-000000000003',
    'eeeeeeee-1900-0000-0000-000000000004',
    'eeeeeeee-1900-0000-0000-000000000005'
  );
  DELETE FROM public.escala_membros
  WHERE escala_id IN (
    'eeeeeeee-1900-0000-0000-000000000001',
    'eeeeeeee-1900-0000-0000-000000000002',
    'eeeeeeee-1900-0000-0000-000000000004',
    'eeeeeeee-1900-0000-0000-000000000005'
  );
  DELETE FROM public.escala_funcoes
  WHERE escala_id IN (
    'eeeeeeee-1900-0000-0000-000000000001',
    'eeeeeeee-1900-0000-0000-000000000002',
    'eeeeeeee-1900-0000-0000-000000000003',
    'eeeeeeee-1900-0000-0000-000000000004',
    'eeeeeeee-1900-0000-0000-000000000005'
  );
  DELETE FROM public.escalas
  WHERE id IN (
    'eeeeeeee-1900-0000-0000-000000000001',
    'eeeeeeee-1900-0000-0000-000000000002',
    'eeeeeeee-1900-0000-0000-000000000003',
    'eeeeeeee-1900-0000-0000-000000000004',
    'eeeeeeee-1900-0000-0000-000000000005'
  );
  DELETE FROM public.indisponibilidades
  WHERE membro_id IN (
    'dddddddd-1900-0000-0000-000000000001',
    'dddddddd-1900-0000-0000-000000000002',
    'dddddddd-1900-0000-0000-000000000003',
    'dddddddd-1900-0000-0000-000000000004',
    'dddddddd-1900-0000-0000-000000000005'
  );
  DELETE FROM public.membro_ministerios
  WHERE membro_id IN (
    'dddddddd-1900-0000-0000-000000000001',
    'dddddddd-1900-0000-0000-000000000002',
    'dddddddd-1900-0000-0000-000000000003',
    'dddddddd-1900-0000-0000-000000000004',
    'dddddddd-1900-0000-0000-000000000005'
  );
  DELETE FROM public.membros
  WHERE id IN (
    'dddddddd-1900-0000-0000-000000000001',
    'dddddddd-1900-0000-0000-000000000002',
    'dddddddd-1900-0000-0000-000000000003',
    'dddddddd-1900-0000-0000-000000000004',
    'dddddddd-1900-0000-0000-000000000005'
  );
  DELETE FROM public.ministerios
  WHERE id IN (
    'cccccccc-1900-0000-0000-000000000001',
    'cccccccc-1900-0000-0000-000000000002'
  );
  DELETE FROM public.paroquias WHERE id = 'aaaaaaaa-1900-0000-0000-000000000001';
  RAISE NOTICE 'TEARDOWN 219 concluído';
END;
$$;
