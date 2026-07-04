-- Migration 086 — coord_get_substituicoes: inclui role 'coordenador' + row_security off
--
-- PROBLEMA: a migration 073 verificava permissão via user_roles mas listava apenas
-- ('super_admin', 'admin_paroquial', 'lider') — omitindo 'coordenador'.
-- Usuários com role 'coordenador' passavam por todas as três etapas sem sucesso,
-- v_is_allowed ficava false e a função retornava [] silenciosamente.
--
-- CAUSA RAIZ:
--   Passo 1 (user_roles): não incluía 'coordenador'
--   Passo 2 (membros.tipo_acesso): só funciona se auth_user_id estiver vinculado E tipo_acesso correto
--   Passo 3 (coordenadores): só funciona se o membro estiver nessa tabela
--
-- FIX:
--   1. Adiciona 'coordenador' ao IN(...) do passo 1
--   2. Adiciona SET row_security = off (segurança: SECURITY DEFINER não garante bypass em todas as configs Supabase)
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

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

  -- 1. Admin/coordenador via user_roles (inclui 'coordenador' — ausente na 073)
  SELECT ur.paroquia_id INTO v_paroquia_id
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
  LIMIT 1;

  IF v_paroquia_id IS NOT NULL THEN
    v_is_allowed := true;
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

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
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

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
  END IF;

  IF NOT v_is_allowed OR v_paroquia_id IS NULL THEN RETURN; END IF;

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
  JOIN public.escala_membros em   ON em.id  = s.escala_membro_id
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

NOTIFY pgrst, 'reload schema';
