-- Migration 141 — Corrige rejeição de voluntário em substituição
--
-- Bug 1 (banco): coord_rejeitar_substituicao, ao rejeitar um voluntário
--   (status = 'com_voluntario'), marcava a substituição como 'rejeitada'
--   definitivamente — impedindo que outro membro se candidatasse.
--   Fix: quando há voluntário, volta para 'solicitada' e limpa substituto_id.
--   Retorna { success, acao } para o frontend saber qual notificação enviar.
--
-- Bug 2 (apontado aqui como referência): notificar-substituicao enviava o
--   e-mail de rejeição para o SOLICITANTE. Corrigido na edge function.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.coord_rejeitar_substituicao(
  p_substituicao_id UUID,
  p_motivo          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_coord_id   UUID;
  v_subst      public.substituicoes%ROWTYPE;
  v_acao       TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_coord_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT public.is_coordenador_da_paroquia(v_subst.paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_rejeitavel', 'status', v_subst.status);
  END IF;

  IF v_subst.status = 'com_voluntario' THEN
    -- Rejeita o voluntário: volta para aberta, preserva o ID do voluntário
    -- rejeitado no histórico para auditoria
    v_acao := 'voluntario_rejeitado';
    UPDATE public.substituicoes
    SET status = 'solicitada', substituto_id = NULL, motivo_rejeicao = p_motivo,
        updated_at = now()
    WHERE id = p_substituicao_id;

    INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
    VALUES (p_substituicao_id, 'voluntario_rejeitado', v_coord_id,
      jsonb_build_object('motivo', p_motivo, 'substituto_id', v_subst.substituto_id));
  ELSE
    -- Sem voluntário: rejeita a solicitação inteira
    v_acao := 'rejeitada';
    UPDATE public.substituicoes
    SET status = 'rejeitada', motivo_rejeicao = p_motivo, updated_at = now()
    WHERE id = p_substituicao_id;

    INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
    VALUES (p_substituicao_id, 'rejeitada', v_coord_id,
      jsonb_build_object('motivo', p_motivo));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'acao', v_acao,
    'substituto_id', v_subst.substituto_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_rejeitar_substituicao(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
