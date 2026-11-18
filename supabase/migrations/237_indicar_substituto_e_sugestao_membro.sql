-- Migration 237 — indicar substituto (admin) + sugestão de substituto (membro)
--
-- 1. Coluna substituto_sugerido_id em substituicoes (membro sugere quem substitui)
-- 2. coord_indicar_substituto: admin designa diretamente, aprovando em uma etapa
--    (mesmo que já haja voluntário — retorna old_substituto_id para notificação)
-- 3. portal_sugerir_substituto: membro sugere um substituto para sua solicitação
-- 4. coord_get_substituicoes v2: inclui substituto_sugerido_nome e escala_id e ministerio_id

ALTER TABLE public.substituicoes
  ADD COLUMN IF NOT EXISTS substituto_sugerido_id UUID REFERENCES public.membros(id) ON DELETE SET NULL;

-- ── 2. coord_indicar_substituto ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.coord_indicar_substituto(
  p_substituicao_id UUID,
  p_membro_id       UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id           UUID := auth.uid();
  v_paroquia_id       UUID;
  v_subst             public.substituicoes%ROWTYPE;
  v_em                public.escala_membros%ROWTYPE;
  v_old_substituto_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_autenticado');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_encontrada');
  END IF;

  SELECT m.paroquia_id INTO v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF NOT public.is_coordenador_da_paroquia(v_subst.paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario', 'aberta_para_membros') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Verificar que o membro indicado é da mesma paróquia e está ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.membros m WHERE m.id = p_membro_id AND m.paroquia_id = v_subst.paroquia_id AND m.ativo = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_invalido');
  END IF;

  -- Guardar voluntário anterior (para notificação de "obrigado pela disponibilidade")
  v_old_substituto_id := v_subst.substituto_id;

  -- Buscar a linha original do escala_membros para saber quem substituir
  SELECT * INTO v_em FROM public.escala_membros WHERE id = v_subst.escala_membro_id;

  -- Atualizar o slot original para o novo membro
  UPDATE public.escala_membros
  SET membro_id  = p_membro_id,
      status     = 'confirmado',
      updated_at = NOW()
  WHERE id = v_subst.escala_membro_id;

  -- Fechar a substituição como aprovada
  UPDATE public.substituicoes
  SET status               = 'aprovada',
      substituto_id        = p_membro_id,
      substituto_sugerido_id = NULL,
      aprovado_por         = v_auth_id,
      aprovado_em          = NOW(),
      updated_at           = NOW()
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'indicado_coordenacao', v_auth_id,
    jsonb_build_object(
      'membro_indicado', p_membro_id,
      'old_substituto_id', v_old_substituto_id
    ));

  RETURN jsonb_build_object(
    'success',              true,
    'old_substituto_id',    v_old_substituto_id,
    'solicitante_id',       v_subst.solicitante_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_indicar_substituto(UUID, UUID) TO authenticated;

-- ── 3. portal_sugerir_substituto ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_sugerir_substituto(
  p_substituicao_id        UUID,
  p_substituto_sugerido_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
  v_subst     public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_autenticado');
  END IF;

  SELECT m.id INTO v_membro_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_encontrada');
  END IF;

  -- Apenas o solicitante pode sugerir
  IF v_subst.solicitante_id != v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'aberta_para_membros') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Verificar que o sugerido é da mesma paróquia e ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.membros m
    WHERE m.id = p_substituto_sugerido_id AND m.paroquia_id = v_subst.paroquia_id AND m.ativo = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_invalido');
  END IF;

  UPDATE public.substituicoes
  SET substituto_sugerido_id = p_substituto_sugerido_id,
      updated_at             = NOW()
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'sugestao_membro', v_membro_id,
    jsonb_build_object('substituto_sugerido_id', p_substituto_sugerido_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_sugerir_substituto(UUID, UUID) TO authenticated;

-- ── 4. coord_get_substituicoes v2 ────────────────────────────────────────────
-- Adiciona substituto_sugerido_nome, escala_id, ministerio_id ao retorno
DROP FUNCTION IF EXISTS public.coord_get_substituicoes(TEXT);

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(
  id                      UUID,
  status                  TEXT,
  motivo_solicitacao      TEXT,
  motivo_rejeicao         TEXT,
  aprovado_em             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ,
  escala_id               UUID,
  escala_titulo           TEXT,
  escala_data             DATE,
  ministerio_id           UUID,
  ministerio_nome         TEXT,
  ministerio_cor          TEXT,
  solicitante_nome        TEXT,
  substituto_nome         TEXT,
  substituto_sugerido_nome TEXT,
  aprovador_nome          TEXT,
  aberta_para_membros     BOOLEAN,
  solene                  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.paroquia_id INTO v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;
  IF NOT public.is_coordenador_da_paroquia(v_paroquia_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
    em.escala_id,
    e.titulo      AS escala_titulo,
    e.data        AS escala_data,
    em.ministerio_id,
    min.nome      AS ministerio_nome,
    min.cor       AS ministerio_cor,
    ms.nome       AS solicitante_nome,
    mv.nome       AS substituto_nome,
    msugg.nome    AS substituto_sugerido_nome,
    ma.nome       AS aprovador_nome,
    COALESCE(s.aberta_para_membros, false) AS aberta_para_membros,
    COALESCE(e.solene, false)              AS solene
  FROM public.substituicoes s
  JOIN public.escala_membros em   ON em.id   = s.escala_membro_id
  JOIN public.escalas         e   ON e.id    = em.escala_id
  JOIN public.ministerios     min ON min.id  = em.ministerio_id
  JOIN public.membros         ms  ON ms.id   = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id   = s.substituto_id
  LEFT JOIN public.membros    msugg ON msugg.id = s.substituto_sugerido_id
  LEFT JOIN public.membros    ma  ON ma.id   = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY
    CASE s.status WHEN 'com_voluntario' THEN 1 WHEN 'solicitada' THEN 2 ELSE 3 END,
    s.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_substituicoes(TEXT) TO authenticated;

-- ── 5. portal_buscar_membros_ministerio ──────────────────────────────────────
-- Permite ao membro portal buscar colegas do mesmo ministério para sugerir
-- como substituto. Retorna apenas nome + id (sem dados sensíveis).
CREATE OR REPLACE FUNCTION public.portal_buscar_membros_ministerio(
  p_ministerio_id UUID
)
RETURNS TABLE(membro_id UUID, nome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_membro_id  UUID;
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id, m.paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT m.id AS membro_id, m.nome
  FROM public.membros m
  JOIN public.membro_ministerios mm ON mm.membro_id = m.id AND mm.ministerio_id = p_ministerio_id
  WHERE m.paroquia_id = v_paroquia_id
    AND m.ativo = true
    AND m.id != v_membro_id
  ORDER BY m.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_buscar_membros_ministerio(UUID) TO authenticated;

-- ── 6. portal_get_ministerio_de_escala_membro ────────────────────────────────
-- Retorna o ministerio_id de um escala_membro do próprio membro.
-- Usado pelo portal após recusa para abrir o modal de sugestão de substituto.
CREATE OR REPLACE FUNCTION public.portal_get_ministerio_de_escala_membro(
  p_escala_membro_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_membro_id  UUID;
  v_min_id     UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN NULL; END IF;

  SELECT m.id INTO v_membro_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  SELECT em.ministerio_id INTO v_min_id
  FROM public.escala_membros em
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  RETURN v_min_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_ministerio_de_escala_membro(UUID) TO authenticated;

-- (portal_recusar_escala não alterada — ministerio_id buscado separadamente)

NOTIFY pgrst, 'reload schema';

