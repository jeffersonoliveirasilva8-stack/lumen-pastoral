-- migration 074 — coord_reenviar_notificacao_substituicao: permissão inline
--
-- Causa raiz: igual à 073. _portal_is_admin e is_coordenador_da_paroquia
-- não propagam auth.uid() corretamente dentro de SECURITY DEFINER.
-- Fix: inline checks via user_roles, como feito em coord_get_substituicoes.

CREATE OR REPLACE FUNCTION public.coord_reenviar_notificacao_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_paroquia_id UUID;
  v_is_allowed  BOOLEAN := false;
  v_status      TEXT;
  v_token       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- 1. Admin via user_roles
  SELECT ur.paroquia_id INTO v_paroquia_id
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.role IN ('super_admin', 'admin_paroquial', 'lider')
  LIMIT 1;

  IF v_paroquia_id IS NOT NULL THEN
    v_is_allowed := true;
  END IF;

  -- 2. Coordenador via membros
  IF v_paroquia_id IS NULL THEN
    SELECT m.paroquia_id INTO v_paroquia_id
    FROM public.membros m
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'coordenador', 'administrador')
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
  END IF;

  -- 3. Coordenador via tabela coordenadores
  IF v_paroquia_id IS NULL THEN
    SELECT c.paroquia_id INTO v_paroquia_id
    FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND c.ativo = true
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN
      v_is_allowed := true;
    END IF;
  END IF;

  IF NOT v_is_allowed OR v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  SELECT s.status INTO v_status
  FROM public.substituicoes s
  WHERE s.id          = p_substituicao_id
    AND s.paroquia_id = v_paroquia_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_encontrada');
  END IF;

  IF v_status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Gera token de uso único e dispara edge function via pg_net
  INSERT INTO public.notificacao_tokens (substituicao_id)
  VALUES (p_substituicao_id)
  RETURNING token INTO v_token;

  BEGIN
    PERFORM net.http_post(
      url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/notificar-substituicao',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_token::TEXT
      ),
      body    := jsonb_build_object('substituicao_id', p_substituicao_id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_reenviar_notificacao_substituicao(UUID) TO authenticated;
