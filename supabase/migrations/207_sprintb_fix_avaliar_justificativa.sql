-- Migration 207 — Sprint B Fix: avaliar_justificativa
--
-- Correções aplicadas:
-- 1. SELECT FOR UPDATE para serializar avaliações concorrentes
-- 2. motivo_avaliacao separado do motivo original do membro
-- 3. WHERE avaliacao='pendente' no UPDATE como guard extra pós-lock
-- 4. Verifica ROW_COUNT para detectar race condition residual
-- 5. auxiliar (Secretário) não autorizado a avaliar justificativas

CREATE OR REPLACE FUNCTION public.avaliar_justificativa(
  p_justificativa_id UUID,
  p_avaliacao        TEXT,  -- 'aprovada' | 'rejeitada'
  p_motivo_rejeicao  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_caller_membro UUID;
  v_just          public.participacao_justificativas%ROWTYPE;
  v_paroquia_id   UUID;
  v_rows_updated  INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_avaliacao NOT IN ('aprovada','rejeitada') THEN
    RETURN jsonb_build_object('success', false, 'error', 'avaliacao_invalida');
  END IF;

  -- FOR UPDATE serializa avaliações concorrentes para a mesma justificativa
  SELECT * INTO v_just
  FROM   public.participacao_justificativas
  WHERE  id = p_justificativa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'justificativa_nao_encontrada');
  END IF;

  IF v_just.avaliacao != 'pendente' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ja_avaliada',
                              'avaliacao_atual', v_just.avaliacao);
  END IF;

  v_paroquia_id   := v_just.paroquia_id;
  v_caller_membro := public._portal_membro_id();

  -- Bloqueia autoavaliação
  IF v_just.solicitado_por = v_auth_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'autoavaliacao_proibida');
  END IF;

  -- Verifica permissão (auxiliar não avalia)
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = v_caller_membro
        AND paroquia_id = v_paroquia_id
        AND ativo       = true
        AND tipo_acesso IN ('vice','coordenador','administrador')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  UPDATE public.participacao_justificativas
  SET avaliacao        = p_avaliacao,
      avaliado_por     = v_auth_id,
      avaliado_em      = now(),
      motivo_avaliacao = CASE
                           WHEN p_avaliacao = 'rejeitada' THEN p_motivo_rejeicao
                           ELSE NULL
                         END
  WHERE id       = p_justificativa_id
    AND avaliacao = 'pendente';  -- guard extra após FOR UPDATE

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ja_avaliada_concorrentemente');
  END IF;

  RETURN jsonb_build_object(
    'success',   true,
    'avaliacao', p_avaliacao,
    'tipo',      v_just.tipo
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) TO authenticated;
