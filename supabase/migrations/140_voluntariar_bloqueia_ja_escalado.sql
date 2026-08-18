-- Migration 140 — Bloqueia voluntariado de membro já escalado na mesma escala
--
-- Causa raiz: portal_voluntariar_substituicao não verifica se o voluntário já
-- está escalado na mesma escala do solicitante. Um membro podia se voluntariar
-- para servir "no lugar de" alguém na mesma escala em que ele próprio já estava
-- comprometido, gerando duplicidade e comprometendo a lógica de substituição.
--
-- Fix: antes de aceitar o voluntariado, verifica se o voluntário possui algum
-- registro ativo em escala_membros para a mesma escala (via escala_membro_id
-- da substituição → escala_membros.escala_id).
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.portal_voluntariar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_conf_ativa  BOOLEAN;
  v_status      TEXT;
  v_solicitante UUID;
  v_escala_id   UUID;
  v_ja_escalado BOOLEAN;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Verifica regra confirmacao_escala_ativa
  SELECT COALESCE((regras_escala->>'confirmacao_escala_ativa')::boolean, false)
    INTO v_conf_ativa
  FROM public.paroquias WHERE id = v_paroquia_id;

  IF NOT v_conf_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'confirmacao_desativada');
  END IF;

  SELECT s.status, s.solicitante_id, em.escala_id
    INTO v_status, v_solicitante, v_escala_id
  FROM public.substituicoes s
  JOIN public.escala_membros em ON em.id = s.escala_membro_id
  WHERE s.id = p_substituicao_id AND s.paroquia_id = v_paroquia_id;

  IF NOT FOUND OR v_status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel');
  END IF;

  IF v_solicitante = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  -- Bloqueia se o voluntário já está escalado na mesma escala
  SELECT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE escala_id = v_escala_id
      AND membro_id = v_membro_id
      AND ativo = true
      AND status NOT IN ('ausente', 'recusou')
  ) INTO v_ja_escalado;

  IF v_ja_escalado THEN
    RETURN jsonb_build_object('success', false, 'error', 'ja_escalado_nesta_escala');
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id, updated_at = now()
  WHERE id = p_substituicao_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
