-- Migration 218 — get_ranking_completo v3
--
-- Problema: total_convocacoes contava escala_membros de escalas publicadas
-- com data < CURRENT_DATE. Com todas as escalas passadas e nenhuma ativa,
-- retornava 0 para todos os membros — mesmo com histórico real em
-- historico_participacoes.
--
-- Fix: total_convocacoes e total_presencas passam a contar
-- historico_participacoes (anulada=false), que é a fonte canônica de
-- pontuação e participação do motor V3.
-- escala_membros continua sendo usado para data_ultima_escala,
-- dias_sem_servir e a janela de 12 semanas (comportamento inalterado).

DROP FUNCTION IF EXISTS public.get_ranking_completo(uuid);

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
    COALESCE(m.score, 0)::INTEGER                                                           AS score,

    -- histórico total via historico_participacoes (fonte canônica do motor V3)
    COUNT(hp.id)                                                                            AS total_convocacoes,
    COUNT(hp.id) FILTER (WHERE hp.presenca IN ('presente','atrasado'))                     AS total_presencas,
    COUNT(hp.id) FILTER (WHERE hp.presenca IN ('faltou','ausente'))                        AS total_faltas,
    CASE
      WHEN COUNT(hp.id) FILTER (
        WHERE hp.presenca IN ('presente','atrasado','faltou','ausente')
      ) = 0 THEN 0
      ELSE ROUND(
        COUNT(hp.id) FILTER (WHERE hp.presenca IN ('presente','atrasado'))::NUMERIC
        / COUNT(hp.id) FILTER (
            WHERE hp.presenca IN ('presente','atrasado','faltou','ausente')
          ) * 100, 1
      )
    END                                                                                     AS taxa_presenca,

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
    )                                                                                       AS ministerios,

    -- campos v2: data_ultima_escala e dias_sem_servir via escala_membros (inalterado)
    MAX(e_all.data)                                                                         AS data_ultima_escala,
    CASE
      WHEN MAX(e_all.data) IS NULL THEN NULL
      ELSE (CURRENT_DATE - MAX(e_all.data))::INTEGER
    END                                                                                     AS dias_sem_servir,

    -- janela 12 semanas via escala_membros (inalterado)
    COUNT(em12.id)                                                                          AS convocacoes_12sem,
    COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado'))                   AS presencas_12sem,
    CASE
      WHEN COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado','faltou')) = 0 THEN 0
      ELSE ROUND(
        COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado'))::NUMERIC
        / COUNT(em12.id) FILTER (WHERE em12.status IN ('presente','atrasado','faltou')) * 100, 1
      )
    END                                                                                     AS taxa_presenca_12sem

  FROM membros m
  CROSS JOIN janela

  -- Histórico canônico (total_convocacoes / total_presencas / taxa_presenca)
  LEFT JOIN historico_participacoes hp
    ON hp.membro_id    = m.id
    AND hp.paroquia_id = m.paroquia_id
    AND hp.anulada     = false
    AND hp.escala_id   IS NOT NULL

  -- data_ultima_escala e dias_sem_servir (mantido via escala_membros)
  LEFT JOIN escala_membros em_all
    ON em_all.membro_id = m.id
    AND em_all.ativo = true
    AND EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = em_all.escala_id
        AND e.paroquia_id = m.paroquia_id
        AND e.status = 'publicada'
        AND e.data < CURRENT_DATE
    )
  LEFT JOIN escalas e_all
    ON e_all.id = em_all.escala_id

  -- Janela 12 semanas (inalterado)
  LEFT JOIN escala_membros em12
    ON em12.membro_id = m.id
    AND em12.ativo = true
    AND EXISTS (
      SELECT 1 FROM escalas e12
      WHERE e12.id = em12.escala_id
        AND e12.paroquia_id = m.paroquia_id
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
