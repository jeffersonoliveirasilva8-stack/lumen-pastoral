-- Migration 121 — Retroativo pendentes + filtro substituições vencidas
--
-- Correções:
--  A. 18 linhas escala_membros com status='pendente' em escalas arquivadas/publicadas
--     passadas → marcadas como 'presente', historico criado, scores recalculados.
--  B. coord_get_substituicoes: exclui substituições com data de escala passada e
--     status ainda aberto ('solicitada','com_voluntario') — não aparecem mais como
--     pendentes no painel de coordenação.

-- ══════════════════════════════════════════════════════════════════════
-- A. Retroativo: pendentes em escalas passadas não-canceladas → presente
-- ══════════════════════════════════════════════════════════════════════

-- A1. Atualiza status — o trigger on_escala_membro_status_final dispara
--     e cria historico_participacoes automaticamente para cada linha.
UPDATE public.escala_membros em
SET    status                 = 'presente',
       presenca_registrada_em = NOW()
FROM   public.escalas e
WHERE  em.escala_id  = e.id
  AND  em.status     = 'pendente'
  AND  e.data        < CURRENT_DATE
  AND  e.status      IN ('publicada', 'arquivada')
  AND  (em.ativo IS NULL OR em.ativo = true);

-- A2. Garante historico para qualquer 'presente' que ainda não tenha registro
--     (inclui os recém-atualizados + eventuais lacunas históricas).
INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, escala_id, ministerio_id,
   tipo_evento, origem, presenca, data, pontos)
SELECT
  e.paroquia_id,
  em.membro_id,
  em.escala_id,
  em.ministerio_id,
  CASE WHEN COALESCE(e.tem_bispo,false) THEN 'bispo'
       WHEN COALESCE(e.solene,   false) THEN 'solene'
       ELSE 'escala'
  END,
  'escala',
  em.status,
  e.data,
  public._get_pontos_status(
    e.paroquia_id,
    em.status,
    COALESCE(e.solene,   false),
    COALESCE(e.tem_bispo,false)
  )
FROM public.escala_membros em
JOIN public.escalas e ON e.id = em.escala_id
WHERE em.status IN ('presente','faltou','atrasado','justificou','ausente')
  AND e.data    <  CURRENT_DATE
  AND e.status  IN ('publicada','arquivada')
  AND (em.ativo IS NULL OR em.ativo = true)
ON CONFLICT (membro_id, escala_id, ministerio_id)
  WHERE tipo_evento IN ('escala','solene','bispo')
    AND escala_id    IS NOT NULL
    AND ministerio_id IS NOT NULL
DO UPDATE
  SET presenca    = EXCLUDED.presenca,
      tipo_evento = EXCLUDED.tipo_evento,
      pontos      = EXCLUDED.pontos;

-- A3. Recalcula score de TODOS os membros ativos (garantia total).
UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;


-- ══════════════════════════════════════════════════════════════════════
-- B. coord_get_substituicoes — exclui pendentes de escalas passadas
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                UUID,
  status            TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao   TEXT,
  aprovado_em       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ,
  escala_id         UUID,
  escala_titulo     TEXT,
  escala_data       DATE,
  ministerio_id     UUID,
  ministerio_nome   TEXT,
  ministerio_cor    TEXT,
  solicitante_nome  TEXT,
  substituto_nome   TEXT,
  aprovador_nome    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_paroquia_id UUID;
  v_is_allowed  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT ur.paroquia_id INTO v_paroquia_id
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
  LIMIT 1;

  IF v_paroquia_id IS NOT NULL THEN
    v_is_allowed := true;
  END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT m.paroquia_id INTO v_paroquia_id
    FROM public.membros m
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'coordenador', 'administrador')
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
  END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT c.paroquia_id INTO v_paroquia_id
    FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND c.ativo = true
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
  END IF;

  IF NOT v_is_allowed OR v_paroquia_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id, s.status, s.motivo_solicitacao, s.motivo_rejeicao,
    s.aprovado_em, s.created_at,
    em.escala_id,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    em.ministerio_id,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome,
    ma.nome    AS aprovador_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em   ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
    -- Exclui substituições pendentes/com_voluntario de escalas já realizadas
    -- (não há mais ação possível — a missa já aconteceu)
    AND NOT (
      s.status IN ('solicitada', 'com_voluntario')
      AND e.data < CURRENT_DATE
    )
  ORDER BY
    CASE s.status
      WHEN 'com_voluntario' THEN 1
      WHEN 'solicitada'     THEN 2
      WHEN 'aprovada'       THEN 3
      WHEN 'rejeitada'      THEN 4
      WHEN 'cancelada'      THEN 5
    END,
    e.data ASC,
    s.created_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_substituicoes(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
