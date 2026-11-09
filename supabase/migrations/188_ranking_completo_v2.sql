-- ============================================================
-- Migration 188 — get_ranking_completo v2
--
-- Amplia a RPC com campos de janela recente (12 semanas) e
-- data_ultima_escala para alimentar a página de Avaliação de
-- Participação com métricas de equidade do motor V3.
--
-- Campos novos vs. migration 148:
--   data_ultima_escala    DATE     — última escala recebida (NULL se nunca)
--   dias_sem_servir       INTEGER  — dias desde a última escala (NULL se nunca)
--   convocacoes_12sem     BIGINT   — convocações nas últimas 12 semanas
--   presencas_12sem       BIGINT   — presenças confirmadas nas últimas 12 semanas
--   taxa_presenca_12sem   NUMERIC  — taxa de presença nas últimas 12 semanas (0–100)
--
-- Retrocompatível: campos existentes preservados com mesma semântica.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ranking_completo(p_paroquia_id UUID)
RETURNS TABLE (
  id                  UUID,
  nome                TEXT,
  score               INTEGER,
  total_convocacoes   BIGINT,
  total_presencas     BIGINT,
  total_faltas        BIGINT,
  taxa_presenca       NUMERIC,
  ministerios         JSONB,
  -- campos v2
  data_ultima_escala  DATE,
  dias_sem_servir     INTEGER,
  convocacoes_12sem   BIGINT,
  presencas_12sem     BIGINT,
  taxa_presenca_12sem NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  WITH janela AS (
    SELECT (CURRENT_DATE - INTERVAL '12 weeks')::DATE AS inicio
  )
  SELECT
    m.id,
    m.nome,
    COALESCE(m.score, 0)::INTEGER                                                         AS score,

    -- histórico total (igual à v1)
    COUNT(em.id)                                                                           AS total_convocacoes,
    COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado'))                      AS total_presencas,
    COUNT(em.id) FILTER (WHERE em.status = 'faltou')                                      AS total_faltas,
    CASE
      WHEN COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado','faltou')) = 0 THEN 0
      ELSE ROUND(
        COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado'))::NUMERIC
        / COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado','faltou')) * 100, 1
      )
    END                                                                                    AS taxa_presenca,

    COALESCE(
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'id',         min2.id,
          'nome',       min2.nome,
          'cor',        min2.cor,
          'categoria',  min2.categoria
        )
      ) FILTER (WHERE min2.id IS NOT NULL),
      '[]'::jsonb
    )                                                                                      AS ministerios,

    -- campos v2: janela de 12 semanas
    MAX(e_all.data)                                                                        AS data_ultima_escala,
    CASE
      WHEN MAX(e_all.data) IS NULL THEN NULL
      ELSE (CURRENT_DATE - MAX(e_all.data))::INTEGER
    END                                                                                    AS dias_sem_servir,

    COUNT(em12.id)                                                                         AS convocacoes_12sem,
    COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado'))                  AS presencas_12sem,
    CASE
      WHEN COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado','faltou')) = 0 THEN 0
      ELSE ROUND(
        COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado'))::NUMERIC
        / COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado','faltou')) * 100, 1
      )
    END                                                                                    AS taxa_presenca_12sem

  FROM membros m
  CROSS JOIN janela

  -- Histórico total (para total_convocacoes / taxa_presenca / data_ultima_escala)
  LEFT JOIN escala_membros em
    ON em.membro_id = m.id
    AND em.ativo = true
    AND EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = em.escala_id
        AND e.status = 'publicada'
        AND e.data < CURRENT_DATE
    )
  LEFT JOIN escalas e_all
    ON e_all.id = em.escala_id
    AND e_all.status = 'publicada'
    AND e_all.data < CURRENT_DATE

  -- Janela 12 semanas (para convocacoes_12sem / taxa_presenca_12sem)
  LEFT JOIN escala_membros em12
    ON em12.membro_id = m.id
    AND em12.ativo = true
    AND EXISTS (
      SELECT 1 FROM escalas e12
      WHERE e12.id = em12.escala_id
        AND e12.status = 'publicada'
        AND e12.data >= janela.inicio
        AND e12.data < CURRENT_DATE
    )

  LEFT JOIN membro_ministerios mm ON mm.membro_id = m.id
  LEFT JOIN ministerios min2      ON min2.id = mm.ministerio_id AND min2.ativo = true

  WHERE m.paroquia_id = p_paroquia_id
    AND m.ativo = true

  GROUP BY m.id, m.nome, m.score

  ORDER BY m.score DESC, m.nome;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_completo(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
