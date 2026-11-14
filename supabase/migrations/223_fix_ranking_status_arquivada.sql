-- Migration 223 — get_ranking_completo v4
--
-- Problema (identificado na validação pós-218):
--   Os campos v2 (data_ultima_escala, dias_sem_servir, convocacoes_12sem,
--   presencas_12sem, taxa_presenca_12sem) retornavam NULL/0 porque os JOINs
--   de escala_membros filtravam e.status = 'publicada'. Escalas após ocorrer
--   ficam com status = 'arquivada' — igual ao fix das migrations 219 e 221.
--
-- Fix adicional (prevenção de multiplicação cartesiana):
--   A versão 218 agrega hp, em_all e em12 no mesmo SELECT com múltiplos
--   LEFT JOINs de-para-muitos. Com em_all e em12 retornando 0 linhas (bug
--   do status), o problema estava oculto. Corrigindo o status, a multiplicação
--   inflaria total_convocacoes (ex: 330 → 19.380).
--
--   Solução: pré-agregar cada dimensão em CTEs separadas antes do JOIN final,
--   eliminando a multiplicação cruzada entre hp, em_all e em12.
--
-- Campos preservados integralmente:
--   total_convocacoes, total_presencas, total_faltas, taxa_presenca
--   → continuam via historico_participacoes (mesma lógica da 218)
--   ministerios, score, nome, id → não afetados
--
-- Retrocompatível: assinatura e ordem de colunas idênticas à 218.

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
  WITH

  -- ── Janela de 12 semanas ────────────────────────────────────────────────────
  janela AS (
    SELECT (CURRENT_DATE - INTERVAL '12 weeks')::DATE AS inicio
  ),

  -- ── Histórico total via historico_participacoes (fonte canônica — inalterado da 218) ──
  hp_agg AS (
    SELECT
      hp.membro_id,
      COUNT(*)                                                    AS total_convocacoes,
      COUNT(*) FILTER (WHERE hp.presenca IN ('presente','atrasado'))   AS total_presencas,
      COUNT(*) FILTER (WHERE hp.presenca IN ('faltou','ausente'))      AS total_faltas,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE hp.presenca IN ('presente','atrasado','faltou','ausente')
        ) = 0 THEN 0
        ELSE ROUND(
          COUNT(*) FILTER (WHERE hp.presenca IN ('presente','atrasado'))::NUMERIC
          / COUNT(*) FILTER (
              WHERE hp.presenca IN ('presente','atrasado','faltou','ausente')
            ) * 100, 1
        )
      END                                                         AS taxa_presenca
    FROM public.historico_participacoes hp
    WHERE hp.paroquia_id = p_paroquia_id
      AND hp.anulada     = false
      AND hp.escala_id   IS NOT NULL
    GROUP BY hp.membro_id
  ),

  -- ── data_ultima_escala: pré-agrega por membro antes do JOIN final ──────────
  -- FIX: status IN ('publicada','arquivada')
  ultima_escala AS (
    SELECT
      em.membro_id,
      MAX(e.data) AS data_ultima
    FROM public.escala_membros em
    JOIN public.escalas e
      ON e.id           = em.escala_id
      AND e.paroquia_id = p_paroquia_id
      AND e.status      IN ('publicada','arquivada')   -- FIX
      AND e.data        < CURRENT_DATE
    WHERE em.ativo = true
    GROUP BY em.membro_id
  ),

  -- ── Janela 12 semanas: pré-agrega por membro antes do JOIN final ───────────
  -- FIX: status IN ('publicada','arquivada')
  em12_agg AS (
    SELECT
      em.membro_id,
      COUNT(*)                                                       AS convocacoes_12sem,
      COUNT(*) FILTER (WHERE em.status IN ('presente','atrasado'))  AS presencas_12sem,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE em.status IN ('presente','atrasado','faltou')
        ) = 0 THEN 0
        ELSE ROUND(
          COUNT(*) FILTER (WHERE em.status IN ('presente','atrasado'))::NUMERIC
          / COUNT(*) FILTER (WHERE em.status IN ('presente','atrasado','faltou')) * 100, 1
        )
      END                                                            AS taxa_presenca_12sem
    FROM public.escala_membros em
    CROSS JOIN janela
    JOIN public.escalas e12
      ON e12.id           = em.escala_id
      AND e12.paroquia_id = p_paroquia_id
      AND e12.status      IN ('publicada','arquivada')               -- FIX
      AND e12.data        >= janela.inicio
      AND e12.data        < CURRENT_DATE
    WHERE em.ativo = true
    GROUP BY em.membro_id
  ),

  -- ── Ministérios por membro: pré-agrega antes do JOIN final ─────────────────
  min_agg AS (
    SELECT
      mm.membro_id,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id',        min2.id,
            'nome',      min2.nome,
            'cor',       min2.cor,
            'categoria', min2.categoria
          )
        ) FILTER (WHERE min2.id IS NOT NULL),
        '[]'::jsonb
      ) AS ministerios
    FROM public.membro_ministerios mm
    JOIN public.ministerios min2
      ON min2.id    = mm.ministerio_id
      AND min2.ativo = true
    GROUP BY mm.membro_id
  )

  -- ── Join final: um-para-um entre CTEs ──────────────────────────────────────
  SELECT
    m.id,
    m.nome,
    COALESCE(m.score, 0)::INTEGER                                   AS score,
    COALESCE(hp.total_convocacoes, 0)                               AS total_convocacoes,
    COALESCE(hp.total_presencas,   0)                               AS total_presencas,
    COALESCE(hp.total_faltas,      0)                               AS total_faltas,
    COALESCE(hp.taxa_presenca,     0)                               AS taxa_presenca,
    COALESCE(mn.ministerios, '[]'::jsonb)                           AS ministerios,
    ue.data_ultima                                                  AS data_ultima_escala,
    CASE
      WHEN ue.data_ultima IS NULL THEN NULL
      ELSE (CURRENT_DATE - ue.data_ultima)::INTEGER
    END                                                             AS dias_sem_servir,
    COALESCE(e12.convocacoes_12sem,   0)                            AS convocacoes_12sem,
    COALESCE(e12.presencas_12sem,     0)                            AS presencas_12sem,
    COALESCE(e12.taxa_presenca_12sem, 0)                            AS taxa_presenca_12sem

  FROM public.membros m
  LEFT JOIN hp_agg      hp  ON hp.membro_id  = m.id
  LEFT JOIN ultima_escala ue ON ue.membro_id = m.id
  LEFT JOIN em12_agg    e12 ON e12.membro_id = m.id
  LEFT JOIN min_agg     mn  ON mn.membro_id  = m.id

  WHERE m.paroquia_id = p_paroquia_id
    AND m.ativo       = true

  ORDER BY m.score DESC, m.nome;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_completo(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
