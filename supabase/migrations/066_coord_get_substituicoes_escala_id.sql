-- migration 066 — coord_get_substituicoes: adiciona escala_id e ministerio_id ao retorno
--
-- Problema: a RPC não retornava escala_id nem ministerio_id, então o botão
-- "Buscar substitutos" chamava admin_buscar_substitutos com undefined nos dois
-- parâmetros obrigatórios — nenhum substituto era encontrado.
--
-- PostgreSQL não permite CREATE OR REPLACE quando o tipo de retorno muda.
-- Necessário DROP + CREATE.

DROP FUNCTION IF EXISTS public.coord_get_substituicoes(TEXT);

CREATE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao    TEXT,
  aprovado_em        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ,
  escala_id          UUID,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_id      UUID,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT,
  substituto_nome    TEXT,
  aprovador_nome     TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  -- 1. Tenta via membros (vínculo direto)
  SELECT m.paroquia_id INTO v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  -- 2. Fallback via profiles
  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id
    FROM public.profiles
    WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  -- 3. Verifica autorização
  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_auth_id
        AND paroquia_id = v_paroquia_id
        AND role IN ('super_admin', 'admin_paroquial', 'coordenador', 'lider')
    )
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
    e.id       AS escala_id,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    em.ministerio_id,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome,
    ma.nome    AS aprovador_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
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
