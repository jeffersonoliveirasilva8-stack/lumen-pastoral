-- Migration 122 — Corrige SELECT role FROM profiles → user_roles
--
-- Migration 117 criou duas funções que buscavam 'role' e 'paroquia_id'
-- de public.profiles, mas essa coluna não existe lá — fica em user_roles.
-- Erro resultante: column "role" does not exist (42703).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. expirar_substituicoes_vencidas
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expirar_substituicoes_vencidas(
  p_paroquia_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_paroquia   UUID;
  v_role       TEXT;
  v_expiradas  INT := 0;
  v_faltas     INT := 0;
BEGIN
  -- Busca role e paróquia de user_roles (não de profiles)
  SELECT ur.role::TEXT, ur.paroquia_id INTO v_role, v_paroquia
  FROM public.user_roles ur
  WHERE ur.user_id = v_auth_id
  LIMIT 1;

  IF v_role NOT IN ('coordenador', 'admin_paroquial', 'vice_coordenador', 'super_admin', 'lider') THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF p_paroquia_id IS NOT NULL THEN
    v_paroquia := p_paroquia_id;
  END IF;

  IF v_paroquia IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_not_found');
  END IF;

  UPDATE public.substituicoes s
     SET status = 'cancelada'
    FROM public.escalas e
   WHERE s.escala_id = e.id
     AND s.paroquia_id = v_paroquia
     AND s.status IN ('solicitada', 'com_voluntario')
     AND e.data < CURRENT_DATE;

  GET DIAGNOSTICS v_expiradas = ROW_COUNT;

  UPDATE public.escala_membros em
     SET status = 'faltou'
    FROM public.escalas e
   WHERE em.escala_id = e.id
     AND e.paroquia_id = v_paroquia
     AND e.data < CURRENT_DATE
     AND e.status = 'publicada'
     AND em.status NOT IN ('presente', 'faltou', 'atrasado', 'justificou', 'ausente', 'confirmado')
     AND (em.ativo IS NULL OR em.ativo = true);

  GET DIAGNOSTICS v_faltas = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',    true,
    'expiradas',  v_expiradas,
    'faltas',     v_faltas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expirar_substituicoes_vencidas(UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. registrar_substituto_retroativo
-- ══════════════════════════════════════════════════════════════════════════════

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
  -- Busca role e paróquia de user_roles (não de profiles)
  SELECT ur.role::TEXT, ur.paroquia_id INTO v_role, v_caller_par
  FROM public.user_roles ur
  WHERE ur.user_id = v_auth_id
  LIMIT 1;

  IF v_role NOT IN ('coordenador', 'admin_paroquial', 'vice_coordenador', 'super_admin', 'lider') THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_caller_par IS NULL THEN
    -- Fallback: tenta via membros
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

  UPDATE public.escala_membros
     SET status = 'faltou'
   WHERE id = p_escala_membro_id;

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
