-- ============================================================
-- Migration 148: RPC get_ranking_completo
-- Retorna score + convocações + presenças + faltas + taxa + ministérios
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ranking_completo(p_paroquia_id UUID)
RETURNS TABLE (
  id               UUID,
  nome             TEXT,
  score            INTEGER,
  total_convocacoes BIGINT,
  total_presencas   BIGINT,
  total_faltas      BIGINT,
  taxa_presenca     NUMERIC,
  ministerios       JSONB
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    m.id,
    m.nome,
    COALESCE(m.score, 0)::INTEGER                                       AS score,
    COUNT(em.id)                                                         AS total_convocacoes,
    COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado'))    AS total_presencas,
    COUNT(em.id) FILTER (WHERE em.status = 'faltou')                   AS total_faltas,
    CASE
      WHEN COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado','faltou')) = 0 THEN 0
      ELSE ROUND(
        COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado'))::NUMERIC
        / COUNT(em.id) FILTER (WHERE em.status IN ('presente','atrasado','faltou')) * 100, 1
      )
    END                                                                  AS taxa_presenca,
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
    )                                                                    AS ministerios
  FROM membros m
  LEFT JOIN escala_membros em
    ON em.membro_id = m.id
    AND em.ativo = true
    AND EXISTS (
      SELECT 1 FROM escalas e
      WHERE e.id = em.escala_id
        AND e.status = 'publicada'
        AND e.data < CURRENT_DATE
    )
  LEFT JOIN membro_ministerios mm ON mm.membro_id = m.id
  LEFT JOIN ministerios min2      ON min2.id = mm.ministerio_id AND min2.ativo = true
  WHERE m.paroquia_id = p_paroquia_id
    AND m.ativo = true
  GROUP BY m.id, m.nome, m.score
  ORDER BY m.score DESC, m.nome;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_completo(UUID) TO authenticated;
