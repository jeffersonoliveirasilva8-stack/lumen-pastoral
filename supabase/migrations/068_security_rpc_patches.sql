-- migration 068 — Security patches e melhorias de RPCs
--
-- Fixes aplicados:
--   1. UNIQUE parcial em substituicoes(escala_membro_id) — previne race condition TOCTOU
--   2. portal_recusar_escala / portal_solicitar_substituicao — usa app.service_role_key
--      para chamar a edge function (antes usava a anon key pública)
--   3. portal_voluntariar_substituicao — verifica pertencimento ao ministério antes de
--      aceitar o voluntário; notifica voluntário anterior quando deslocado
--   4. coord_aprovar_substituicao — filtra substituicoes pela paróquia do coordenador
--      antes de checar permissão (previne information-disclosure oracle)
--
-- CONFIGURAÇÃO NECESSÁRIA (uma vez, via Supabase SQL Editor):
--   ALTER DATABASE postgres SET app.service_role_key = '<sua-service-role-key>';
--   Encontre a chave em: Supabase Dashboard → Settings → API → service_role (secret)
--   Se não configurado, o header fica NULL e a edge function rejeita com 401 (fail-closed).

-- ── 1. UNIQUE parcial — impede duplicatas mesmo sob concorrência ─────────────
CREATE UNIQUE INDEX IF NOT EXISTS substituicoes_escala_membro_ativa_uq
  ON public.substituicoes(escala_membro_id)
  WHERE status NOT IN ('cancelada', 'rejeitada');

