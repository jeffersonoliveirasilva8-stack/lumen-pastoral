-- Migration 124 — Substituição: original sempre recebe 0 pontos
--
-- Problema: mesmo com status 'justificou', se a paróquia configurar
-- pontuacao_justificou com valor negativo, o trigger de pontuação
-- descontava pontos do membro original substituído.
-- Substituição combinada não deve gerar penalidade alguma.
--
-- Correção: após atualizar o status do original para 'justificou',
-- fazer upsert explícito em historico_participacoes com pontos=0,
-- sobrescrevendo o que o trigger possa ter calculado.

CREATE OR REPLACE FUNCTION public.registrar_substituto_retroativo(
  p_escala_membro_id UUID,
  p_substituto_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_role         TEXT;
  v_caller_par   UUID;
  v_em           public.escala_membros%ROWTYPE;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_tipo_evento  TEXT;
BEGIN
  SELECT ur.role::TEXT, ur.paroquia_id INTO v_role, v_caller_par
  FROM public.user_roles ur
  WHERE ur.user_id = v_auth_id
  LIMIT 1;

  IF v_role NOT IN ('coordenador', 'admin_paroquial', 'vice_coordenador', 'super_admin', 'lider') THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_caller_par IS NULL THEN
    SELECT m.paroquia_id INTO v_caller_par
    FROM public.membros m
    WHERE (m.auth_user_id = v_auth_id
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
    LIMIT 1;
  END IF;

  IF v_caller_par IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_not_found');
  END IF;

  SELECT * INTO v_em FROM public.escala_membros WHERE id = p_escala_membro_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  SELECT paroquia_id, data, solene, tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM public.escalas WHERE id = v_em.escala_id;

  IF v_paroquia_id IS DISTINCT FROM v_caller_par THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.membros
    WHERE id = p_substituto_id AND paroquia_id = v_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituto_not_found');
  END IF;

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  -- Membro original: 'justificou' (combinei substituição, não é falta)
  UPDATE public.escala_membros
     SET status = 'justificou'
   WHERE id = p_escala_membro_id;

  -- Garante 0 pontos no historico do original, independente da config de pontuacao_justificou
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, v_em.membro_id, v_em.escala_id, v_em.ministerio_id,
     v_tipo_evento, 'escala', 'justificou', v_escala_data, 0)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala', 'solene', 'bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE SET presenca = 'justificou', pontos = 0;

  -- Recalcula score do original
  UPDATE public.membros
     SET score = (
       SELECT COALESCE(SUM(hp.pontos), 0)
       FROM public.historico_participacoes hp
       WHERE hp.membro_id = v_em.membro_id
     )
   WHERE id = v_em.membro_id;

  -- Substituto: 'presente' → trigger calcula pontos normalmente
  INSERT INTO public.escala_membros
    (escala_id, membro_id, ministerio_id, status, ativo, removido_em, origem)
  VALUES
    (v_em.escala_id, p_substituto_id, v_em.ministerio_id, 'presente', true, NULL, 'manual')
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE
    SET status      = 'presente',
        ativo       = true,
        removido_em = NULL,
        origem      = 'manual';

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_substituto_retroativo(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
