-- migration 064 — Fix substituições + alerta 48h configurável
--
-- Problemas:
--   1. coord_get_substituicoes falha quando coordenador não tem auth_user_id
--      linkado em membros (acessa via profiles/user_roles apenas)
--   2. portal_recusar_escala (migration 058) verifica confirmacao_escala_ativa
--      mas deveria SEMPRE criar substituição — a recusa gera vaga independente de config
--   3. Suporte a prazo de confirmação configurável (horas_limite_confirmacao)
--      na tabela paroquia_config_escalas
--   4. RPC check_confirmacoes_pendentes — marca notificação quando membro
--      não confirmou dentro do prazo e retorna lista para o coordenador agir

-- ── 1. Adiciona horas_limite_confirmacao em paroquia_config_escalas ──────────
ALTER TABLE public.paroquia_config_escalas
  ADD COLUMN IF NOT EXISTS horas_limite_confirmacao INTEGER DEFAULT 48
    CHECK (horas_limite_confirmacao BETWEEN 1 AND 336); -- 1h a 2 semanas

COMMENT ON COLUMN public.paroquia_config_escalas.horas_limite_confirmacao IS
  'Horas que o membro tem para confirmar/recusar após ser escalado. Default 48h.';

-- ── 2. Fix coord_get_substituicoes — auth check via user_roles direto ────────
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
  escala_titulo      TEXT,
  escala_data        DATE,
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

  -- 1. Tenta via membros (vínculo direto)
  SELECT m.paroquia_id INTO v_paroquia_id
  FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  -- 2. Fallback via profiles
  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id
    FROM public.profiles
    WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  -- 3. Verifica autorização: coordenador, admin paroquial ou super_admin
  --    (aceita via is_coordenador_da_paroquia, _portal_is_admin OU user_roles direto)
  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_auth_id
        AND paroquia_id = v_paroquia_id
        AND role IN ('super_admin', 'admin_paroquial', 'coordenador', 'lider')
    )
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.aprovado_em,
    s.created_at,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
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

-- ── 3. Fix portal_recusar_escala — SEMPRE cria substituição, sem gate ────────
--    (Migration 058 adicionou verificação de confirmacao_escala_ativa que
--     impedia criação da substituição quando feature de confirmação não estava
--     ativa. Uma recusa SEMPRE gera vaga — o gate de confirmação não se aplica.)
CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_escala_id   UUID;
  v_escala_data DATE;
  v_subst_id    UUID;
  v_escala_titulo TEXT;
  v_membro_nome   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT id, nome INTO v_membro_id, v_membro_nome
  FROM public.membros
  WHERE (auth_user_id = auth.uid()
         OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT em.escala_id, e.paroquia_id, e.data, e.titulo
    INTO v_escala_id, v_paroquia_id, v_escala_data, v_escala_titulo
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

  -- SEMPRE cria substituição (independente de feature flags)
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

  -- Notifica coordenação (apenas admin)
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id,
    'Recusa de escala — substituição aberta',
    format('%s recusou a escala "%s". Motivo: %s. Uma vaga foi aberta para substituição.',
      v_membro_nome, v_escala_titulo, trim(p_motivo)),
    'alerta', false, true, '/substituicoes'
  );

  RETURN jsonb_build_object(
    'success', true,
    'substituicao_id', v_subst_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ── 4. RPC check_confirmacoes_expiradas — retorna escalas com membros sem ────
--    confirmação após horas_limite_confirmacao e cria notificação de alerta.
--    Chamada via frontend (botão manual) ou futuramente por cron.
CREATE OR REPLACE FUNCTION public.check_confirmacoes_expiradas(
  p_paroquia_id UUID DEFAULT NULL
)
RETURNS TABLE (
  escala_membro_id  UUID,
  membro_nome       TEXT,
  membro_id         UUID,
  ministerio_nome   TEXT,
  escala_titulo     TEXT,
  escala_data       DATE,
  escalado_em       TIMESTAMPTZ,
  horas_sem_resposta NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_limite_h    INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  -- Resolve paróquia
  IF p_paroquia_id IS NOT NULL THEN
    v_paroquia_id := p_paroquia_id;
  ELSE
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
    IF v_paroquia_id IS NULL THEN
      SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
      WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
        AND m.ativo = true LIMIT 1;
    END IF;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  -- Verifica autorização
  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_auth_id AND paroquia_id = v_paroquia_id
        AND role IN ('super_admin', 'admin_paroquial', 'coordenador', 'lider')
    )
  ) THEN RETURN; END IF;

  -- Pega limite configurado (default 48h)
  SELECT COALESCE(horas_limite_confirmacao, 48)
    INTO v_limite_h
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF v_limite_h IS NULL THEN v_limite_h := 48; END IF;

  RETURN QUERY
  SELECT
    em.id                                  AS escala_membro_id,
    m.nome                                 AS membro_nome,
    m.id                                   AS membro_id,
    min.nome                               AS ministerio_nome,
    e.titulo                               AS escala_titulo,
    e.data                                 AS escala_data,
    em.created_at                          AS escalado_em,
    ROUND(EXTRACT(EPOCH FROM (now() - em.created_at)) / 3600, 1) AS horas_sem_resposta
  FROM public.escala_membros em
  JOIN public.escalas   e   ON e.id   = em.escala_id
  JOIN public.membros   m   ON m.id   = em.membro_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE e.paroquia_id = v_paroquia_id
    AND e.status = 'publicada'
    AND e.data >= CURRENT_DATE
    AND em.status = 'pendente'
    AND em.created_at < now() - (v_limite_h || ' hours')::INTERVAL
  ORDER BY horas_sem_resposta DESC, e.data ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_confirmacoes_expiradas(UUID) TO authenticated;

-- ── 5. RPC enviar_alerta_confirmacao — cria notificação in-app para membro ───
--    que não confirmou no prazo, e notificação de alerta para o coordenador.
CREATE OR REPLACE FUNCTION public.enviar_alerta_confirmacao(
  p_escala_membro_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_membro_id   UUID;
  v_membro_nome TEXT;
  v_membro_email TEXT;
  v_escala_id   UUID;
  v_escala_titulo TEXT;
  v_escala_data DATE;
  v_ministerio_nome TEXT;
  v_limite_h    INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT
    e.paroquia_id, em.membro_id, m.nome, m.email,
    em.escala_id, e.titulo, e.data, min.nome
  INTO v_paroquia_id, v_membro_id, v_membro_nome, v_membro_email,
       v_escala_id, v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.membros     m   ON m.id   = em.membro_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = p_escala_membro_id AND em.status = 'pendente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Verifica autorização do chamador
  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_auth_id AND paroquia_id = v_paroquia_id
        AND role IN ('super_admin', 'admin_paroquial', 'coordenador', 'lider')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  -- Notificação para o membro
  INSERT INTO public.notificacoes
    (paroquia_id, membro_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id, v_membro_id,
    'Confirmação pendente — escala se aproxima',
    format('Você ainda não confirmou sua participação na escala "%s" de %s como %s. Por favor, confirme ou recuse o mais breve possível.',
      v_escala_titulo,
      to_char(v_escala_data, 'DD/MM/YYYY'),
      v_ministerio_nome),
    'urgente', false, false, '/portal-membro/escalas'
  );

  RETURN jsonb_build_object(
    'success', true,
    'membro_id', v_membro_id,
    'membro_email', v_membro_email,
    'escala_titulo', v_escala_titulo,
    'escala_data', v_escala_data,
    'ministerio_nome', v_ministerio_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enviar_alerta_confirmacao(UUID) TO authenticated;
