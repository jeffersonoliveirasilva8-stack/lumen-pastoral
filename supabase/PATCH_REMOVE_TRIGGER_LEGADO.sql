-- ============================================================
-- PATCH: Remoção do trigger legado de pontuação
-- Data: 2026-06-14
-- Autor: Auditoria de integridade do sistema de pontuação
--
-- CONTEXTO
-- ─────────
-- Dois triggers coexistiam em escala_membros:
--
--   [A] tg_escala_membro_pontuacao  (PONTUACAO_TRIGGER.sql — LEGADO)
--       Evento   : AFTER INSERT OR UPDATE OF status
--       Pontos   : fixos — 1pt escala comum, 2pts missa solene
--       Config   : ignora paroquia_config_escalas
--       Pendentes: cria entrada 'pendente' em historico_participacoes a cada INSERT
--       Status   : não cobre atrasado nem justificou
--
--   [B] on_escala_membro_status_final  (migration 026 — ATIVO E CORRETO)
--       Evento   : AFTER UPDATE OF status
--       Pontos   : configuráveis via paroquia_config_escalas
--       Config   : respeita auto_pontuar (não age se desativado)
--       Suporte  : presente, faltou, atrasado, justificou, recusado, ausente
--       Score    : recalcula membros.score diretamente após cada mudança
--
-- CONFLITOS IDENTIFICADOS
-- ────────────────────────
--   1. SOLENE + PRESENTE
--      Trigger B grava pontos = config.pontuacao_presenca (ex: 1)
--      Trigger A sobrescreve com pontos = 2 (hardcoded)
--      → historico_participacoes diverge da configuração da paróquia
--
--   2. TRIPLA RECALCULAÇÃO DE SCORE POR EVENTO
--      Trigger B  → UPDATE membros.score
--      Trigger A  → UPDATE historico_participacoes → dispara historico_score_trigger
--                 → recalcula membros.score (2x extra)
--
--   3. ENTRADAS 'PENDENTE' ÓRFÃS
--      Trigger A cria entrada presenca='pendente' no INSERT de escala_membros.
--      Trigger B nunca cria pendentes (só age em status finais).
--      → historico_participacoes acumula linhas 'pendente' que não representam
--        pontuação real e distorcem relatórios de frequência.
--
-- AÇÃO
-- ─────
--   Remove trigger legado (A) e sua função.
--   Remove entradas 'pendente' órfãs.
--   Recalcula todos os scores para garantir consistência pós-limpeza.
--
-- PRÉ-REQUISITO
-- ─────────────
--   Execute este patch como superusuário ou via Supabase Dashboard → SQL Editor.
--   Não requer sessão autenticada (contorna auth.uid()).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PASSO 1 — Diagnóstico: triggers ativos ANTES da remoção
-- ────────────────────────────────────────────────────────────

SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_orientation,
  LEFT(action_statement, 80) AS fn_resumo
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'escala_membros'
ORDER BY trigger_name;

-- Resultado esperado ANTES:
--   on_escala_membro_status_final  | UPDATE  | AFTER | ROW | EXECUTE FUNCTION _trigger_pontuar_participacao
--   tg_escala_membro_pontuacao     | INSERT  | AFTER | ROW | EXECUTE FUNCTION fn_escala_membro_pontuacao
--   tg_escala_membro_pontuacao     | UPDATE  | AFTER | ROW | EXECUTE FUNCTION fn_escala_membro_pontuacao

-- ────────────────────────────────────────────────────────────
-- PASSO 2 — Remover trigger legado
-- ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS tg_escala_membro_pontuacao ON public.escala_membros;

-- ────────────────────────────────────────────────────────────
-- PASSO 3 — Remover função legada
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_escala_membro_pontuacao();

