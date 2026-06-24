-- Migration 098 — Fix coord_aprovar_substituicao: fallback via profiles
--
-- Problema: coord_aprovar_substituicao buscava a paróquia do coordenador
-- apenas na tabela membros. Se auth_user_id não estiver sincronizado
-- (coordenador criado antes da sincronização), v_coord_par fica NULL e
-- WHERE paroquia_id = NULL não casa com nenhuma linha →
-- retorna 'substituicao_not_found' mesmo a substituição existindo.
--
-- coord_get_substituicoes (migration 070) já tem esse fallback via profiles.
-- Esta migration replica o mesmo padrão em coord_aprovar_substituicao.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.coord_aprovar_substituicao(p_substituicao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_coord_id   UUID;
  v_coord_par  UUID;
  v_subst      public.substituicoes%ROWTYPE;
  v_em         public.escala_membros%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Tenta localizar coordenador em membros (auth_user_id ou e-mail)
  SELECT id, paroquia_id INTO v_coord_id, v_coord_par
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  -- Fallback: busca paróquia em profiles (coordenadores sem membros vinculado)
  IF v_coord_par IS NULL THEN
    SELECT paroquia_id INTO v_coord_par
    FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_coord_par IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_not_found');
  END IF;

  -- Filtra pela paróquia antes de qualquer verificação (evita information-disclosure)
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

  UPDATE public.escala_membros
  SET membro_id = v_subst.substituto_id, status = 'confirmado'
  WHERE id = v_subst.escala_membro_id;

  UPDATE public.substituicoes
  SET status = 'aprovada', aprovado_por = v_coord_id, aprovado_em = now()
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'aprovada', v_coord_id,
    jsonb_build_object(
      'membro_original', v_em.membro_id,
      'substituto', v_subst.substituto_id,
      'escala_membro_id', v_subst.escala_membro_id
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_aprovar_substituicao(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
