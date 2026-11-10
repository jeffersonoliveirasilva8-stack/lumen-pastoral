-- Migration 201 — Sprint B M10
-- RPC avaliar_justificativa(p_justificativa_id, p_avaliacao, p_motivo_rejeicao?)
--
-- Permite que coord/admin avalie (aprove ou rejeite) uma justificativa pendente.
-- Bloqueia autoavaliação: o avaliador não pode ser o mesmo que solicitou.
-- Justificativa de paramentação aprovada NÃO altera a presença do membro.

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
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_avaliacao NOT IN ('aprovada','rejeitada') THEN
    RETURN jsonb_build_object('success', false, 'error', 'avaliacao_invalida');
  END IF;

  SELECT * INTO v_just
  FROM   public.participacao_justificativas
  WHERE  id = p_justificativa_id;

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

  -- Verifica permissão
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
  SET avaliacao      = p_avaliacao,
      avaliado_por   = v_auth_id,
      avaliado_em    = now(),
      -- Armazena motivo de rejeição no campo motivo (append) quando rejeitada
      motivo         = CASE
                         WHEN p_avaliacao = 'rejeitada' AND p_motivo_rejeicao IS NOT NULL
                         THEN motivo || E'\n[Rejeição] ' || p_motivo_rejeicao
                         ELSE motivo
                       END
  WHERE id = p_justificativa_id;

  -- Nota: justificativa de paramentação aprovada não altera presença no histórico.
  -- O desconto de pontuação (D3, valor pendente) será deduzido via trigger futuro
  -- ao implementar a pontuação de paramentação.

  RETURN jsonb_build_object(
    'success',   true,
    'avaliacao', p_avaliacao,
    'tipo',      v_just.tipo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) FROM anon;
