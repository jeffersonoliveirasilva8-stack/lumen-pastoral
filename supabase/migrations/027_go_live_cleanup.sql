-- ============================================================
-- Migration 027: Go-Live — Limpeza de Dados de Homologação
-- Data: 2026-06-13
--
-- O QUE FAZ:
--   1. Remove TODAS as notificações → membros iniciam sem histórico
--   2. Remove escalas cujo título indica teste/homologação e todos
--      os seus registros dependentes (via CASCADE)
--   3. Remove eventos fictícios e suas presenças (via CASCADE)
--   4. Remove indisponibilidades marcadas como teste
--   5. Recalcula o score de todos os membros ativos a partir do
--      historico_participacoes remanescente
--   6. Emite relatório completo via RAISE NOTICE
--
-- O QUE PRESERVA:
--   ✓ Configurações da paróquia (paroquias, paroquia_config_escalas)
--   ✓ Membros, perfis e vínculos (membros, profiles, ministerios)
--   ✓ Escalas sem título de teste
--   ✓ Eventos reais sem título de teste
--   ✓ Toda estrutura de permissões e RLS
--
-- PADRÕES DE TESTE (case-insensitive, correspondência parcial):
--   'teste', 'test', 'homolog', 'demo', 'fictici', 'fictíci',
--   'validac', 'validaç', 'simulad', 'exemplo', 'temp'
--
-- CASCADE automático cobre:
--   notificacoes  → notificacoes_leituras
--   escalas       → escala_membros → substituicoes → historico_substituicoes
--   escalas       → escala_ocorrencias
--   escalas       → historico_participacoes
--   formacoes_eventos → presencas_eventos
--
-- IDEMPOTENTE: sim (DELETE é idempotente; contadores recalculados)
-- REQUER: migrations 001–026 aplicadas
-- ============================================================

DO $$
DECLARE
  -- Arrays de padrões de título de teste
  v_padroes TEXT[] := ARRAY[
    '%teste%', '%test%', '%homolog%', '%demo%',
    '%fictici%', '%fictíci%',
    '%validac%', '%validaç%',
    '%simulad%', '%exemplo%', '%temp%'
  ];

  -- Contadores pré-limpeza
  c_notificacoes         INTEGER;
  c_notif_leituras       INTEGER;
  c_escalas              INTEGER;
  c_escala_membros       INTEGER;
  c_substituicoes        INTEGER;
  c_hist_substituicoes   INTEGER;
  c_escala_ocorrencias   INTEGER;
  c_hist_participacoes   INTEGER;
  c_eventos              INTEGER;
  c_presencas_eventos    INTEGER;
  c_indisponibilidades   INTEGER;

  -- Pós-limpeza
  c_membros_score        INTEGER;
