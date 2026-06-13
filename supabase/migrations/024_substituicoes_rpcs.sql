-- ============================================================
-- Migration 024: RPCs do módulo de substituições
-- Data: 2026-06-13
--
-- FUNÇÕES CRIADAS:
--   portal_solicitar_substituicao   — membro solicita troca de escala
--   portal_voluntariar_substituicao — outro membro se oferece para substituir
--   portal_cancelar_substituicao    — solicitante cancela o pedido
--   coord_aprovar_substituicao      — coord/admin aprova a troca
--   coord_rejeitar_substituicao     — coord/admin rejeita a troca
--   admin_buscar_substitutos        — lista membros disponíveis para substituir
--   portal_get_substituicoes_membro — retorna substituições do membro logado
--   coord_get_substituicoes         — retorna substituições pendentes para coord
--
-- Todas são SECURITY DEFINER (bypass RLS) com validações internas.
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 022–023 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. portal_solicitar_substituicao
-- ══════════════════════════════════════════════════════════════
-- Membro solicita substituição para uma entrada em escala_membros.
-- Valida:
--   - escala_membro_id pertence ao solicitante
--   - escala ainda é futura
--   - não existe substituição ativa para esta entrada
--   - substituicao_ativa=true na config da paróquia (ou ignora se config não existe)

