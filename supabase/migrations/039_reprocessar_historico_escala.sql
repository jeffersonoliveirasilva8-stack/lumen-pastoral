-- ============================================================
-- Migration 039: RPC admin_reprocessar_historico_escala
-- Data: 2026-06-15
--
-- OBJETIVO:
--   Reprocessar os pontos de CADA registro em
--   historico_participacoes para escalas de missa, relendo
--   a configuração atual de paroquia_config_escalas.
--
--   Diferença do admin_recalcular_scores_paroquia (038):
--     recalcular → apenas soma os pontos existentes no histórico
--     reprocessar → recalcula os pontos de cada linha com base
--                   no status + tipo de missa (normal/solene/bispo)
--                   conforme config atual, depois soma
--
-- USO:
--   Deve ser chamado após alterar os valores de pontuação na
--   aba Configurações para que os registros históricos reflitam
--   os novos valores.
--
-- IDEMPOTENTE: sim
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_reprocessar_historico_escala(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id UUID    := auth.uid();
  v_linhas  INTEGER := 0;
  v_membros INTEGER := 0;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public._portal_is_admin(p_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- ── Passo 1: Recalcula pontos de cada linha de escala ──────────────
  -- Lê solene e tem_bispo da escala correspondente e aplica
  -- _get_pontos_status com a configuração atual da paróquia.
  -- O trigger on_historico_score_recalc dispara por linha mas o
  -- Passo 2 garante a consistência final com uma única passagem bulk.

  UPDATE public.historico_participacoes hp
  SET    pontos = public._get_pontos_status(
                    hp.paroquia_id,
                    hp.presenca,
                    COALESCE(e.solene,    false),
                    COALESCE(e.tem_bispo, false)
                  )
  FROM   public.escalas e
  WHERE  hp.escala_id    = e.id
    AND  hp.paroquia_id  = p_paroquia_id
    AND  hp.tipo_evento IN ('escala', 'solene', 'bispo')
    AND  hp.escala_id   IS NOT NULL;

  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  -- ── Passo 2: Recalcula também tipo_evento para refletir solene/bispo ─
  -- (garante que registros gravados antes da migration 038 tenham o
  -- tipo_evento correto para missa solene e com bispo)

  UPDATE public.historico_participacoes hp
  SET    tipo_evento = CASE
                         WHEN COALESCE(e.tem_bispo, false) THEN 'bispo'
                         WHEN COALESCE(e.solene,    false) THEN 'solene'
                         ELSE 'escala'
                       END
  FROM   public.escalas e
  WHERE  hp.escala_id    = e.id
    AND  hp.paroquia_id  = p_paroquia_id
    AND  hp.tipo_evento IN ('escala', 'solene', 'bispo')
    AND  hp.escala_id   IS NOT NULL;

  -- ── Passo 3: Recalculate score de todos os membros (bulk, 1 passagem) ─
  UPDATE public.membros m
  SET    score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM   public.historico_participacoes hp
    WHERE  hp.membro_id = m.id
  )
  WHERE  m.paroquia_id = p_paroquia_id
    AND  m.ativo       = true;

  GET DIAGNOSTICS v_membros = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',              true,
    'registros_atualizados', v_linhas,
    'membros_atualizados',   v_membros
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reprocessar_historico_escala(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
