-- Migration 220 — fix get_equidade_periodo: incluir status 'arquivada'
--
-- Problema: migration 219 filtrava somente status = 'publicada'.
-- Escalas são arquivadas após ocorrer — estado final de escala realizada.
-- Com o filtro anterior, qualquer período histórico retornava escalas_total=0
-- e Gini=0 para todos os membros.
--
-- Correção: status IN ('publicada', 'arquivada')
-- Mantidos excluídos: 'cancelada' e 'rascunho'.
-- Fórmula do Gini, escalas_total e demais indicadores inalterados.

CREATE OR REPLACE FUNCTION public.get_equidade_periodo(
  p_paroquia_id UUID,
  p_inicio      DATE,
  p_fim         DATE
)
RETURNS TABLE (
  membro_id              UUID,
  nome                   TEXT,
  escalas_total          BIGINT,
  escalas_realizadas     BIGINT,
  escalas_futuras        BIGINT,
  oportunidades          BIGINT,
  taxa_aproveitamento    NUMERIC,
  atribuicoes_extras     BIGINT,
  presencas              BIGINT,
  faltas                 BIGINT,
  taxa_presenca          NUMERIC,
  data_ultimo_servico    DATE,
  media_dias_intervalo   NUMERIC,
  ministerios_periodo    JSONB,
  gini_periodo           NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH

  _auth_check AS (
    SELECT 1 AS ok
    WHERE  auth.uid() IS NOT NULL
      AND  (
        public._portal_is_admin(p_paroquia_id)
        OR EXISTS (
          SELECT 1 FROM membros caller
          WHERE caller.paroquia_id = p_paroquia_id
            AND caller.ativo       = true
            AND (
              (caller.auth_user_id IS NOT NULL AND caller.auth_user_id = auth.uid())
              OR (caller.auth_user_id IS NULL
                  AND LOWER(TRIM(COALESCE(caller.email, '')))
                       = LOWER(TRIM(COALESCE(auth.email(), ''))))
            )
        )
      )
  ),

  base AS (
    SELECT m.id, m.nome
    FROM   membros m
    CROSS  JOIN _auth_check
    WHERE  m.paroquia_id = p_paroquia_id
      AND  m.ativo = true
  ),

  -- Escalas publicadas ou arquivadas no período (exclui canceladas e rascunhos)
  -- arquivada = estado final de escala já ocorrida (necessário para avaliação histórica)
  escalas_periodo AS (
    SELECT e.id, e.data
    FROM   escalas e
    WHERE  e.paroquia_id = p_paroquia_id
      AND  e.status      IN ('publicada', 'arquivada')
      AND  e.data        BETWEEN p_inicio AND p_fim
  ),

  atribuicoes AS (
    SELECT
      em.membro_id,
      ep.id   AS escala_id,
      ep.data AS escala_data,
      em.ministerio_id
    FROM   escala_membros em
    JOIN   escalas_periodo ep ON ep.id = em.escala_id
    WHERE  em.ativo = true
  ),

  oportunidades_base AS (
    SELECT
      b.id   AS membro_id,
      ep.id  AS escala_id
    FROM   base b
    JOIN   escalas_periodo ep  ON true
    JOIN   escala_funcoes ef   ON ef.escala_id    = ep.id
    JOIN   membro_ministerios mm
              ON  mm.membro_id    = b.id
              AND mm.ministerio_id = ef.ministerio_id
    WHERE  NOT EXISTS (
      SELECT 1 FROM indisponibilidades ind
      WHERE  ind.membro_id   = b.id
        AND  ind.paroquia_id = p_paroquia_id
        AND  ind.cancelada   = false
        AND  (
          (ind.tipo IN ('dia', 'periodo') AND ind.data = ep.data)
          OR (ind.tipo = 'intervalo'
              AND ind.data_fim IS NOT NULL
              AND ep.data BETWEEN ind.data AND ind.data_fim)
        )
    )
  ),

  oportunidades_count AS (
    SELECT membro_id, COUNT(DISTINCT escala_id) AS oportunidades
    FROM   oportunidades_base
    GROUP  BY membro_id
  ),

  historico AS (
    SELECT
      hp.membro_id,
      hp.escala_id,
      hp.data,
      hp.presenca
    FROM   historico_participacoes hp
    WHERE  hp.paroquia_id = p_paroquia_id
      AND  hp.anulada     = false
      AND  hp.tipo_evento = 'escala'
      AND  hp.escala_id   IS NOT NULL
      AND  hp.data        BETWEEN p_inicio AND p_fim
  ),

  historico_contagem AS (
    SELECT
      membro_id,
      COUNT(*) FILTER (WHERE presenca IN ('presente','atrasado')) AS presencas,
      COUNT(*) FILTER (WHERE presenca IN ('faltou','ausente'))    AS faltas
    FROM   historico
    GROUP  BY membro_id
  ),

  historico_efetivo AS (
    SELECT membro_id, escala_id, data
    FROM   historico
    WHERE  presenca IN ('presente', 'atrasado')
  ),

  historico_escalas AS (
    SELECT membro_id, COUNT(DISTINCT escala_id) AS escalas_realizadas
    FROM   historico_efetivo
    GROUP  BY membro_id
  ),

  ultimo_servico AS (
    SELECT membro_id, MAX(data) AS data_ultimo_servico
    FROM   historico_efetivo
    GROUP  BY membro_id
  ),

  intervalos AS (
    SELECT
      membro_id,
      ROUND(AVG(diff)::NUMERIC, 1) AS media_dias_intervalo
    FROM (
      SELECT
        membro_id,
        (srv_date - LAG(srv_date) OVER (
          PARTITION BY membro_id ORDER BY srv_date
        ))::INTEGER AS diff
      FROM (
        SELECT DISTINCT membro_id, escala_id, MIN(data) AS srv_date
        FROM   historico_efetivo
        GROUP  BY membro_id, escala_id
      ) srv
    ) lags
    WHERE diff IS NOT NULL
    GROUP BY membro_id
  ),

  ministerios_periodo AS (
    SELECT
      a.membro_id,
      JSONB_AGG(
        DISTINCT JSONB_BUILD_OBJECT(
          'id',   mn.id,
          'nome', mn.nome,
          'cor',  mn.cor
        )
      ) FILTER (WHERE mn.id IS NOT NULL) AS ministerios_periodo
    FROM   atribuicoes a
    JOIN   ministerios mn ON mn.id = a.ministerio_id
    GROUP  BY a.membro_id
  ),

  resultado AS (
    SELECT
      b.id   AS membro_id,
      b.nome AS nome,

      COUNT(DISTINCT a.escala_id)
        FILTER (WHERE a.escala_id IS NOT NULL)                             AS escalas_total,

      COALESCE(he.escalas_realizadas, 0)                                   AS escalas_realizadas,

      COUNT(DISTINCT a.escala_id)
        FILTER (WHERE a.escala_data >= CURRENT_DATE)                       AS escalas_futuras,

      COALESCE(oc.oportunidades, 0)                                        AS oportunidades,

      CASE
        WHEN COALESCE(oc.oportunidades, 0) = 0 THEN NULL
        ELSE ROUND(
          COUNT(DISTINCT a.escala_id) FILTER (WHERE a.escala_id IS NOT NULL)
          ::NUMERIC / oc.oportunidades * 100, 1
        )
      END                                                                   AS taxa_aproveitamento,

      GREATEST(
        0,
        COUNT(DISTINCT a.escala_id) FILTER (WHERE a.escala_id IS NOT NULL)
        - COALESCE(oc.oportunidades, 0)
      )                                                                     AS atribuicoes_extras,

      COALESCE(hc.presencas, 0)                                            AS presencas,
      COALESCE(hc.faltas,    0)                                            AS faltas,
      CASE
        WHEN COALESCE(hc.presencas, 0) + COALESCE(hc.faltas, 0) = 0 THEN NULL
        ELSE ROUND(
          hc.presencas::NUMERIC / (hc.presencas + hc.faltas) * 100, 1
        )
      END                                                                   AS taxa_presenca,

      us.data_ultimo_servico,
      iv.media_dias_intervalo,

      COALESCE(mp.ministerios_periodo, '[]'::JSONB)                        AS ministerios_periodo

    FROM   base b
    LEFT   JOIN atribuicoes          a  ON a.membro_id  = b.id
    LEFT   JOIN oportunidades_count  oc ON oc.membro_id = b.id
    LEFT   JOIN historico_contagem   hc ON hc.membro_id = b.id
    LEFT   JOIN historico_escalas    he ON he.membro_id = b.id
    LEFT   JOIN ultimo_servico       us ON us.membro_id = b.id
    LEFT   JOIN intervalos           iv ON iv.membro_id = b.id
    LEFT   JOIN ministerios_periodo  mp ON mp.membro_id = b.id

    GROUP  BY b.id, b.nome,
              oc.oportunidades,
              hc.presencas, hc.faltas,
              he.escalas_realizadas,
              us.data_ultimo_servico,
              iv.media_dias_intervalo,
              mp.ministerios_periodo
  ),

  gini AS (
    SELECT CASE
      WHEN COUNT(*) <= 1 OR SUM(escalas_total) = 0 THEN 0::NUMERIC
      ELSE ROUND(
        (
          2.0 * SUM(avg_rk * escalas_total::NUMERIC)
          / (COUNT(*) * SUM(escalas_total))
          - (COUNT(*) + 1.0) / COUNT(*)
        )::NUMERIC, 3
      )
    END AS gini
    FROM (
      SELECT
        escalas_total,
        RANK() OVER (ORDER BY escalas_total ASC)::NUMERIC
        + (COUNT(*) OVER (PARTITION BY escalas_total)::NUMERIC - 1) / 2.0
        AS avg_rk
      FROM resultado
    ) ranked
  )

  SELECT
    r.membro_id,
    r.nome,
    r.escalas_total,
    r.escalas_realizadas,
    r.escalas_futuras,
    r.oportunidades,
    r.taxa_aproveitamento,
    r.atribuicoes_extras,
    r.presencas,
    r.faltas,
    r.taxa_presenca,
    r.data_ultimo_servico,
    r.media_dias_intervalo,
    r.ministerios_periodo,
    g.gini AS gini_periodo
  FROM resultado r
  CROSS JOIN gini g
  ORDER BY r.escalas_total DESC, r.nome;
$$;

REVOKE EXECUTE ON FUNCTION public.get_equidade_periodo(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_equidade_periodo(UUID, DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_equidade_periodo(UUID, DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
