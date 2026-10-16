-- ============================================================
-- Migration 162 — RPC get_oportunidades_por_membro
--
-- Calcula, para cada membro ativo, quantas escalas passadas
-- (janela de p_janela_semanas) ele estava elegível para servir
-- numa função específica (oportunidades) e quantas efetivamente
-- recebeu (escalas_recebidas).
--
-- Usado pelo motor de escalas V3 para calcular S2 (equidade).
--
-- LIMITAÇÕES DOCUMENTADAS — critérios não verificáveis retroativamente:
--   • config.impedir_repeticao_seguida (precisa saber se serviu no dia anterior)
--   • config.intervalo_minimo_dias (precisa saber o histórico no instante exato)
--   • Incompatibilidade entre membros (depende de quem mais foi alocado)
-- Estes casos representam uma fração pequena das escalas e não
-- invalidam o cálculo de equidade — apenas adicionam ruído marginal.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_oportunidades_por_membro(
  p_paroquia_id      UUID,
  p_ministerio_id    UUID,
  p_janela_semanas   INTEGER DEFAULT 12
)
RETURNS TABLE (
  membro_id            UUID,
  membro_nome          TEXT,
  oportunidades        BIGINT,  -- escalas em que estava elegível para esta função
  escalas_recebidas    BIGINT   -- escalas que efetivamente recebeu nesta função
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_data_inicio DATE;
BEGIN
  -- Autorização: o caller deve pertencer à paróquia solicitada
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND paroquia_id = p_paroquia_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado: usuário não pertence à paróquia %', p_paroquia_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Sanitiza janela: mínimo 1, máximo 52 semanas
  p_janela_semanas := GREATEST(1, LEAST(52, p_janela_semanas));
  v_data_inicio := CURRENT_DATE - (p_janela_semanas * 7);

  RETURN QUERY
  WITH

  -- Escalas publicadas dentro da janela para a paróquia com a função em questão
  escalas_com_funcao AS (
    SELECT
      e.id                                          AS escala_id,
      e.data                                        AS escala_data,
      EXTRACT(DOW FROM e.data)::SMALLINT            AS dia_semana,
      ef.atuacoes_exigidas                          AS atuacoes_exigidas
    FROM public.escalas e
    JOIN public.escala_funcoes ef
      ON ef.escala_id = e.id
     AND ef.ministerio_id = p_ministerio_id
    WHERE e.paroquia_id = p_paroquia_id
      AND e.status      = 'publicada'
      AND e.data        >= v_data_inicio
      AND e.data        <  CURRENT_DATE
  ),

  -- Membros ativos da paróquia vinculados à função
  membros_vinculados AS (
    SELECT
      m.id                                          AS membro_id,
      m.nome                                        AS membro_nome,
      COALESCE(m.restricoes_dia_semana, '{}')       AS restricoes_dia_semana
    FROM public.membros m
    JOIN public.membro_ministerios mm
      ON mm.membro_id    = m.id
     AND mm.ministerio_id = p_ministerio_id
    WHERE m.paroquia_id = p_paroquia_id
      AND m.ativo        = true
  ),

  -- Produto cruzado: cada (membro, escala) potencial
  candidaturas AS (
    SELECT
      mv.membro_id,
      mv.membro_nome,
      ecf.escala_id,
      ecf.escala_data,
      ecf.dia_semana,
      ecf.atuacoes_exigidas,
      mv.restricoes_dia_semana
    FROM membros_vinculados mv
    CROSS JOIN escalas_com_funcao ecf
  ),

  -- Aplica critérios de elegibilidade
  elegiveis AS (
    SELECT
      c.membro_id,
      c.membro_nome,
      c.escala_id
    FROM candidaturas c

    -- Critério 1: sem restrição de funcao_nao_pode
    WHERE NOT EXISTS (
      SELECT 1 FROM public.membro_funcao_restricoes mfr
      WHERE mfr.membro_id    = c.membro_id
        AND mfr.ministerio_id = p_ministerio_id
        AND mfr.tipo          = 'nao_pode'
    )

    -- Critério 2: sem indisponibilidade ativa na data da escala
    AND NOT EXISTS (
      SELECT 1 FROM public.indisponibilidades ind
      WHERE ind.membro_id   = c.membro_id
        AND ind.paroquia_id = p_paroquia_id
        AND ind.data        = c.escala_data
        AND ind.cancelada   = false
    )

    -- Critério 3: dia da semana não está nas restrições do membro
    AND NOT (c.dia_semana = ANY(c.restricoes_dia_semana))

    -- Critério 4: se a função exige atuações, o membro deve ter ao menos uma
    AND (
      c.atuacoes_exigidas IS NULL
      OR cardinality(c.atuacoes_exigidas) = 0
      OR EXISTS (
        SELECT 1 FROM public.membro_atuacoes ma
        WHERE ma.membro_id  = c.membro_id
          AND ma.atuacao_id = ANY(c.atuacoes_exigidas)
      )
    )
  ),

  -- Escalas efetivamente recebidas (ativo=true, escala dentro da janela)
  recebidas AS (
    SELECT
      em.membro_id,
      em.escala_id
    FROM public.escala_membros em
    JOIN public.escalas e ON e.id = em.escala_id
    WHERE e.paroquia_id   = p_paroquia_id
      AND em.ministerio_id = p_ministerio_id
      AND e.status         = 'publicada'
      AND e.data           >= v_data_inicio
      AND e.data           <  CURRENT_DATE
      AND em.ativo         = true
  )

  -- Agrega por membro: retorna todos os membros vinculados, com zeros quando necessário
  SELECT
    mv.membro_id,
    mv.membro_nome,
    COUNT(DISTINCT el.escala_id)            AS oportunidades,
    COUNT(DISTINCT rec.escala_id)           AS escalas_recebidas
  FROM membros_vinculados mv
  LEFT JOIN elegiveis el  ON el.membro_id  = mv.membro_id
  LEFT JOIN recebidas rec ON rec.membro_id = mv.membro_id
  GROUP BY mv.membro_id, mv.membro_nome
  ORDER BY mv.membro_nome;

END;
$$;

COMMENT ON FUNCTION public.get_oportunidades_por_membro(UUID, UUID, INTEGER) IS
  'Retorna oportunidades e escalas_recebidas por membro na janela de p_janela_semanas semanas.
   Oportunidade = escala publicada em que o membro estava elegível (vínculo ministerial, sem
   funcao_nao_pode, sem indisponibilidade ativa, sem restrição de dia da semana, atendendo
   atuações exigidas). Usado pelo motor de escalas V3 para calcular S2 (equidade proporcional).
   LIMITAÇÃO: não verifica impedir_repeticao_seguida, intervalo_minimo_dias nem incompatibilidades.';

GRANT EXECUTE ON FUNCTION public.get_oportunidades_por_membro(UUID, UUID, INTEGER)
  TO authenticated;