-- ── 2. portal_recusar_escala — usa service_role_key ─────────────────────────
CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_membro_id     UUID;
  v_paroquia_id   UUID;
  v_escala_id     UUID;
  v_escala_data   DATE;
  v_subst_id      UUID;
  v_escala_titulo TEXT;
  v_membro_nome   TEXT;
  v_ministerio_id UUID;
  v_min_nome      TEXT;
  v_elegivel      RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT m.id, m.nome INTO v_membro_id, v_membro_nome
  FROM public.membros m
  WHERE (m.auth_user_id = auth.uid()
         OR lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT em.escala_id, e.paroquia_id, e.data, e.titulo, em.ministerio_id
    INTO v_escala_id, v_paroquia_id, v_escala_data, v_escala_titulo, v_ministerio_id
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_escala_data < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
    VALUES
      (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'), 'solicitada')
    RETURNING id INTO v_subst_id;
  END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id,
    'Recusa de escala — substituição aberta',
    format('%s recusou a escala "%s". Motivo: %s. Uma vaga foi aberta para substituição.',
      v_membro_nome, v_escala_titulo, trim(p_motivo)),
    'alerta', false, true, '/substituicoes'
  );

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_ministerio_id;

  IF v_subst_id IS NOT NULL AND v_ministerio_id IS NOT NULL THEN
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
          SELECT 1 FROM public.escala_membros em3
          JOIN public.escalas e2 ON e2.id = em3.escala_id
          WHERE em3.membro_id  = mm.membro_id
            AND e2.data        = v_escala_data
            AND e2.paroquia_id = v_paroquia_id
            AND em3.status IN ('pendente', 'confirmado', 'presente')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.indisponibilidades i
          WHERE i.membro_id = mm.membro_id
            AND i.data      = v_escala_data
            AND i.cancelada = false
        )
    LOOP
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
      VALUES (
        v_paroquia_id,
        'Vaga disponível: ' || coalesce(v_min_nome, 'Ministério'),
        format('Uma vaga em %s ficou disponível na escala "%s". Candidate-se no portal!',
          coalesce(v_min_nome, 'Ministério'), v_escala_titulo),
        'escala', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    BEGIN
      PERFORM net.http_post(
        url     := current_setting('app.supabase_url', true) || '/functions/v1/notificar-substituicao',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body    := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ── 3. portal_solicitar_substituicao — usa service_role_key ─────────────────
CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_membro_id     UUID;
  v_paroquia_id   UUID;
  v_escala_data   DATE;
  v_escala_id     UUID;
  v_escala_titulo TEXT;
  v_subst_id      UUID;
  v_subst_ativa   BOOLEAN;
  v_ministerio_id UUID;
  v_min_nome      TEXT;
  v_elegivel      RECORD;
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

  SELECT COALESCE(substituicao_ativa, false)
    INTO v_subst_ativa
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
          SELECT 1 FROM public.escala_membros em3
          JOIN public.escalas e2 ON e2.id = em3.escala_id
          WHERE em3.membro_id  = mm.membro_id
            AND e2.data        = v_escala_data
            AND e2.paroquia_id = v_paroquia_id
            AND em3.status IN ('pendente', 'confirmado', 'presente')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.indisponibilidades i
          WHERE i.membro_id = mm.membro_id
            AND i.data      = v_escala_data
            AND i.cancelada = false
        )
    LOOP
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
      VALUES (
        v_paroquia_id,
        'Vaga disponível: ' || coalesce(v_min_nome, 'Ministério'),
        format('Uma vaga em %s ficou disponível na escala "%s". Candidate-se no portal!',
          coalesce(v_min_nome, 'Ministério'), v_escala_titulo),
        'escala', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    BEGIN
      PERFORM net.http_post(
        url     := current_setting('app.supabase_url', true) || '/functions/v1/notificar-substituicao',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body    := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;

-- ── 4. portal_voluntariar_substituicao — verifica ministério + notifica deslocado
DROP FUNCTION IF EXISTS public.portal_voluntariar_substituicao(UUID);

CREATE FUNCTION public.portal_voluntariar_substituicao(p_substituicao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id         UUID := auth.uid();
  v_membro_id       UUID;
  v_paroquia_id     UUID;
  v_subst_ativa     BOOLEAN;
  v_status          TEXT;
  v_solicitante     UUID;
  v_substituto_prev UUID;
  v_ministerio_id   UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'membro_not_found'); END IF;

  SELECT COALESCE(substituicao_ativa, false) INTO v_subst_ativa
  FROM public.paroquia_config_escalas WHERE paroquia_id = v_paroquia_id;

  IF NOT v_subst_ativa THEN RETURN jsonb_build_object('success', false, 'error', 'substituicao_desativada'); END IF;

  SELECT s.status, s.solicitante_id, s.substituto_id, em.ministerio_id
    INTO v_status, v_solicitante, v_substituto_prev, v_ministerio_id
  FROM public.substituicoes s
  JOIN public.escala_membros em ON em.id = s.escala_membro_id
  WHERE s.id = p_substituicao_id AND s.paroquia_id = v_paroquia_id;

  IF NOT FOUND OR v_status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel');
  END IF;

  IF v_solicitante = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  -- Garante que o voluntário pertence ao mesmo ministério da vaga
  IF v_ministerio_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.membro_ministerios
      WHERE membro_id = v_membro_id AND ministerio_id = v_ministerio_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ministerio_incompativel');
    END IF;
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id, updated_at = now()
  WHERE id = p_substituicao_id;

  -- Notifica voluntário anterior deslocado (se houver)
  IF v_substituto_prev IS NOT NULL AND v_substituto_prev <> v_membro_id THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id)
    VALUES (
      v_paroquia_id,
      'Candidatura encerrada',
      'Outro membro se candidatou à mesma vaga de substituição. Sua candidatura não está mais ativa.',
      'alerta', false, false, v_substituto_prev
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;

-- ── 5. coord_aprovar_substituicao — filtra paróquia antes da permissão ───────
CREATE OR REPLACE FUNCTION public.coord_aprovar_substituicao(p_substituicao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_coord_id   UUID;
  v_coord_par  UUID;
  v_subst      public.substituicoes%ROWTYPE;
  v_em         public.escala_membros%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Carrega coordenador e sua paróquia em uma única query
  SELECT id, paroquia_id INTO v_coord_id, v_coord_par
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  -- Filtra pela paróquia do coordenador antes de qualquer verificação
  -- Isso impede information-disclosure (distinguir UUID válido de inválido cross-paróquia)
  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_coord_par;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_subst.paroquia_id)
    OR public._portal_is_admin(v_subst.paroquia_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status <> 'com_voluntario' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_sem_voluntario', 'status', v_subst.status);
  END IF;

  IF v_subst.substituto_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_substituto');
  END IF;

  SELECT * INTO v_em FROM public.escala_membros WHERE id = v_subst.escala_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  UPDATE public.escala_membros
  SET membro_id = v_subst.substituto_id, status = 'confirmado'
  WHERE id = v_subst.escala_membro_id;

  UPDATE public.substituicoes
  SET status = 'aprovada', aprovado_por = v_coord_id, aprovado_em = now()
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'aprovada', v_coord_id,
    jsonb_build_object(
      'membro_original', v_em.membro_id,
      'substituto', v_subst.substituto_id,
      'escala_membro_id', v_subst.escala_membro_id
    ));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_aprovar_substituicao(UUID) TO authenticated;
