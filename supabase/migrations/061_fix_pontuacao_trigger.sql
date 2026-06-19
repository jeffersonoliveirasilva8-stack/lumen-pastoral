-- ============================================================
-- Migration 061: Correção do sistema de pontuação
-- Data: 2026-06-18
--
-- PROBLEMA: migration 053 regrediu o trigger de pontuação que
-- havia sido unificado e melhorado na migration 038.
--
-- REGRESSÕES INTRODUZIDAS PELA 053:
--   1. ON CONFLICT sem WHERE → não localiza o índice parcial
--      uniq_hist_escala (criado em 038, substituiu o constraint)
--      → trigger falha em runtime → coordenador NÃO consegue
--        salvar presenças na sacristia
--   2. _get_pontos_status voltou para 2 parâmetros (sem solene/bispo)
--   3. Trigger não popula tipo_evento no historico
--   4. UPDATE membros.score direto em vez de delegar ao
--      on_historico_score_recalc (double-update, inconsistente)
--
-- REGRA DE NEGÓCIO (confirmada pelo usuário):
--   Membros SÓ ganham pontos quando:
--     - Coordenador/sacristia registra presença na escala
--       (status: presente, faltou, ausente, atrasado, justificou)
--     - Coordenador confirma participação em formação/evento
--   NÃO geram pontos:
--     - Membro se auto-confirma (status: confirmado)
--     - Membro recusa (status: recusado)
--
-- CORREÇÕES:
--   1. Restaurar _get_pontos_status com suporte solene/bispo (v038)
--   2. Restaurar _trigger_pontuar_participacao com ON CONFLICT
--      correto (usando WHERE parcial do uniq_hist_escala)
--   3. Reconstruir historico_participacoes a partir de escala_membros
--      já existentes com status final (para resgatar dados deletados)
--   4. Recalcular todos os scores
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. RESTAURAR _get_pontos_status com solene/bispo (v038)
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public._get_pontos_status(UUID, TEXT);
DROP FUNCTION IF EXISTS public._get_pontos_status(UUID, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public._get_pontos_status(
  p_paroquia_id UUID,
  p_status      TEXT,
  p_solene      BOOLEAN DEFAULT false,
  p_tem_bispo   BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'presente' THEN
      CASE
        WHEN p_tem_bispo THEN COALESCE((SELECT pontuacao_presenca_bispo  FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 5)
        WHEN p_solene    THEN COALESCE((SELECT pontuacao_presenca_solene FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 3)
        ELSE                  COALESCE((SELECT pontuacao_presenca        FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
      END
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    ELSE 0
  END;
$$;

GRANT EXECUTE ON FUNCTION public._get_pontos_status(UUID, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. RESTAURAR _trigger_pontuar_participacao (v038 corrigida)
--
-- CORREÇÕES em relação à 053:
--   • ON CONFLICT usa WHERE matching ao índice parcial uniq_hist_escala
--   • Popula tipo_evento ('escala', 'solene', 'bispo')
--   • Lê solene e tem_bispo da escala
--   • NÃO faz UPDATE membros.score direto — delega ao
--     on_historico_score_recalc (trigger em historico_participacoes)
--   • status_final = apenas statuses de checkout do coordenador
--     (presente, faltou, ausente, atrasado, justificou)
--     — 'confirmado' e 'recusado' NÃO geram pontos
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_pontos       INTEGER;
  v_tipo_evento  TEXT;
  -- Somente statuses registrados pelo coordenador/sacristia
  -- 'confirmado' (auto-confirmação do membro) NÃO gera pontos
  v_status_final CONSTANT TEXT[] := ARRAY[
    'presente','faltou','ausente','atrasado','justificou'
  ];
BEGIN
  -- Ignora se status não mudou ou não é um status final de coordenador
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  -- Lê dados da escala (paróquia, data, solenidade)
  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  -- Verifica se pontuação automática está ativa
  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  -- Calcula pontos considerando solenidade
  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status, v_solene, v_tem_bispo);

  -- Determina tipo_evento para o histórico
  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  -- Upsert usando o índice parcial uniq_hist_escala
  -- A cláusula WHERE deve replicar exatamente o predicado do índice
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, NEW.membro_id, NEW.escala_id, NEW.ministerio_id,
     v_tipo_evento, 'escala', NEW.status, v_escala_data, v_pontos)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala', 'solene', 'bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE
    SET presenca    = EXCLUDED.presenca,
        tipo_evento = EXCLUDED.tipo_evento,
        pontos      = EXCLUDED.pontos;

  -- membros.score é atualizado automaticamente por on_historico_score_recalc
  RETURN NEW;
END;
$$;

-- Recria o trigger com a função corrigida
DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status
  ON    public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- ══════════════════════════════════════════════════════════════
-- 3. RECONSTRUIR historico_participacoes a partir de escala_membros
--
-- Recupera dados para todos os membros que já foram marcados
-- pelo coordenador (status final), mas cujo historico_participacoes
-- pode estar ausente (deletado pela 053 ou nunca gerado).
--
-- Apenas statuses de checkout do coordenador geram pontos.
-- ON CONFLICT DO UPDATE garante idempotência.
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos)
SELECT
  e.paroquia_id,
  em.membro_id,
  em.escala_id,
  em.ministerio_id,
  CASE
    WHEN e.tem_bispo THEN 'bispo'
    WHEN e.solene    THEN 'solene'
    ELSE                  'escala'
  END,
  'escala',
  em.status,
  e.data,
  public._get_pontos_status(e.paroquia_id, em.status, e.solene, e.tem_bispo)
FROM public.escala_membros em
JOIN public.escalas         e   ON e.id = em.escala_id
JOIN public.paroquia_config_escalas pce ON pce.paroquia_id = e.paroquia_id
WHERE em.status IN ('presente','faltou','ausente','atrasado','justificou')
  AND pce.auto_pontuar = true
ON CONFLICT (membro_id, escala_id, ministerio_id)
  WHERE tipo_evento IN ('escala', 'solene', 'bispo')
    AND escala_id    IS NOT NULL
    AND ministerio_id IS NOT NULL
DO UPDATE
  SET presenca    = EXCLUDED.presenca,
      tipo_evento = EXCLUDED.tipo_evento,
      pontos      = EXCLUDED.pontos;

-- ══════════════════════════════════════════════════════════════
-- 4. RECALCULAR TODOS OS SCORES
--
-- Garante que membros.score reflete o SUM atual de
-- historico_participacoes (escalas + eventos de agenda).
-- ══════════════════════════════════════════════════════════════

UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

-- Invalida cache PostgREST
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- FLUXO CORRETO APÓS ESTA MIGRATION:
--
--   1. Membro visualiza escala → status = 'pendente' (sem pontos)
--   2. Membro confirma presença → status = 'confirmado' (sem pontos)
--   3. Coordenador faz checkout na sacristia:
--      → salvar_presencas_escala() → UPDATE escala_membros.status
--      → trigger on_escala_membro_status_final dispara
--      → _trigger_pontuar_participacao():
--          • status IN ('presente','faltou','ausente','atrasado','justificou')
--          • UPSERT em historico_participacoes
--      → trigger on_historico_score_recalc dispara
--      → _trigger_recalc_score_membro() → UPDATE membros.score
--
--   ✓ Sem pontos por auto-confirmação do membro
--   ✓ Pontos corretos por solenidade/bispo
--   ✓ Score recalculado atomicamente
-- ─────────────────────────────────────────────────────────────
