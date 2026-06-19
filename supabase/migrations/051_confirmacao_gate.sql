-- migration 051 — Gating de confirmação e substituição pela regra confirmacao_escala_ativa
--
-- Problema: membros conseguiam confirmar presença, recusar e pedir substituição
-- independentemente da configuração "Confirmação Ativa" do motor de escalas.
-- Fix: as três RPCs de ação do portal verificam regras_escala->>'confirmacao_escala_ativa'
-- antes de prosseguir e retornam 'confirmacao_desativada' se a regra estiver false.

-- DROP garante que defaults de versões anteriores não bloqueiem CREATE OR REPLACE
DROP FUNCTION IF EXISTS public.portal_recusar_escala(UUID, TEXT);

-- ── 1. portal_recusar_escala ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_escala_id   UUID;
  v_subst_id    UUID;
  v_conf_ativa  BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_membro_id
  FROM public.membros
  WHERE (auth_user_id = auth.uid()
         OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT escala_id INTO v_escala_id
  FROM public.escala_membros
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = v_escala_id;

  -- Verifica regra confirmacao_escala_ativa
  SELECT COALESCE((regras_escala->>'confirmacao_escala_ativa')::boolean, false)
    INTO v_conf_ativa
  FROM public.paroquias WHERE id = v_paroquia_id;

  IF NOT v_conf_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'confirmacao_desativada');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Atualiza status para recusado
  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = p_motivo, updated_at = now()
  WHERE id = p_escala_membro_id;

  -- Cria solicitação de substituição
  INSERT INTO public.substituicoes (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
  RETURNING id INTO v_subst_id;

  -- Notifica coordenação
  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  SELECT v_paroquia_id,
    'Recusa de escala registrada',
    format('%s recusou a escala "%s". Uma substituição foi aberta.',
      (SELECT nome FROM public.membros WHERE id = v_membro_id),
      (SELECT titulo FROM public.escalas WHERE id = v_escala_id)),
    'aviso', false, true, '/substituicoes'
  WHERE v_paroquia_id IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;


-- ── 2. portal_solicitar_substituicao ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.portal_solicitar_substituicao(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_escala_data DATE;
  v_escala_id   UUID;
  v_subst_id    UUID;
  v_conf_ativa  BOOLEAN;
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

  INSERT INTO public.substituicoes (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
  RETURNING id INTO v_subst_id;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;


-- ── 3. portal_voluntariar_substituicao ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.portal_voluntariar_substituicao(UUID);

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
