-- Migration 116 — Fix origem='substituicao' → 'manual' na aprovação
--
-- CHECK constraint em escala_membros.origem só aceita ('motor','manual','importado').
-- A migration 115 usava origem='substituicao', violando o constraint.

CREATE OR REPLACE FUNCTION public.coord_aprovar_substituicao(p_substituicao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_coord_id  UUID;
  v_coord_par UUID;
  v_subst     public.substituicoes%ROWTYPE;
  v_em        public.escala_membros%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_coord_id, v_coord_par
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_coord_par IS NULL THEN
    SELECT paroquia_id INTO v_coord_par
    FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_coord_par IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_coord_par;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_subst.paroquia_id)
    OR public._portal_is_admin(v_subst.paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status <> 'com_voluntario' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_sem_voluntario', 'status', v_subst.status);
  END IF;

  IF v_subst.substituto_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_substituto');
  END IF;

  SELECT * INTO v_em FROM public.escala_membros WHERE id = v_subst.escala_membro_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  -- Soft-delete da linha do solicitante
  UPDATE public.escala_membros
     SET ativo = false, removido_em = now()
   WHERE id = v_subst.escala_membro_id;

  -- Upsert do substituto — origem='manual' (único valor válido além de motor/importado)
  INSERT INTO public.escala_membros
    (escala_id, membro_id, ministerio_id, status, ativo, removido_em, origem)
  VALUES
    (v_em.escala_id, v_subst.substituto_id, v_em.ministerio_id,
     'confirmado', true, NULL, 'manual')
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE
    SET status      = 'confirmado',
        ativo       = true,
        removido_em = NULL,
        origem      = 'manual';

  UPDATE public.substituicoes
     SET status = 'aprovada', aprovado_por = v_coord_id, aprovado_em = now()
   WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'aprovada', v_coord_id,
    jsonb_build_object(
      'membro_original', v_em.membro_id,
      'substituto',      v_subst.substituto_id,
      'escala_membro_id', v_subst.escala_membro_id
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_aprovar_substituicao(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
