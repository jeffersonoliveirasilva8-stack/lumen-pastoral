-- Migration 149 — coord_get_substituicoes: restaura SET row_security = off
-- e adiciona fallback via profiles (source of truth do frontend)
--
-- PROBLEMA: migration 147 recriou a função sem SET row_security = off.
-- Sem isso, o SECURITY DEFINER não bypassa RLS nas sub-queries internas,
-- e auth.uid() pode não encontrar v_paroquia_id pelos 3 passos existentes
-- quando o usuário está em profiles mas não em user_roles/membros/coordenadores
-- com match exato.
--
-- FIX:
--  1. Adiciona SET row_security = off (igual migration 086)
--  2. Adiciona passo 0: lookup direto em profiles (tabela usada pelo frontend)

DROP FUNCTION IF EXISTS public.coord_get_substituicoes(TEXT);

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                  UUID,
  status              TEXT,
  motivo_solicitacao  TEXT,
  motivo_rejeicao     TEXT,
  aprovado_em         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  escala_id           UUID,
  escala_titulo       TEXT,
  escala_data         DATE,
  ministerio_id       UUID,
  ministerio_nome     TEXT,
  ministerio_cor      TEXT,
  solicitante_nome    TEXT,
  substituto_nome     TEXT,
  aprovador_nome      TEXT,
  aberta_para_membros BOOLEAN,
  solene              BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_paroquia_id UUID;
  v_is_allowed  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- 0. Lookup via profiles (source of truth do frontend — mais rápido e confiável)
  SELECT p.paroquia_id INTO v_paroquia_id
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.paroquia_id IS NOT NULL
  LIMIT 1;

  IF v_paroquia_id IS NOT NULL THEN
    v_is_allowed := true;
  END IF;

  -- 1. Admin/coordenador via user_roles
  IF v_paroquia_id IS NULL THEN
    SELECT ur.paroquia_id INTO v_paroquia_id
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  -- 2. Coordenador/admin via membros.tipo_acesso
  IF v_paroquia_id IS NULL THEN
    SELECT m.paroquia_id INTO v_paroquia_id
    FROM public.membros m
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'coordenador', 'administrador')
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  -- 3. Coordenador via tabela coordenadores
  IF v_paroquia_id IS NULL THEN
    SELECT c.paroquia_id INTO v_paroquia_id
    FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND c.ativo = true
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
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
    ma.nome    AS aprovador_nome,
    COALESCE(s.aberta_para_membros, false) AS aberta_para_membros,
    COALESCE(e.solene, false) AS solene
  FROM public.substituicoes s
  JOIN public.escala_membros em   ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
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
