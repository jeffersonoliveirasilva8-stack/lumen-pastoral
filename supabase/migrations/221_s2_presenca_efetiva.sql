-- Migration 221 — get_oportunidades_por_membro: S2 por presença efetiva
--
-- Correções aplicadas:
--
--   P1  escalas_recebidas: substitui escala_membros (atribuição) por
--       historico_participacoes (presença efetiva: presente/atrasado).
--       Semântica anterior: "foi atribuído = consumiu uma vaga".
--       Semântica nova:     "serviu efetivamente = recebeu o benefício".
--       Membro que faltou mantém alta prioridade S2 — sem penalização dupla
--       (taxa_presenca já penaliza confiabilidade separadamente).
--
--   P2  escalas_com_funcao e recebidas: status = 'publicada' →
--       status IN ('publicada', 'arquivada').
--       Escalas são arquivadas após ocorrer — com o filtro anterior
--       oportunidades = 0 e escalas_recebidas = 0 para todo histórico,
--       S2 nunca funcionava em produção (caía sempre no fallback 30d).
--
-- Fórmula S2 (inalterada no motor, engine.ts):
--   aproveitamento = escalas_recebidas / oportunidades
--   s2_equidade    = (1 − aproveitamento) × 100   [0=serviu tudo; 100=nunca serviu]
--   peso no score COMUM: 40%

CREATE OR REPLACE FUNCTION public.get_oportunidades_por_membro(
  p_paroquia_id      UUID,
  p_ministerio_id    UUID,
  p_janela_semanas   INTEGER DEFAULT 12
)
RETURNS TABLE (
  membro_id            UUID,
  membro_nome          TEXT,
  oportunidades        BIGINT,
  escalas_recebidas    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_data_inicio DATE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND paroquia_id = p_paroquia_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado: usuário não pertence à paróquia %', p_paroquia_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  p_janela_semanas := GREATEST(1, LEAST(52, p_janela_semanas));
  v_data_inicio := CURRENT_DATE - (p_janela_semanas * 7);

  RETURN QUERY
  WITH

  -- P2: status IN ('publicada','arquivada') — inclui escalas já ocorridas e arquivadas
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
      AND e.status      IN ('publicada', 'arquivada')
      AND e.data        >= v_data_inicio
      AND e.data        <  CURRENT_DATE
  ),

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

  elegiveis AS (
    SELECT
      c.membro_id,
      c.membro_nome,
      c.escala_id
    FROM candidaturas c

    WHERE NOT EXISTS (
      SELECT 1 FROM public.membro_funcao_restricoes mfr
      WHERE mfr.membro_id    = c.membro_id
        AND mfr.ministerio_id = p_ministerio_id
        AND mfr.tipo          = 'nao_pode'
    )

    AND NOT EXISTS (
      SELECT 1 FROM public.indisponibilidades ind
      WHERE ind.membro_id   = c.membro_id
        AND ind.paroquia_id = p_paroquia_id
        AND ind.cancelada   = false
        AND (
          (ind.tipo IN ('dia', 'periodo') AND ind.data = c.escala_data)
          OR (ind.tipo = 'intervalo' AND ind.data_fim IS NOT NULL
              AND c.escala_data BETWEEN ind.data AND ind.data_fim)
        )
    )

    AND NOT (c.dia_semana = ANY(c.restricoes_dia_semana))

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

  -- P1: escalas_recebidas via historico_participacoes (presença efetiva).
  -- Mantém escala_membros como âncora para filtrar por ministerio_id.
  -- Inclui somente presente/atrasado — faltou/ausente/pendente excluídos.
  -- anulada = false exclui registros cancelados.
  -- P2: status IN ('publicada','arquivada') — consistente com escalas_com_funcao.
  -- Nota: em.ativo NÃO é filtrado aqui — a validade do serviço passado é
  -- determinada exclusivamente por hp.anulada = false e hp.presenca.
  -- Exigir em.ativo = true excluiria presenças reais cujas atribuições foram
  -- posteriormente desativadas (ex: substituição ou remoção do membro).
  recebidas AS (
    SELECT DISTINCT
      em.membro_id,
      em.escala_id
    FROM public.escala_membros em
    JOIN public.escalas e
      ON  e.id           = em.escala_id
      AND e.paroquia_id  = p_paroquia_id
      AND e.status       IN ('publicada', 'arquivada')
      AND e.data         >= v_data_inicio
      AND e.data         <  CURRENT_DATE
    JOIN public.historico_participacoes hp
      ON  hp.membro_id   = em.membro_id
      AND hp.escala_id   = em.escala_id
      AND hp.paroquia_id = p_paroquia_id
      AND hp.tipo_evento = 'escala'
      AND hp.anulada     = false
      AND hp.presenca    IN ('presente', 'atrasado')
    WHERE em.ministerio_id = p_ministerio_id
  )

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
   Oportunidade = escala (publicada ou arquivada) em que o membro estava elegível.
   escalas_recebidas = escalas em que o membro teve presença efetiva (presente/atrasado)
   em historico_participacoes — faltou/ausente excluídos (migration 221).
   Usado pelo motor de escalas V3 para calcular S2 (equidade proporcional, peso 40%).
   LIMITAÇÃO: não verifica impedir_repeticao_seguida, intervalo_minimo_dias nem incompatibilidades.';

GRANT EXECUTE ON FUNCTION public.get_oportunidades_por_membro(UUID, UUID, INTEGER)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
