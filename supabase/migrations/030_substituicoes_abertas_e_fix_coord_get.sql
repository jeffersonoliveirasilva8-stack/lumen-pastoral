-- ============================================================
-- Migration 030: Substituições abertas para voluntariar + fix coord_get
-- Data: 2026-06-13
--
-- PROBLEMAS CORRIGIDOS:
--
--   1. coord_get_substituicoes não retornava escala_id nem ministerio_id
--      → admin_buscar_substitutos precisa dessas colunas
--      → SubstAdminCard não conseguia abrir o modal de substitutos
--      Fix: adiciona escala_id e ministerio_id ao RETURNS TABLE
--
--   2. Não havia endpoint para membros verem substituições abertas
--      de outros membros para se voluntariar
--      Fix: nova função portal_get_substituicoes_abertas()
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 001–029 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. coord_get_substituicoes — adiciona escala_id + ministerio_id
-- ══════════════════════════════════════════════════════════════

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

  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  -- Fallback via profiles (admins sem membros record)
  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

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
    em.escala_id      AS escala_id,
    e.titulo          AS escala_titulo,
    e.data            AS escala_data,
    em.ministerio_id  AS ministerio_id,
    min.nome          AS ministerio_nome,
    min.cor           AS ministerio_cor,
    ms.nome           AS solicitante_nome,
    mv.nome           AS substituto_nome,
    ma.nome           AS aprovador_nome
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

-- ══════════════════════════════════════════════════════════════
-- 2. portal_get_substituicoes_abertas — substituições disponíveis
--    para outros membros se voluntariarem
-- ══════════════════════════════════════════════════════════════
-- Retorna substituições com status='solicitada' da paróquia do
-- membro logado, EXCLUINDO as que ele mesmo solicitou.
-- Só mostra escalas futuras.

CREATE OR REPLACE FUNCTION public.portal_get_substituicoes_abertas()
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  created_at         TIMESTAMPTZ,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id, m.paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.created_at,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  WHERE s.paroquia_id  = v_paroquia_id
    AND s.status       = 'solicitada'          -- aberta para voluntários
    AND s.solicitante_id <> v_membro_id        -- não mostra as próprias
    AND e.data         >= CURRENT_DATE         -- só escalas futuras
    -- O membro não pode ser voluntário para ministério que não atua
    AND EXISTS (
      SELECT 1 FROM public.membro_ministerios mm
      WHERE mm.membro_id = v_membro_id AND mm.ministerio_id = em.ministerio_id
    )
    -- Exclui se o próprio membro já está escalado nessa escala
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em2
      WHERE em2.escala_id = em.escala_id AND em2.membro_id = v_membro_id
    )
  ORDER BY e.data ASC, s.created_at ASC
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_substituicoes_abertas() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ coord_get_substituicoes retorna escala_id e ministerio_id
--   ✓ portal_get_substituicoes_abertas retorna substituições abertas
--     para o membro logado se voluntariar (filtra por ministério)
--   ✓ Substituições abertas excluem as próprias do membro
--   ✓ Só mostra escalas futuras
-- ─────────────────────────────────────────────────────────────
