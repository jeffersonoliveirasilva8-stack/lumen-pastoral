-- migration 060 — Separa gate de substituição do gate de confirmação
--
-- Problema: portal_solicitar_substituicao e portal_voluntariar_substituicao
-- verificavam confirmacao_escala_ativa (gate de confirmação de presença).
-- Confirmação e substituição são ações independentes — o gate correto para
-- substituição é substituicao_ativa de paroquia_config_escalas.

-- ── 1. portal_solicitar_substituicao ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.portal_solicitar_substituicao(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_escala_id    UUID;
  v_subst_id     UUID;
  v_subst_ativa  BOOLEAN;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Gate correto: substituicao_ativa em paroquia_config_escalas
  SELECT COALESCE(substituicao_ativa, false)
    INTO v_subst_ativa
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT v_subst_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_desativada');
  END IF;

  SELECT e.data, em.escala_id INTO v_escala_data, v_escala_id
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id
    AND em.membro_id = v_membro_id
    AND e.paroquia_id = v_paroquia_id;

  IF v_escala_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  IF v_escala_data <= CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_ja_ativa');
  END IF;

  INSERT INTO public.substituicoes
    (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES
    (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id, trim(p_motivo), 'solicitada')
  RETURNING id INTO v_subst_id;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;


-- ── 2. portal_voluntariar_substituicao ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.portal_voluntariar_substituicao(UUID);

CREATE OR REPLACE FUNCTION public.portal_voluntariar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_subst_ativa  BOOLEAN;
  v_status       TEXT;
  v_solicitante  UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Gate correto: substituicao_ativa em paroquia_config_escalas
  SELECT COALESCE(substituicao_ativa, false)
    INTO v_subst_ativa
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT v_subst_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_desativada');
  END IF;

  SELECT status, solicitante_id INTO v_status, v_solicitante
  FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_paroquia_id;

  IF NOT FOUND OR v_status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel');
  END IF;

  IF v_solicitante = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id, updated_at = now()
  WHERE id = p_substituicao_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;
