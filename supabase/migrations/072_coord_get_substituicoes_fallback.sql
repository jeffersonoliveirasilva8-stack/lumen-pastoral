-- migration 072 — Fix coord_get_substituicoes: fallback paroquia_id via user_roles
--
-- Causa raiz: usuários que são apenas admin (sem registro em membros) e cujo
-- profiles.paroquia_id é NULL tinham v_paroquia_id = NULL → função abortava
-- antes de chegar na verificação de _portal_is_admin.
--
-- Fix: terceiro fallback que lê paroquia_id diretamente de user_roles.
-- Isso garante que qualquer admin_paroquial / super_admin / lider que esteja
-- em user_roles consiga ver as substituições da sua paróquia.

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
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

  -- 1. Tenta resolver paróquia pelo registro de membro
  SELECT m.paroquia_id INTO v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  -- 2. Fallback: profiles
  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id
    FROM public.profiles
    WHERE id = v_auth_id;
  END IF;

  -- 3. Fallback: user_roles (admin sem membro nem profile completo)
  IF v_paroquia_id IS NULL THEN
    SELECT ur.paroquia_id INTO v_paroquia_id
    FROM public.user_roles ur
    WHERE ur.user_id = v_auth_id
      AND ur.role IN ('super_admin', 'admin_paroquial', 'lider')
    LIMIT 1;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  -- Verifica permissão
  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
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
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e  ON e.id   = em.escala_id
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
