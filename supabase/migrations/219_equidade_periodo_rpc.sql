-- Migration 219 — RPC get_equidade_periodo (v4)
--
-- Indicadores de equidade de distribuição por membro num período.
--
-- Correções aplicadas (revisão 2026-11-10 v2):
--   C1  Gini: RANK em subquery separada antes de agregar (window inside aggregate proibido)
--   C2  FILTER movido para dentro do COUNT; COALESCE removido (COUNT nunca retorna NULL)
--   I1  Validação de auth.uid(): caller deve ser membro ativo da paróquia ou admin
--   I1b Auth: correspondência por e-mail restrita a registros sem auth_user_id
--   I2  Rank médio: avg_rk = rank_asc + (count_empates-1)/2.0 (fórmula direta por grupo empatado)
--   I3  atribuicoes_extras: identifica atribuições fora das oportunidades sem mascarar
--   I4  escalas_realizadas, data_ultimo_servico, media_dias_intervalo → historico_participacoes
--   I4b Apenas presença efetiva (presente/atrasado) em escalas_realizadas, data_ultimo_servico e media_dias_intervalo
--   I5  oportunidades_base: sincronizado com critério de indisponibilidade do motor (migration 162):
--       - cancelada = false (exclui registros cancelados)
--       - tipo 'dia'/'periodo': data = ep.data (ponto exato)
--       - tipo 'intervalo': ep.data BETWEEN data AND data_fim
--   M2  e.status removido do CTE escalas_periodo (nunca usado downstream)
--
-- Limitações documentadas (igual à migration 162 — representam fração pequena das escalas):
--   L1  membro_funcao_restricoes (tipo='nao_pode') não verificado
--   L2  restricoes_dia_semana (membros.restricoes_dia_semana) não verificado
--   L3  atuacoes_exigidas (escala_funcoes.atuacoes_exigidas) não verificado