-- ────────────────────────────────────────────────────────────
-- PASSO 4 — Limpar entradas 'pendente' órfãs
--           Criadas pelo INSERT legado; trigger 026 nunca as cria.
--           Estas entradas distorcem relatórios mas não afetam score
--           (historico_score_trigger soma apenas entradas com pontos > 0).
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE v_deletados INTEGER;
BEGIN
  DELETE FROM public.historico_participacoes WHERE presenca = 'pendente';
  GET DIAGNOSTICS v_deletados = ROW_COUNT;
  RAISE NOTICE 'Entradas pendentes removidas: %', v_deletados;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- PASSO 5 — Recalcular todos os scores
--           Elimina distorção de pontos duplicados de solenes.
--           Roda como service_role (SQL Editor), sem restrição de auth.
-- ────────────────────────────────────────────────────────────

UPDATE public.membros m
SET score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM public.historico_participacoes hp
  WHERE hp.membro_id = m.id
)
WHERE m.ativo = true;

-- ────────────────────────────────────────────────────────────
-- PASSO 6 — Diagnóstico: triggers APÓS remoção
-- ────────────────────────────────────────────────────────────

SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_orientation,
  LEFT(action_statement, 80) AS fn_resumo
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'escala_membros'
ORDER BY trigger_name;

-- Resultado esperado APÓS:
--   on_escala_membro_status_final  | UPDATE  | AFTER | ROW | EXECUTE FUNCTION _trigger_pontuar_participacao

-- ────────────────────────────────────────────────────────────
-- PASSO 7 — Relatório final de integridade de scores
-- ────────────────────────────────────────────────────────────

SELECT
  m.nome,
  m.score                                    AS score_atual,
  COALESCE(SUM(hp.pontos), 0)               AS soma_historico,
  COUNT(hp.id)                               AS total_entradas,
  COUNT(hp.id) FILTER (WHERE hp.presenca = 'presente')   AS presencas,
  COUNT(hp.id) FILTER (WHERE hp.presenca = 'confirmado') AS confirmados,
  COUNT(hp.id) FILTER (WHERE hp.presenca = 'faltou')     AS faltas,
  COUNT(hp.id) FILTER (WHERE hp.presenca = 'atrasado')   AS atrasos,
  COUNT(hp.id) FILTER (WHERE hp.presenca = 'justificou') AS justificativas,
  CASE
    WHEN COALESCE(SUM(hp.pontos), 0) = m.score THEN 'OK'
    ELSE 'DIVERGENCIA — recalcular'
  END                                        AS status_sync
FROM public.membros m
LEFT JOIN public.historico_participacoes hp ON hp.membro_id = m.id
WHERE m.ativo = true
GROUP BY m.id, m.nome, m.score
ORDER BY m.score DESC, m.nome;

-- ────────────────────────────────────────────────────────────
-- PASSO 8 — Verificar funções legadas remanescentes
-- ────────────────────────────────────────────────────────────

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'fn_escala_membro_pontuacao',
    '_trigger_pontuar_participacao',
    '_get_pontos_status',
    'admin_recalcular_scores_paroquia'
  )
ORDER BY routine_name;

-- Resultado esperado APÓS:
--   _get_pontos_status                FUNCTION  ← helper de pontuação (migration 026)
--   _trigger_pontuar_participacao     FUNCTION  ← trigger ativo (migration 026)
--   admin_recalcular_scores_paroquia  FUNCTION  ← RPC de recalculo manual (migration 026)
--   fn_escala_membro_pontuacao        → NÃO DEVE APARECER (removida)

-- ============================================================
-- CRITÉRIO DE APROVAÇÃO
-- ────────────────────────────────────────────────────────────
--   ✓ PASSO 6: apenas on_escala_membro_status_final listado
--   ✓ PASSO 7: coluna status_sync = 'OK' para todos os membros
--   ✓ PASSO 8: fn_escala_membro_pontuacao NÃO aparece
--   ✓ PASSO 8: demais 3 funções de migration 026 estão presentes
-- ============================================================
