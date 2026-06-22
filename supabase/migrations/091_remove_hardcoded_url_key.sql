-- Migration 091 — Remover URL e anon key hardcoded das RPCs
--
-- Problema: migrations 071–076 tinham a URL do projeto Supabase e a anon key
-- embutidas literalmente em três funções PL/pgSQL. Qualquer rotação de chave
-- ou migração de projeto exigia reescrever essas funções manualmente.
--
-- Solução: current_setting('app.*', true) com COALESCE para fallback.
-- As funções continuam funcionando mesmo sem o ALTER DATABASE — o fallback
-- garante retrocompatibilidade. Quando quiser rotacionar a chave, basta
-- executar uma vez no SQL Editor:
--
--   ALTER DATABASE postgres
--     SET "app.supabase_url" = 'https://SEU_PROJETO.supabase.co';
--   ALTER DATABASE postgres
--     SET "app.anon_key"     = 'eyJhbGci...';
--   SELECT pg_reload_conf();
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- AFETA: portal_recusar_escala, portal_solicitar_substituicao,
--        coord_reenviar_notificacao_substituicao

-- ── Constantes compartilhadas (função auxiliar privada) ──────────────────────

CREATE OR REPLACE FUNCTION public._edge_fn_url(p_fn TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(trim(current_setting('app.supabase_url', true)), ''),
    'https://cusuoggmlhtvrclrzvfr.supabase.co'
  ) || '/functions/v1/' || p_fn;
$$;

REVOKE ALL ON FUNCTION public._edge_fn_url(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._edge_fn_url(TEXT) TO postgres;

-- ── 1. portal_recusar_escala ─────────────────────────────────────────────────

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
  v_token         UUID;
  v_anon_key      TEXT;
  v_fn_url        TEXT;
BEGIN
  -- Lê configurações dinâmicas (fallback para os valores originais)
  v_anon_key := COALESCE(
    NULLIF(trim(current_setting('app.anon_key', true)), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
  );
  v_fn_url := public._edge_fn_url('notificar-substituicao');

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
        'aviso', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    INSERT INTO public.notificacao_tokens (substituicao_id)
    VALUES (v_subst_id)
    RETURNING token INTO v_token;

    BEGIN
      PERFORM net.http_post(
        url     := v_fn_url,
        headers := jsonb_build_object(
          'Content-Type',     'application/json',
          'Authorization',    'Bearer ' || v_anon_key,
          'X-One-Time-Token', v_token::TEXT
        ),
        body := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ── 2. portal_solicitar_substituicao ─────────────────────────────────────────

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
  v_token         UUID;
  v_anon_key      TEXT;
  v_fn_url        TEXT;
BEGIN
  v_anon_key := COALESCE(
    NULLIF(trim(current_setting('app.anon_key', true)), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
  );
  v_fn_url := public._edge_fn_url('notificar-substituicao');

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
        'aviso', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    INSERT INTO public.notificacao_tokens (substituicao_id)
    VALUES (v_subst_id)
    RETURNING token INTO v_token;

    BEGIN
      PERFORM net.http_post(
        url     := v_fn_url,
        headers := jsonb_build_object(
          'Content-Type',     'application/json',
          'Authorization',    'Bearer ' || v_anon_key,
          'X-One-Time-Token', v_token::TEXT
        ),
        body := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;

-- ── 3. coord_reenviar_notificacao_substituicao ───────────────────────────────

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
  v_anon_key    TEXT;
  v_fn_url      TEXT;
BEGIN
  v_anon_key := COALESCE(
    NULLIF(trim(current_setting('app.anon_key', true)), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I'
  );
  v_fn_url := public._edge_fn_url('notificar-substituicao');

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT ur.paroquia_id INTO v_paroquia_id
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.role IN ('super_admin', 'admin_paroquial', 'lider')
  LIMIT 1;
  IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT m.paroquia_id INTO v_paroquia_id
    FROM public.membros m
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'coordenador', 'administrador')
    LIMIT 1;
    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT c.paroquia_id INTO v_paroquia_id
    FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND c.ativo = true
    LIMIT 1;
    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  IF NOT v_is_allowed OR v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  SELECT s.status INTO v_status
  FROM public.substituicoes s
  WHERE s.id = p_substituicao_id AND s.paroquia_id = v_paroquia_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_encontrada');
  END IF;

  IF v_status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  INSERT INTO public.notificacao_tokens (substituicao_id)
  VALUES (p_substituicao_id)
  RETURNING token INTO v_token;

  BEGIN
    PERFORM net.http_post(
      url     := v_fn_url,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'Authorization',    'Bearer ' || v_anon_key,
        'X-One-Time-Token', v_token::TEXT
      ),
      body := jsonb_build_object('substituicao_id', p_substituicao_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_reenviar_notificacao_substituicao(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