CREATE OR REPLACE FUNCTION public.get_equidade_periodo(
  p_paroquia_id UUID,
  p_inicio      DATE,
  p_fim         DATE
)
RETURNS TABLE (
  membro_id              UUID,
  nome                   TEXT,
  -- atribuições no período (escala_membros publicadas)
  escalas_total          BIGINT,   -- total de escalas atribuídas (inclui futuras)
  escalas_realizadas     BIGINT,   -- escalas com presença efetiva (presente/atrasado) em historico_participacoes
  escalas_futuras        BIGINT,   -- atribuições com data >= hoje (ainda não ocorreram)
  -- oportunidades: escalas publicadas no período onde o membro é elegível
  -- (tem o ministério em membro_ministerios + sem indisponibilidade na data)
  -- cada escala conta uma vez, independentemente de quantos ministérios o membro tenha nela
  oportunidades          BIGINT,
  taxa_aproveitamento    NUMERIC,  -- escalas_total / oportunidades × 100 (NULL se 0 oport.)
  atribuicoes_extras     BIGINT,   -- GREATEST(0, escalas_total − oportunidades): admin overrides
  -- presenças históricas (fonte canônica: historico_participacoes, anulada=false)
  presencas              BIGINT,
  faltas                 BIGINT,
  taxa_presenca          NUMERIC,
  -- último serviço e intervalo (fonte canônica: historico_participacoes)
  data_ultimo_servico    DATE,
  media_dias_intervalo   NUMERIC,
  -- ministérios em que foi escalado no período
  ministerios_periodo    JSONB,
  -- coeficiente de Gini calculado sobre escalas_total do grupo (rank médio para empates)
  gini_periodo           NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH

  -- I1 / I1b: Validação de acesso — retorna 0 linhas se não autorizado.
  -- Autorizado quando: auth.uid() não é NULL E (é admin OU é membro ativo da paróquia).
  -- Para membros: se já existe auth_user_id vinculado, exige correspondência por auth_user_id;
  -- somente quando auth_user_id IS NULL aceita correspondência por e-mail.
  -- Implementado como CROSS JOIN implícito: se _auth_check retornar 0 linhas,
  -- todos os CTEs dependentes retornam 0 linhas → resultado vazio.
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
              -- Vínculo direto: sempre preferido quando disponível
              (caller.auth_user_id IS NOT NULL AND caller.auth_user_id = auth.uid())
              -- Fallback por e-mail: apenas para membros sem auth_user_id vinculado
              OR (caller.auth_user_id IS NULL
                  AND LOWER(TRIM(COALESCE(caller.email, '')))
                       = LOWER(TRIM(COALESCE(auth.email(), ''))))
            )
        )
      )
  ),

  -- Membros elegíveis: ativos na paróquia (gate: _auth_check)
  base AS (
    SELECT m.id, m.nome
    FROM   membros m
    CROSS  JOIN _auth_check
    WHERE  m.paroquia_id = p_paroquia_id
      AND  m.ativo = true
  ),

  -- Escalas publicadas no período (exclui canceladas e rascunhos)
  escalas_periodo AS (
    SELECT e.id, e.data
    FROM   escalas e
    WHERE  e.paroquia_id = p_paroquia_id
      AND  e.status      = 'publicada'
      AND  e.data        BETWEEN p_inicio AND p_fim
  ),

  -- Atribuições de cada membro em escalas publicadas do período (escala_membros)
  -- Usado para: escalas_total, escalas_futuras, atribuicoes_extras, ministerios_periodo
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

  -- Oportunidades por membro: escalas publicadas no período onde o membro
  -- tem ministério em membro_ministerios que coincide com escala_funcoes,
  -- e não tem indisponibilidade ativa na data da escala.
  -- COUNT DISTINCT escala_id: mesmo que o membro tenha 2 ministérios
  -- na mesma escala, conta como 1 oportunidade.
  --
  -- I5: critério de indisponibilidade sincronizado com motor V3 (migration 162):
  --   • cancelada = false  — registros cancelados não bloqueiam
  --   • tipo 'dia'/'periodo' → data = ep.data  (bloqueio por data exata)
  --   • tipo 'intervalo'    → ep.data BETWEEN data AND data_fim  (bloqueio por range)
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

  -- I4: Histórico canônico — base para todos os indicadores de presença.
  -- Retorna linhas individuais; CTEs abaixo agregam conforme necessário.
  -- Inclui todos os registros de escala não anulados dentro do período,
  -- independentemente de presenca — a separação por tipo é feita downstream.
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

  -- Contagem de presenças e faltas (fonte canônica) — mantém separação completa
  historico_contagem AS (
    SELECT
      membro_id,
      COUNT(*) FILTER (WHERE presenca IN ('presente','atrasado')) AS presencas,
      COUNT(*) FILTER (WHERE presenca IN ('faltou','ausente'))    AS faltas
    FROM   historico
    GROUP  BY membro_id
  ),

  -- Subconjunto do histórico com presença efetiva (exclui faltou/ausente).
  -- Usado para escalas_realizadas, data_ultimo_servico e media_dias_intervalo:
  -- faltas e ausências não representam serviço prestado.
  historico_efetivo AS (
    SELECT membro_id, escala_id, data
    FROM   historico
    WHERE  presenca IN ('presente', 'atrasado')
  ),

  -- I4: Escalas realizadas = escalas com comparecimento efetivo
  -- (COUNT DISTINCT escala_id evita duplicidade quando há múltiplos ministérios)
  historico_escalas AS (
    SELECT membro_id, COUNT(DISTINCT escala_id) AS escalas_realizadas
    FROM   historico_efetivo
    GROUP  BY membro_id
  ),

  -- I4: Último serviço prestado (apenas presença efetiva)
  ultimo_servico AS (
    SELECT membro_id, MAX(data) AS data_ultimo_servico
    FROM   historico_efetivo
    GROUP  BY membro_id
  ),

  -- I4: Intervalo médio entre serviços consecutivos (apenas presença efetiva)
  -- Usa datas distintas por escala para evitar contar o mesmo serviço duas vezes
  -- quando o membro aparece em múltiplos ministérios da mesma escala.
  -- Requer ≥ 2 escalas distintas com presença; retorna NULL quando há menos de 2.
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

  -- Ministérios em que o membro foi escalado no período (fonte: escala_membros)
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

  -- Resultado principal por membro
  resultado AS (
    SELECT
      b.id   AS membro_id,
      b.nome AS nome,

      -- Atribuições totais (fonte: escala_membros)
      COUNT(DISTINCT a.escala_id)
        FILTER (WHERE a.escala_id IS NOT NULL)                             AS escalas_total,

      -- I4: Serviços realizados (fonte canônica: historico_participacoes)
      COALESCE(he.escalas_realizadas, 0)                                   AS escalas_realizadas,

      -- Atribuições futuras (fonte: escala_membros — escalas ainda não ocorridas)
      COUNT(DISTINCT a.escala_id)
        FILTER (WHERE a.escala_data >= CURRENT_DATE)                       AS escalas_futuras,

      -- Oportunidades
      COALESCE(oc.oportunidades, 0)                                        AS oportunidades,

      -- Taxa de aproveitamento: pode ultrapassar 100% quando há atribuições diretas
      CASE
        WHEN COALESCE(oc.oportunidades, 0) = 0 THEN NULL
        ELSE ROUND(
          COUNT(DISTINCT a.escala_id) FILTER (WHERE a.escala_id IS NOT NULL)
          ::NUMERIC / oc.oportunidades * 100, 1
        )
      END                                                                   AS taxa_aproveitamento,

      -- I3: Atribuições além das oportunidades calculadas (admin overrides sem ministério/com indisponibilidade)
      GREATEST(
        0,
        COUNT(DISTINCT a.escala_id) FILTER (WHERE a.escala_id IS NOT NULL)
        - COALESCE(oc.oportunidades, 0)
      )                                                                     AS atribuicoes_extras,

      -- Presenças e faltas (fonte canônica: historico_participacoes)
      COALESCE(hc.presencas, 0)                                            AS presencas,
      COALESCE(hc.faltas,    0)                                            AS faltas,
      CASE
        WHEN COALESCE(hc.presencas, 0) + COALESCE(hc.faltas, 0) = 0 THEN NULL
        ELSE ROUND(
          hc.presencas::NUMERIC / (hc.presencas + hc.faltas) * 100, 1
        )
      END                                                                   AS taxa_presenca,

      -- I4: Último serviço e intervalo (fonte canônica: historico_participacoes)
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

  -- C1 + I2: Gini com rank médio para empates.
  --
  -- Fórmula: G = (2 × Σ(avg_rk × v)) / (n × Σv) − (n+1)/n
  -- onde avg_rk é o rank médio (average rank) de cada linha:
  --   avg_rk = rank_asc + (count_empates − 1) / 2.0
  --   - rank_asc    = RANK() OVER (ORDER BY v ASC) — posição inicial do grupo empatado
  --   - count_empates = COUNT(*) OVER (PARTITION BY v) — tamanho do grupo empatado
  --
  -- Exemplos verificados:
  --   [0,0,5]   → avg_rk=[1.5,1.5,3],   Gini=0.667
  --   [1,1,4]   → avg_rk=[1.5,1.5,3],   Gini=0.333
  --   [1,2,4]   → avg_rk=[1,2,3],        Gini=0.286
  --   [0,0,0]   → Σv=0 → branch SUM=0,  Gini=0.000
  --   [0,0,1,1] → avg_rk=[1.5,1.5,3.5,3.5], Gini=0.500
  --
  -- O RANK em subquery separada resolve C1 (window function proibida
  -- como argumento de aggregate no mesmo nível de query).
  -- avg_rk com count_empates resolve I2 (rank médio explícito para empates).
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