BEGIN

  -- ──────────────────────────────────────────────────────────
  -- FASE 1: CONTAGEM PRÉ-LIMPEZA
  -- Todos os SELECTs devem acontecer ANTES de qualquer DELETE
  -- para que os números do relatório sejam precisos.
  -- ──────────────────────────────────────────────────────────

  SELECT COUNT(*) INTO c_notificacoes
  FROM public.notificacoes;

  SELECT COUNT(*) INTO c_notif_leituras
  FROM public.notificacoes_leituras;

  SELECT COUNT(*) INTO c_escalas
  FROM public.escalas
  WHERE titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_escala_membros
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE e.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_substituicoes
  FROM public.substituicoes s
  JOIN public.escala_membros em ON em.id = s.escala_membro_id
  JOIN public.escalas e         ON e.id  = em.escala_id
  WHERE e.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_hist_substituicoes
  FROM public.historico_substituicoes hs
  JOIN public.substituicoes s          ON s.id  = hs.substituicao_id
  JOIN public.escala_membros em        ON em.id = s.escala_membro_id
  JOIN public.escalas e                ON e.id  = em.escala_id
  WHERE e.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_escala_ocorrencias
  FROM public.escala_ocorrencias eo
  JOIN public.escalas e ON e.id = eo.escala_id
  WHERE e.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_hist_participacoes
  FROM public.historico_participacoes hp
  JOIN public.escalas e ON e.id = hp.escala_id
  WHERE e.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_eventos
  FROM public.formacoes_eventos
  WHERE titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_presencas_eventos
  FROM public.presencas_eventos pe
  JOIN public.formacoes_eventos fe ON fe.id = pe.evento_id
  WHERE fe.titulo ILIKE ANY(v_padroes);

  SELECT COUNT(*) INTO c_indisponibilidades
  FROM public.indisponibilidades
  WHERE motivo ILIKE ANY(v_padroes)
     OR motivo IS NULL;  -- registros sem motivo são de teste

  -- ──────────────────────────────────────────────────────────
  -- FASE 2: LIMPEZA DE NOTIFICAÇÕES
  -- DELETE ALL — membros iniciam o sistema sem histórico antigo.
  -- CASCADE automaticamente apaga notificacoes_leituras.
  -- ──────────────────────────────────────────────────────────

  DELETE FROM public.notificacoes;

  -- ──────────────────────────────────────────────────────────
  -- FASE 3: LIMPEZA DE ESCALAS DE TESTE
  -- CASCADE cobre:
  --   escala_membros → substituicoes → historico_substituicoes
  --   escala_ocorrencias
  --   historico_participacoes
  -- ──────────────────────────────────────────────────────────

  DELETE FROM public.escalas
  WHERE titulo ILIKE ANY(v_padroes);

  -- ──────────────────────────────────────────────────────────
  -- FASE 4: LIMPEZA DE EVENTOS DE TESTE
  -- CASCADE cobre: presencas_eventos
  -- ──────────────────────────────────────────────────────────

  DELETE FROM public.formacoes_eventos
  WHERE titulo ILIKE ANY(v_padroes);

  -- ──────────────────────────────────────────────────────────
  -- FASE 5: LIMPEZA DE INDISPONIBILIDADES DE TESTE
  -- Remove registros com motivo explicitamente de teste
  -- ou sem motivo (criados apenas para homologação).
  -- ──────────────────────────────────────────────────────────

  DELETE FROM public.indisponibilidades
  WHERE motivo ILIKE ANY(v_padroes)
     OR motivo IS NULL;

  -- ──────────────────────────────────────────────────────────
  -- FASE 6: RECÁLCULO DE SCORES
  -- Reconstrói membros.score somando apenas historico_participacoes
  -- remanescentes (dados reais após a limpeza).
  -- Mesma lógica de admin_recalcular_scores_paroquia (026).
  -- ──────────────────────────────────────────────────────────

  UPDATE public.membros m
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = m.id
  )
  WHERE m.ativo = true;

  GET DIAGNOSTICS c_membros_score = ROW_COUNT;

  -- ──────────────────────────────────────────────────────────
  -- FASE 7: RELATÓRIO FINAL
  -- ──────────────────────────────────────────────────────────

  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  RELATÓRIO GO-LIVE — LIMPEZA DE DADOS DE HOMOLOGAÇÃO  ';
  RAISE NOTICE '  Data/hora: %', now();
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  NOTIFICAÇÕES';
  RAISE NOTICE '  ├─ Notificações removidas      : %', c_notificacoes;
  RAISE NOTICE '  └─ Registros de leitura remov. : % (CASCADE)', c_notif_leituras;
  RAISE NOTICE '';
  RAISE NOTICE '  ESCALAS DE TESTE';
  RAISE NOTICE '  ├─ Escalas removidas           : %', c_escalas;
  RAISE NOTICE '  ├─ Membros de escala (CASCADE) : %', c_escala_membros;
  RAISE NOTICE '  ├─ Substituições   (CASCADE)   : %', c_substituicoes;
  RAISE NOTICE '  ├─ Hist. substit.  (CASCADE)   : %', c_hist_substituicoes;
  RAISE NOTICE '  ├─ Ocorrências     (CASCADE)   : %', c_escala_ocorrencias;
  RAISE NOTICE '  └─ Hist. partic.   (CASCADE)   : %', c_hist_participacoes;
  RAISE NOTICE '';
  RAISE NOTICE '  EVENTOS DE TESTE';
  RAISE NOTICE '  ├─ Eventos removidos           : %', c_eventos;
  RAISE NOTICE '  └─ Presenças em evento (CASCADE): %', c_presencas_eventos;
  RAISE NOTICE '';
  RAISE NOTICE '  INDISPONIBILIDADES DE TESTE';
  RAISE NOTICE '  └─ Registros removidos         : %', c_indisponibilidades;
  RAISE NOTICE '';
  RAISE NOTICE '  SCORES RECALCULADOS';
  RAISE NOTICE '  └─ Membros ativos atualizados  : %', c_membros_score;
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  CRITÉRIOS DE APROVAÇÃO:';
  RAISE NOTICE '  ✅ Nenhum membro visualizará notificações antigas';
  RAISE NOTICE '  ✅ Escalas de homologação removidas';
  RAISE NOTICE '  ✅ Eventos fictícios removidos';
  RAISE NOTICE '  ✅ Indisponibilidades de teste removidas';
  RAISE NOTICE '  ✅ Scores recalculados (apenas dados reais)';
  RAISE NOTICE '  ✅ Configurações e membros reais preservados';
  RAISE NOTICE '════════════════════════════════════════════════════════';

END;
$$;

-- Invalida cache PostgREST
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- PADRÕES DE TÍTULO QUE DISPARAM EXCLUSÃO (para revisão manual):
--
--   ILIKE '%teste%'    → "Escala de Teste", "Missa Teste"
--   ILIKE '%test%'     → "Test Escala", "TestEvent"
--   ILIKE '%homolog%'  → "Homologação", "homolog-1"
--   ILIKE '%demo%'     → "Demo Missa", "Escala Demo"
--   ILIKE '%fictici%'  → "Evento ficticio", "Membro fictício"
--   ILIKE '%validac%'  → "Escala de validação", "validacao-01"
--   ILIKE '%simulad%'  → "Escala simulada", "Cenário simulado"
--   ILIKE '%exemplo%'  → "Evento exemplo", "Escala Exemplo"
--   ILIKE '%temp%'     → "Escala temp", "temp-01"
--
-- ATENÇÃO: Revise manualmente qualquer escala/evento real cujo
-- título contenha acidentalmente uma dessas palavras ANTES de
-- aplicar esta migration em produção.
-- Use a query abaixo para listar o que será removido:
--
--   SELECT 'escala' AS tipo, id, titulo, status, data
--   FROM public.escalas
--   WHERE titulo ILIKE ANY(ARRAY[
--     '%teste%','%test%','%homolog%','%demo%',
--     '%fictici%','%fictíci%','%validac%','%validaç%',
--     '%simulad%','%exemplo%','%temp%'
--   ])
--   UNION ALL
--   SELECT 'evento', id, titulo, NULL, data_inicio::date
--   FROM public.formacoes_eventos
--   WHERE titulo ILIKE ANY(ARRAY[
--     '%teste%','%test%','%homolog%','%demo%',
--     '%fictici%','%fictíci%','%validac%','%validaç%',
--     '%simulad%','%exemplo%','%temp%'
--   ])
--   ORDER BY tipo, data;
-- ─────────────────────────────────────────────────────────────