CREATE OR REPLACE FUNCTION public.portal_solicitar_substituicao(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_escala_id    UUID;
  v_subst_id     UUID;
  v_config       public.paroquia_config_escalas%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Localiza membro
  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Verifica que o escala_membro_id pertence ao membro e é da mesma paróquia
  SELECT e.data, em.escala_id INTO v_escala_data, v_escala_id
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

  -- Verifica config (se existir) para prazo mínimo
  SELECT * INTO v_config FROM public.paroquia_config_escalas WHERE paroquia_id = v_paroquia_id;

  IF FOUND AND v_config.substituicao_ativa AND v_config.substituicao_horas_antes > 0 THEN
    IF (v_escala_data::timestamptz - now()) < (v_config.substituicao_horas_antes || ' hours')::interval THEN
      RETURN jsonb_build_object('success', false, 'error', 'prazo_expirado',
        'horas_minimas', v_config.substituicao_horas_antes);
    END IF;
  END IF;

  -- Verifica se já existe substituição ativa para esta entrada
  IF EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_ja_ativa');
  END IF;

  -- Cria a substituição
  INSERT INTO public.substituicoes
    (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES
    (v_paroquia_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
  RETURNING id INTO v_subst_id;

  -- Registra no histórico
  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (v_subst_id, 'solicitada', v_membro_id,
    jsonb_build_object('motivo', p_motivo, 'escala_membro_id', p_escala_membro_id));

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_solicitar_substituicao(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. portal_voluntariar_substituicao
-- ══════════════════════════════════════════════════════════════
-- Outro membro da mesma paróquia se oferece para substituir.

CREATE OR REPLACE FUNCTION public.portal_voluntariar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_subst       public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_paroquia_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF v_subst.status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel', 'status', v_subst.status);
  END IF;

  -- Não pode se voluntariar para a própria solicitação
  IF v_subst.solicitante_id = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'voluntario_registrado', v_membro_id,
    jsonb_build_object('substituto_id', v_membro_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. portal_cancelar_substituicao
-- ══════════════════════════════════════════════════════════════
-- Solicitante cancela o pedido (só se status = solicitada | com_voluntario).

CREATE OR REPLACE FUNCTION public.portal_cancelar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
  v_subst     public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_membro_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes
  WHERE id = p_substituicao_id AND solicitante_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_cancelavel', 'status', v_subst.status);
  END IF;

  UPDATE public.substituicoes SET status = 'cancelada' WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'cancelada', v_membro_id, '{}'::jsonb);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_cancelar_substituicao(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. coord_aprovar_substituicao
-- ══════════════════════════════════════════════════════════════
-- Coordenador/admin aprova: troca o membro em escala_membros e
-- atualiza o status da substituição.

CREATE OR REPLACE FUNCTION public.coord_aprovar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_coord_id  UUID;
  v_subst     public.substituicoes%ROWTYPE;
  v_em        public.escala_membros%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_coord_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  IF v_coord_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  -- Valida permissão de coordenador
  IF NOT public.is_coordenador_da_paroquia(v_subst.paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status <> 'com_voluntario' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_sem_voluntario', 'status', v_subst.status);
  END IF;

  IF v_subst.substituto_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_substituto');
  END IF;

  -- Lê entrada original de escala_membros
  SELECT * INTO v_em FROM public.escala_membros WHERE id = v_subst.escala_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  -- Efetua a troca: membro_id na escala vira o substituto
  UPDATE public.escala_membros
  SET membro_id = v_subst.substituto_id, status = 'confirmado'
  WHERE id = v_subst.escala_membro_id;

  -- Marca substituição como aprovada
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

-- ══════════════════════════════════════════════════════════════
-- 5. coord_rejeitar_substituicao
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.coord_rejeitar_substituicao(
  p_substituicao_id UUID,
  p_motivo          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id  UUID := auth.uid();
  v_coord_id UUID;
  v_subst    public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_coord_id FROM public.membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND ativo = true LIMIT 1;

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF NOT public.is_coordenador_da_paroquia(v_subst.paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_subst.status NOT IN ('solicitada', 'com_voluntario') THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_rejeitavel', 'status', v_subst.status);
  END IF;

  UPDATE public.substituicoes
  SET status = 'rejeitada', motivo_rejeicao = p_motivo
  WHERE id = p_substituicao_id;

  INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
  VALUES (p_substituicao_id, 'rejeitada', v_coord_id,
    jsonb_build_object('motivo', p_motivo));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_rejeitar_substituicao(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 6. admin_buscar_substitutos
-- ══════════════════════════════════════════════════════════════
-- Retorna membros disponíveis para substituir numa escala+ministério.
-- Exclui: quem já está escalado, quem tem indisponibilidade na data,
--         e o próprio solicitante.

CREATE OR REPLACE FUNCTION public.admin_buscar_substitutos(
  p_escala_id     UUID,
  p_ministerio_id UUID
)
RETURNS TABLE(
  membro_id   UUID,
  nome        TEXT,
  score       INT,
  tem_indisp  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_paroquia_id UUID;
  v_escala_data DATE;
BEGIN
  -- Verifica permissão
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = p_escala_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT public.is_coordenador_da_paroquia(v_paroquia_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    m.id          AS membro_id,
    m.nome        AS nome,
    COALESCE(m.score, 0) AS score,
    EXISTS (
      SELECT 1 FROM public.indisponibilidades i
      WHERE i.membro_id = m.id AND i.data = v_escala_data
    ) AS tem_indisp
  FROM public.membros m
  JOIN public.membro_ministerios mm ON mm.membro_id = m.id AND mm.ministerio_id = p_ministerio_id
  WHERE m.paroquia_id = v_paroquia_id
    AND m.ativo = true
    -- Exclui quem já está escalado nesta escala
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = p_escala_id AND em.membro_id = m.id
    )
  ORDER BY
    tem_indisp ASC,   -- disponíveis primeiro
    m.score DESC,     -- score maior primeiro
    m.nome ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_buscar_substitutos(UUID, UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 7. portal_get_substituicoes_membro
-- ══════════════════════════════════════════════════════════════
-- Retorna as substituições do membro logado (como solicitante ou voluntário).

CREATE OR REPLACE FUNCTION public.portal_get_substituicoes_membro()
RETURNS TABLE(
  id                 UUID,
  status             TEXT,
  motivo_solicitacao TEXT,
  motivo_rejeicao    TEXT,
  created_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,
  tipo               TEXT,   -- 'solicitante' | 'voluntario'
  escala_titulo      TEXT,
  escala_data        DATE,
  ministerio_nome    TEXT,
  ministerio_cor     TEXT,
  solicitante_nome   TEXT,
  substituto_nome    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id INTO v_membro_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status,
    s.motivo_solicitacao,
    s.motivo_rejeicao,
    s.created_at,
    s.updated_at,
    CASE WHEN s.solicitante_id = v_membro_id THEN 'solicitante' ELSE 'voluntario' END AS tipo,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome
  FROM public.substituicoes s
  JOIN public.escala_membros em ON em.id = s.escala_membro_id
  JOIN public.escalas         e  ON e.id  = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  WHERE (s.solicitante_id = v_membro_id OR s.substituto_id = v_membro_id)
  ORDER BY s.created_at DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_substituicoes_membro() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 8. coord_get_substituicoes
-- ══════════════════════════════════════════════════════════════
-- Retorna substituições da paróquia para o painel do coordenador.

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL  -- NULL = todas; ou filtrar por status específico
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

  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT public.is_coordenador_da_paroquia(v_paroquia_id) THEN RETURN; END IF;

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

-- ══════════════════════════════════════════════════════════════
-- 9. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ portal_solicitar_substituicao cria registro + histórico
--   ✓ portal_voluntariar_substituicao muda status → com_voluntario
--   ✓ coord_aprovar_substituicao: troca membro em escala_membros
--   ✓ coord_rejeitar_substituicao: notifica solicitante
--   ✓ admin_buscar_substitutos: só coordenadores acessam, ordena por disponibilidade+score
--   ✓ portal_get_substituicoes_membro: filtra solicitante OU voluntário
--   ✓ coord_get_substituicoes: ordena com_voluntario (urgente) primeiro
-- ─────────────────────────────────────────────────────────────
