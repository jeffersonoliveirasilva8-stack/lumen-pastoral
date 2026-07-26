-- Migration 123 — Membro substituído não recebe falta
--
-- Problema: registrar_substituto_retroativo marcava o membro original
-- como 'faltou' (−2 pontos). Substituição combinada não é falta —
-- o membro providenciou alguém no lugar, portanto deve ser 'justificou' (0 pontos).
--
-- Correção: original → 'justificou'; substituto → 'presente' (sem mudança).

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

  SELECT paroquia_id INTO v_paroquia_id
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

  -- Membro original: 'justificou' (0 pontos) — combinou substituição, não é falta
  UPDATE public.escala_membros
     SET status = 'justificou'
   WHERE id = p_escala_membro_id;

  -- Substituto: 'presente' → recebe pontos normalmente
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
