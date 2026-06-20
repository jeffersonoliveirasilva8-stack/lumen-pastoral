-- migration 070 — Substituições: fixes e novos recursos
--
-- 1. coord_get_substituicoes: adiciona escala_id e ministerio_id ao retorno
--    (campos necessários para "Buscar substituto" e "Reenviar" no frontend)
-- 2. coord_reenviar_notificacao_substituicao: permite reenviar e-mails de vaga
--    para membros elegíveis usando o mesmo padrão de token de uso único (069)

-- ── 1. coord_get_substituicoes ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao    TEXT,
  aprovado_em        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ,
  escala_id          UUID,
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_id      UUID,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT,
  substituto_nome    TEXT,
  aprovador_nome     TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
    em.escala_id,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    em.ministerio_id,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome,
    ma.nome    AS aprovador_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em  ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY
    CASE s.status
      WHEN 'com_voluntario' THEN 1
      WHEN 'solicitada'     THEN 2
      WHEN 'aprovada'       THEN 3
      WHEN 'rejeitada'      THEN 4
      WHEN 'cancelada'      THEN 5
    END,
    e.data ASC,
    s.created_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_substituicoes(TEXT) TO authenticated;

-- ── 2. coord_reenviar_notificacao_substituicao ───────────────────────────────
-- Reenviar e-mail de "vaga disponível" para membros elegíveis do ministério.
-- Usado pelo botão "Reenviar" na tela de Substituições do coordenador.
-- Gera um novo token de uso único (mesmo padrão da migration 069).

CREATE OR REPLACE FUNCTION public.coord_reenviar_notificacao_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_status      TEXT;
  v_token       UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Resolve paróquia do usuário logado
  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Confirma que a substituição pertence à paróquia e está aberta
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

  -- Gera token de uso único e chama a edge function
  INSERT INTO public.notificacao_tokens (substituicao_id)
  VALUES (p_substituicao_id)
  RETURNING token INTO v_token;

  BEGIN
    PERFORM net.http_post(
      url     := current_setting('app.supabase_url', true) || '/functions/v1/notificar-substituicao',
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
