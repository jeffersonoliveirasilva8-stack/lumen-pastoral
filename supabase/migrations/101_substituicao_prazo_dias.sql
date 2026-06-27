-- Migration 101 — substituicao_prazo_dias
--
-- Adiciona campo configurável: quantos dias de antecedência mínima o membro
-- precisa ter para poder recusar a escala e pedir substituto.
-- NULL = sem restrição de dias (comportamento anterior).
--
-- A função portal_solicitar_substituicao passa a verificar esse limite
-- antes de criar a solicitação.
--
-- IDEMPOTENTE: sim

ALTER TABLE public.paroquia_config_escalas
  ADD COLUMN IF NOT EXISTS substituicao_prazo_dias INTEGER DEFAULT NULL;

-- ── Atualiza portal_solicitar_substituicao ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id        UUID := auth.uid();
  v_membro_id      UUID;
  v_paroquia_id    UUID;
  v_escala_data    DATE;
  v_escala_id      UUID;
  v_escala_titulo  TEXT;
  v_subst_id       UUID;
  v_subst_ativa    BOOLEAN;
  v_prazo_dias     INTEGER;
  v_ministerio_id  UUID;
  v_min_nome       TEXT;
  v_elegivel       RECORD;
  v_token          UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT m.id, m.paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT COALESCE(substituicao_ativa, false), substituicao_prazo_dias
    INTO v_subst_ativa, v_prazo_dias
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT v_subst_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_desativada');
  END IF;

  SELECT e.data, em.escala_id, e.titulo, em.ministerio_id
    INTO v_escala_data, v_escala_id, v_escala_titulo, v_ministerio_id
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

  -- Verificação do prazo em dias
  IF v_prazo_dias IS NOT NULL AND (v_escala_data - CURRENT_DATE) < v_prazo_dias THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'prazo_expirado',
      'dias_restantes', (v_escala_data - CURRENT_DATE)::int,
      'prazo_dias', v_prazo_dias
    );
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

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_ministerio_id;

  IF v_ministerio_id IS NOT NULL THEN
    FOR v_elegivel IN
      SELECT mm.membro_id
      FROM public.membro_ministerios mm
      JOIN public.membros m ON m.id = mm.membro_id
      WHERE mm.ministerio_id = v_ministerio_id
        AND m.paroquia_id    = v_paroquia_id
        AND m.ativo          = true
        AND mm.membro_id    <> v_membro_id
        AND NOT EXISTS (
          SELECT 1 FROM public.escala_membros em2
          WHERE em2.escala_id     = v_escala_id
            AND em2.membro_id     = mm.membro_id
            AND em2.ministerio_id = v_ministerio_id
            AND em2.status NOT IN ('recusado', 'faltou')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.indisponibilidades i
          WHERE i.membro_id = mm.membro_id
            AND i.data_inicio <= v_escala_data
            AND i.data_fim    >= v_escala_data
        )
    LOOP
      v_token := gen_random_uuid();
      INSERT INTO public.notificacoes
        (paroquia_id, membro_id, tipo, titulo, mensagem, dados, lida)
      VALUES
        (v_paroquia_id, v_elegivel.membro_id,
         'substituicao_aberta',
         'Vaga aberta em ' || COALESCE(v_min_nome, 'ministério'),
         'Há uma vaga em ' || COALESCE(v_escala_titulo, 'escala') || ' para você se voluntariar.',
         jsonb_build_object(
           'substituicao_id', v_subst_id,
           'escala_id', v_escala_id,
           'token', v_token
         ),
         false);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
