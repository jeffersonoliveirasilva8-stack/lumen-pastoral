-- ============================================================
-- Migration 029: Correção do fluxo completo de substituições
-- Data: 2026-06-13
--
-- PROBLEMAS CORRIGIDOS:
--
--   1. paroquia_config_escalas.substituicao_ativa vem false por default
--      → backfill para true em todas as paróquias
--      → default alterado para true
--
--   2. coord_get_substituicoes / coord_aprovar / coord_rejeitar /
--      admin_buscar_substitutos só permitem is_coordenador_da_paroquia
--      mas admins da paróquia usam user_roles (_portal_is_admin), não
--      membros.tipo_acesso → retorno vazio no painel admin
--      Fix: OR _portal_is_admin(paroquia_id) em todos os RPCs coord/admin
--
--   3. portal_recusar_escala cria substituição só se substituicao_ativa=true
--      → agora sempre cria (recusa gera substituição automaticamente)
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 001–028 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. BACKFILL: substituicao_ativa = true em todas as paróquias
-- ══════════════════════════════════════════════════════════════

-- Garante que todas as paróquias com config existente tenham substituicao=true
UPDATE public.paroquia_config_escalas
SET substituicao_ativa = true
WHERE substituicao_ativa = false;

-- Cria config para paróquias que ainda não têm (com defaults razoáveis)
INSERT INTO public.paroquia_config_escalas
  (paroquia_id, confirmacao_ativa, substituicao_ativa, auto_pontuar,
   pontuacao_presenca, pontuacao_falta, pontuacao_atraso, pontuacao_justificou)
SELECT
  p.id, true, true, true, 1, -2, -1, 0
FROM public.paroquias p
WHERE NOT EXISTS (
  SELECT 1 FROM public.paroquia_config_escalas c WHERE c.paroquia_id = p.id
)
ON CONFLICT (paroquia_id) DO NOTHING;

-- Muda default para true em inserções futuras
ALTER TABLE public.paroquia_config_escalas
  ALTER COLUMN substituicao_ativa SET DEFAULT true;

-- ══════════════════════════════════════════════════════════════
-- 2. portal_recusar_escala — SEMPRE cria substituição na recusa
-- ══════════════════════════════════════════════════════════════
-- Motivo: uma recusa SEMPRE gera uma vaga aberta, independente
-- de a feature de substituições estar ativada no painel.
-- A diferença é apenas visual (membro vê ou não o fluxo de
-- voluntariar), mas o registro deve existir para o admin.

CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_id    UUID;
  v_subst_id     UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Localiza o membro autenticado
  SELECT id INTO v_membro_id
  FROM public.membros
  WHERE (auth_user_id = auth.uid()
         OR lower(trim(coalesce(email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  -- Valida que o registro pertence a este membro
  SELECT escala_id INTO v_escala_id
  FROM public.escala_membros
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Verifica se pode recusar (status pendente ou confirmado)
  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Obtém paróquia
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = v_escala_id;

  -- Atualiza status para recusado
  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  -- SEMPRE cria substituição (recusa = vaga aberta para voluntário)
  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_membro_id, solicitante_id, motivo_solicitacao)
    VALUES
      (v_paroquia_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'))
    RETURNING id INTO v_subst_id;

    -- Registra no histórico
    INSERT INTO public.historico_substituicoes (substituicao_id, acao, actor_id, detalhes)
    VALUES (v_subst_id, 'solicitada', v_membro_id,
      jsonb_build_object('origem', 'recusa', 'motivo', p_motivo));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'substituicao_criada', v_subst_id IS NOT NULL,
    'substituicao_id', v_subst_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. coord_get_substituicoes — também permite _portal_is_admin
-- ══════════════════════════════════════════════════════════════

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

  SELECT m.paroquia_id INTO v_paroquia_id FROM public.membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
    AND m.ativo = true LIMIT 1;

  -- Fallback: pega paróquia via profiles se não encontrou por membros
  IF v_paroquia_id IS NULL THEN
    SELECT paroquia_id INTO v_paroquia_id FROM public.profiles WHERE id = v_auth_id;
  END IF;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  -- Aceita coordenadores OU admins da paróquia (via user_roles)
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
-- 4. coord_aprovar_substituicao — também permite _portal_is_admin
-- ══════════════════════════════════════════════════════════════

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

  SELECT * INTO v_subst FROM public.substituicoes WHERE id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  -- Aceita coordenadores OU admins da paróquia
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

  -- Efetua a troca
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

-- ══════════════════════════════════════════════════════════════
-- 5. coord_rejeitar_substituicao — também permite _portal_is_admin
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

  IF NOT (
    public.is_coordenador_da_paroquia(v_subst.paroquia_id)
    OR public._portal_is_admin(v_subst.paroquia_id)
  ) THEN
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
-- 6. admin_buscar_substitutos — também permite _portal_is_admin
-- ══════════════════════════════════════════════════════════════

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
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = p_escala_id;

  IF v_paroquia_id IS NULL THEN RETURN; END IF;

  IF NOT (
    public.is_coordenador_da_paroquia(v_paroquia_id)
    OR public._portal_is_admin(v_paroquia_id)
  ) THEN RETURN; END IF;

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
    AND NOT EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = p_escala_id AND em.membro_id = m.id
    )
  ORDER BY
    tem_indisp ASC,
    m.score DESC,
    m.nome ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_buscar_substitutos(UUID, UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 7. portal_solicitar_substituicao — também permite via admin quando
--    membro faz recusa (já coberto pelo portal_recusar_escala)
--    Mas garantimos que o membro consiga ver via portal_get_substituicoes_membro
-- ══════════════════════════════════════════════════════════════
-- Nenhuma mudança necessária aqui — o problema era só no coord_get.

-- ══════════════════════════════════════════════════════════════
-- 8. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIOS DE APROVAÇÃO:
--   ✓ substituicao_ativa = true em todas as paróquias
--   ✓ Recusa via portal_recusar_escala SEMPRE cria substituição
--   ✓ Admin (via user_roles) consegue ver substituições no coord_get_substituicoes
--   ✓ Admin consegue aprovar/rejeitar substituições
--   ✓ Admin consegue buscar substitutos
-- ─────────────────────────────────────────────────────────────
