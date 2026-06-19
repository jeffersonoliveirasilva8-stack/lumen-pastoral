-- migration 053 — Correções múltiplas
-- 1. Fix: updated_at inexistente em escala_membros (RPCs de 051)
-- 2. Fix: pontuação não deve ser concedida ao status 'confirmado' (membro se auto-confirma)
-- 3. Fix: sincronizar membros.tipo_acesso → user_roles para coordenadores/auxiliares/admins
-- 4. Fix: executar sincronização retroativa para membros já com tipo_acesso definido

-- ─────────────────────────────────────────────────────────────────
-- 1. Recriar portal_recusar_escala sem updated_at em escala_membros
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_escala_id   UUID;
  v_subst_id    UUID;
  v_regras      JSONB;
  v_prazo_dias  INTEGER;
  v_escala_data DATE;
BEGIN
  v_membro_id := public._portal_membro_id();

  SELECT em.paroquia_id, em.escala_id, e.data, e.paroquia_id
  INTO v_paroquia_id, v_escala_id, v_escala_data, v_paroquia_id
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_encontrada');
  END IF;

  IF v_escala_data < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  -- Verifica se confirmação está ativa
  SELECT regras_escala INTO v_regras
  FROM public.paroquias WHERE id = v_paroquia_id;

  IF NOT (v_regras->>'confirmacao_escala_ativa')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'confirmacao_desativada');
  END IF;

  -- Verifica prazo
  v_prazo_dias := COALESCE((v_regras->>'prazo_recusa_dias')::integer, 0);
  IF v_prazo_dias > 0 AND v_escala_data - CURRENT_DATE < v_prazo_dias THEN
    RETURN jsonb_build_object('success', false, 'error', 'prazo_expirado');
  END IF;

  -- Verifica se já tem substituição ativa
  IF EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_ja_ativa');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  -- Motivo obrigatório
  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  -- Atualiza status para recusado (SEM updated_at — coluna não existe)
  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = p_motivo
  WHERE id = p_escala_membro_id;

  -- Cria solicitação de substituição
  INSERT INTO public.substituicoes (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status)
  VALUES (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id, p_motivo, 'solicitada')
  RETURNING id INTO v_subst_id;

  -- Notifica coordenação
  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  SELECT v_paroquia_id,
    'Recusa de escala registrada',
    format('%s recusou a escala "%s". Uma substituição foi aberta.',
      (SELECT nome FROM public.membros WHERE id = v_membro_id),
      (SELECT titulo FROM public.escalas WHERE id = v_escala_id)),
    'aviso', false, true, '/substituicoes'
  WHERE v_paroquia_id IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Recriar portal_voluntariar_substituicao sem updated_at em substituicoes
-- (substituicoes tem updated_at, então só o de escala_membros era o bug)
-- ─────────────────────────────────────────────────────────────────
-- (portal_voluntariar_substituicao atualiza substituicoes.updated_at que existe — sem mudança)

-- ─────────────────────────────────────────────────────────────────
-- 2. Fix pontuação: remover 'confirmado' e 'recusado' dos status que geram pontos
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._get_pontos_status(
  p_paroquia_id UUID,
  p_status      TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'presente'   THEN COALESCE((SELECT pontuacao_presenca   FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id    UUID;
  v_escala_data    DATE;
  v_config         public.paroquia_config_escalas%ROWTYPE;
  v_pontos         INTEGER;
  -- Somente status registrados pelo administrador (não auto-confirmação do membro)
  v_status_final   CONSTANT TEXT[] := ARRAY['presente','faltou','ausente','atrasado','justificou'];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status);

  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, presenca, data, pontos)
  VALUES (
    v_paroquia_id,
    NEW.membro_id,
    NEW.escala_id,
    NEW.ministerio_id,
    NEW.status,
    v_escala_data,
    v_pontos
  )
  ON CONFLICT (membro_id, escala_id, ministerio_id) DO UPDATE
    SET presenca = EXCLUDED.presenca,
        pontos   = EXCLUDED.pontos;

  UPDATE public.membros
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = NEW.membro_id
  )
  WHERE id = NEW.membro_id;

  RETURN NEW;
END;
$$;

-- Recria o trigger para garantir que usa a versão corrigida
DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;
CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- Remove pontos indevidos gerados por status 'confirmado' e 'recusado'
DELETE FROM public.historico_participacoes
WHERE presenca IN ('confirmado', 'recusado');

-- Recalcula scores após limpeza
UPDATE public.membros m
SET score = COALESCE((
  SELECT SUM(hp.pontos) FROM public.historico_participacoes hp
  WHERE hp.membro_id = m.id
), 0)
WHERE EXISTS (SELECT 1 FROM public.historico_participacoes WHERE membro_id = m.id)
   OR m.score != 0;

-- ─────────────────────────────────────────────────────────────────
-- 3. Sincronizar membros.tipo_acesso → user_roles
-- ─────────────────────────────────────────────────────────────────
-- Mapeia tipo_acesso → user_roles.role
-- 'admin'       → 'admin'
-- 'coordenador' → 'coordenador'
-- 'auxiliar'    → 'auxiliar'
-- 'membro'      → remove de user_roles (mantém apenas o membro básico)

CREATE OR REPLACE FUNCTION public._sync_tipo_acesso_to_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_user_id UUID;
BEGIN
  -- Só processa se tipo_acesso mudou
  IF TG_OP = 'UPDATE' AND NEW.tipo_acesso = OLD.tipo_acesso THEN
    RETURN NEW;
  END IF;

  -- Pega o auth user_id do membro
  v_user_id := NEW.auth_user_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  -- Mapeia tipo_acesso para role
  v_role := CASE NEW.tipo_acesso
    WHEN 'admin'       THEN 'admin'
    WHEN 'coordenador' THEN 'coordenador'
    WHEN 'auxiliar'    THEN 'auxiliar'
    ELSE NULL
  END;

  IF v_role IS NOT NULL THEN
    -- Remove roles elevados anteriores e insere o novo
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND paroquia_id = NEW.paroquia_id
      AND role IN ('admin', 'coordenador', 'auxiliar');

    INSERT INTO public.user_roles (user_id, paroquia_id, role)
    VALUES (v_user_id, NEW.paroquia_id, v_role)
    ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
  ELSE
    -- tipo_acesso = 'membro' → remove roles elevados
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND paroquia_id = NEW.paroquia_id
      AND role IN ('admin', 'coordenador', 'auxiliar');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
CREATE TRIGGER sync_tipo_acesso_user_roles
  AFTER INSERT OR UPDATE OF tipo_acesso ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public._sync_tipo_acesso_to_user_roles();

-- ─────────────────────────────────────────────────────────────────
-- 4. Sincronização retroativa — feita corretamente na migration 054
-- (esta seção foi esvaziada para evitar erro de enum app_role)
-- ─────────────────────────────────────────────────────────────────
SELECT 1;
