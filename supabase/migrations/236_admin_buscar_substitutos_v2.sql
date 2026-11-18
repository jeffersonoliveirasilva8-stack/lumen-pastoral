-- Migration 236 — admin_buscar_substitutos v2: filtros do motor de escalas
--
-- Problema: a versão anterior (migration 089) exibe membros indisponíveis como
-- aviso (tem_indisp), mas não os exclui. Também não aplica:
--   - restricoes_dia_semana (bloqueio semanal do membro)
--   - membro_funcao_restricoes.tipo = 'nao_pode' (membro não pode nessa função)
--   - atuacoes_exigidas (qualificações exigidas pela escala_funcoes)
--   - pontuação dinâmica do motor (dias_sem_servir, taxa de presença)
--
-- Esta versão alinha a sugestão de substituto com a lógica do motor V3:
--   1. Hard-exclude: indisponibilidade ativa na data
--   2. Hard-exclude: restricoes_dia_semana para o dia da semana da escala
--   3. Hard-exclude: membro_funcao_restricoes.tipo = 'nao_pode' para o ministério
--   4. Hard-exclude: não possui atuação exigida (se escala_funcoes.atuacoes_exigidas definido)
--   5. Ordem: dias_sem_servir DESC → taxa_presenca_12sem DESC → score DESC → nome ASC
--
-- DROP necessário: assinatura de retorno mudou (removida coluna tem_indisp)
DROP FUNCTION IF EXISTS public.admin_buscar_substitutos(UUID, UUID);

CREATE OR REPLACE FUNCTION public.admin_buscar_substitutos(
  p_escala_id     UUID,
  p_ministerio_id UUID
)
RETURNS TABLE(
  membro_id         UUID,
  nome              TEXT,
  score             INT,
  dias_sem_servir   INTEGER,
  taxa_presenca     NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id         UUID := auth.uid();
  v_paroquia_id     UUID;
  v_escala_data     DATE;
  v_dia_semana      SMALLINT;
  v_atuacoes_exig   UUID[];
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT e.paroquia_id, e.data
    INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = p_escala_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT public.is_coordenador_da_paroquia(v_paroquia_id) THEN RETURN; END IF;

  -- Dia da semana da escala (0=Dom … 6=Sáb), igual ao engine TypeScript
  v_dia_semana := EXTRACT(DOW FROM v_escala_data)::SMALLINT;

  -- Atuações exigidas para esta função nesta escala (NULL = sem restrição)
  SELECT ef.atuacoes_exigidas
    INTO v_atuacoes_exig
  FROM public.escala_funcoes ef
  WHERE ef.escala_id    = p_escala_id
    AND ef.ministerio_id = p_ministerio_id
  LIMIT 1;

  RETURN QUERY
  WITH
  -- Histórico total por membro (para dias_sem_servir)
  ultima_escala AS (
    SELECT
      em.membro_id,
      MAX(esc.data) AS data_ultima
    FROM public.escala_membros em
    JOIN public.escalas esc ON esc.id = em.escala_id
    WHERE esc.paroquia_id = v_paroquia_id
      AND esc.status      IN ('publicada', 'arquivada')
      AND em.status       IN ('presente', 'atrasado', 'confirmado')
      AND esc.data        < v_escala_data
    GROUP BY em.membro_id
  ),
  -- Janela 12 semanas (para taxa de presença)
  janela_12sem AS (
    SELECT
      em.membro_id,
      COUNT(*) FILTER (WHERE em.status IN ('presente', 'atrasado'))::NUMERIC
        / NULLIF(COUNT(*), 0) * 100                     AS taxa_presenca_12sem,
      COUNT(*) FILTER (WHERE em.status IN ('presente', 'atrasado')) AS presencas
    FROM public.escala_membros em
    JOIN public.escalas esc ON esc.id = em.escala_id
    WHERE esc.paroquia_id = v_paroquia_id
      AND esc.status      IN ('publicada', 'arquivada')
      AND esc.data        BETWEEN (v_escala_data - INTERVAL '84 days') AND v_escala_data
    GROUP BY em.membro_id
  )
  SELECT
    m.id                                                      AS membro_id,
    m.nome                                                    AS nome,
    COALESCE(m.score, 0)                                      AS score,
    CASE
      WHEN ue.data_ultima IS NULL THEN NULL
      ELSE (v_escala_data - ue.data_ultima)
    END                                                       AS dias_sem_servir,
    ROUND(COALESCE(j.taxa_presenca_12sem, 0), 1)             AS taxa_presenca

  FROM public.membros m
  JOIN public.membro_ministerios mm
       ON mm.membro_id = m.id AND mm.ministerio_id = p_ministerio_id
  LEFT JOIN ultima_escala ue ON ue.membro_id = m.id
  LEFT JOIN janela_12sem  j  ON j.membro_id  = m.id

  WHERE m.paroquia_id = v_paroquia_id
    AND m.ativo        = true

    -- Excluir já alocados nesta escala (ativo=true)
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id  = p_escala_id
        AND em.membro_id  = m.id
        AND em.ativo      = true
    )

    -- Hard-exclude: indisponibilidade ativa na data da escala
    AND NOT EXISTS (
      SELECT 1 FROM public.indisponibilidades i
      WHERE i.membro_id = m.id
        AND i.data      = v_escala_data
        AND i.cancelada = false
    )

    -- Hard-exclude: bloqueio semanal (restricoes_dia_semana)
    AND NOT (
      m.restricoes_dia_semana IS NOT NULL
      AND array_length(m.restricoes_dia_semana, 1) > 0
      AND v_dia_semana = ANY(m.restricoes_dia_semana)
    )

    -- Hard-exclude: membro declarou não poder neste ministério
    AND NOT EXISTS (
      SELECT 1 FROM public.membro_funcao_restricoes mfr
      WHERE mfr.membro_id    = m.id
        AND mfr.ministerio_id = p_ministerio_id
        AND mfr.tipo         = 'nao_pode'
    )

    -- Hard-exclude: não possui atuação exigida pela função (quando configurada)
    AND (
      v_atuacoes_exig IS NULL
      OR array_length(v_atuacoes_exig, 1) = 0
      OR EXISTS (
        SELECT 1 FROM public.membro_atuacoes ma
        WHERE ma.membro_id  = m.id
          AND ma.atuacao_id = ANY(v_atuacoes_exig)
      )
    )

  ORDER BY
    -- Prioridade 1: quem está há mais tempo sem servir (NULL por último)
    CASE WHEN ue.data_ultima IS NULL THEN 0 ELSE 1 END ASC,
    (v_escala_data - ue.data_ultima)                   DESC,
    -- Prioridade 2: melhor taxa de presença nas últimas 12 semanas
    COALESCE(j.taxa_presenca_12sem, 0)                 DESC,
    -- Prioridade 3: score base
    COALESCE(m.score, 0)                               DESC,
    m.nome                                             ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_buscar_substitutos(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
