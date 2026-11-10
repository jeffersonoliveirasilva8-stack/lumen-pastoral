-- Migration 208 — Sprint B Fix: solicitar_justificativa
--
-- Correções aplicadas:
-- 1. FOR UPDATE em escala_convocacoes para serializar com registrar_comparecimento_solene:
--    impede que membro solicite ausência enquanto coordenação registra presença
--    na mesma transação concorrente.
-- 2. Bloqueia justificativa de ausência quando membro já está registrado como
--    presente ou atrasado (em escala_convocacoes OU escala_membros).

CREATE OR REPLACE FUNCTION public.solicitar_justificativa(
  p_escala_id UUID,
  p_tipo      TEXT,   -- 'ausencia' | 'paramentacao'
  p_motivo    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_membro_id     UUID;
  v_paroquia_id   UUID;
  v_vinculado     BOOLEAN := false;
  v_novo_id       UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_tipo NOT IN ('ausencia','paramentacao') THEN
    RETURN jsonb_build_object('success', false, 'error', 'tipo_invalido');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  v_membro_id := public._portal_membro_id();

  SELECT e.paroquia_id INTO v_paroquia_id
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_encontrada');
  END IF;

  -- Serializa com registrar_comparecimento_solene para o mesmo (escala_id, membro_id)
  -- Se membro não está em escala_convocacoes, nenhum lock é obtido (OK)
  PERFORM ec.membro_id
  FROM    public.escala_convocacoes ec
  WHERE   ec.escala_id = p_escala_id
    AND   ec.membro_id = v_membro_id
  FOR UPDATE;

  -- Verifica vínculo: função específica ou convocação geral
  SELECT true INTO v_vinculado
  FROM   public.escala_membros em
  WHERE  em.escala_id = p_escala_id
    AND  em.membro_id = v_membro_id
    AND  (em.ativo IS NULL OR em.ativo = true)
  LIMIT 1;

  IF NOT v_vinculado THEN
    SELECT true INTO v_vinculado
    FROM   public.escala_convocacoes ec
    WHERE  ec.escala_id = p_escala_id
      AND  ec.membro_id = v_membro_id
    LIMIT 1;
  END IF;

  IF NOT v_vinculado THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_vinculado_a_celebracao');
  END IF;

  -- Bloqueio de ausência após presença já registrada
  IF p_tipo = 'ausencia' THEN
    IF EXISTS (
      SELECT 1 FROM public.escala_convocacoes
      WHERE escala_id = p_escala_id AND membro_id = v_membro_id AND status = 'presente'
      UNION ALL
      SELECT 1 FROM public.escala_membros
      WHERE escala_id = p_escala_id AND membro_id = v_membro_id
        AND status IN ('presente','atrasado')
        AND (ativo IS NULL OR ativo = true)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        'ausencia_invalida_membro_ja_registrado_presente');
    END IF;
  END IF;

  -- Para justificativa de paramentação: exige que o membro esteja presente
  IF p_tipo = 'paramentacao' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.escala_convocacoes
      WHERE escala_id = p_escala_id AND membro_id = v_membro_id AND status = 'presente'
      UNION ALL
      SELECT 1 FROM public.escala_membros
      WHERE escala_id = p_escala_id AND membro_id = v_membro_id
        AND status IN ('presente','atrasado')
        AND (ativo IS NULL OR ativo = true)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        'paramentacao_exige_presenca_registrada');
    END IF;
  END IF;

  -- Insere (índice parcial uniq_just_pendente impede duplicata pendente)
  INSERT INTO public.participacao_justificativas
    (paroquia_id, escala_id, membro_id, tipo, motivo, solicitado_por)
  VALUES
    (v_paroquia_id, p_escala_id, v_membro_id, p_tipo, trim(p_motivo), v_auth_id)
  RETURNING id INTO v_novo_id;

  RETURN jsonb_build_object(
    'success',          true,
    'justificativa_id', v_novo_id,
    'tipo',             p_tipo
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'justificativa_pendente_ja_existe');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) TO authenticated;
