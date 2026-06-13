-- ============================================================
-- Migration 026: Sistema de pontuação automática
-- Data: 2026-06-13
--
-- OBJETIVO:
--   Quando o status de um membro em escala_membros muda para um
--   valor final (presente, faltou, atrasado, justificou, ausente),
--   e a paróquia tem auto_pontuar=true em paroquia_config_escalas:
--   1. Registra (ou atualiza) em historico_participacoes
--   2. Recalcula e atualiza membros.score
--
-- TRIGGER: on_escala_membro_status_final
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 022–025 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. Helper — _get_pontos_status
-- ══════════════════════════════════════════════════════════════
-- Retorna os pontos para um dado status a partir da config da paróquia.
-- Usa valores-padrão se a config não existir.

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
    WHEN 'confirmado' THEN COALESCE((SELECT pontuacao_presenca   FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    WHEN 'recusado'   THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    ELSE 0
  END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. Trigger function — _trigger_pontuar_participacao
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id    UUID;
  v_escala_data    DATE;
  v_config         public.paroquia_config_escalas%ROWTYPE;
  v_pontos         INTEGER;
  v_status_final   CONSTANT TEXT[] := ARRAY['presente','confirmado','faltou','ausente','atrasado','justificou','recusado'];
BEGIN
  -- Só processa mudanças de status para valores finais
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  -- Obtém paroquia_id e data da escala
  SELECT e.paroquia_id, e.data INTO v_paroquia_id, v_escala_data
  FROM public.escalas e WHERE e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  -- Verifica se a paróquia tem auto_pontuar ativo
  SELECT * INTO v_config
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  -- Calcula pontos
  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status);

  -- Upsert em historico_participacoes
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

  -- Recalcula score total do membro
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

DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- ══════════════════════════════════════════════════════════════
-- 3. RPC — admin_recalcular_scores_paroquia
-- ══════════════════════════════════════════════════════════════
-- Utilitário para recalcular todos os scores de uma paróquia
-- (útil ao ativar auto_pontuar pela primeira vez).

CREATE OR REPLACE FUNCTION public.admin_recalcular_scores_paroquia(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id UUID := auth.uid();
  v_count   INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public._portal_is_admin(p_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  UPDATE public.membros m
  SET score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM public.historico_participacoes hp
    WHERE hp.membro_id = m.id
  )
  WHERE m.paroquia_id = p_paroquia_id AND m.ativo = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'membros_atualizados', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recalcular_scores_paroquia(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Mudar status para "presente" → +1pt (padrão), score atualizado
--   ✓ Mudar status para "faltou"   → -2pts (padrão), score atualizado
--   ✓ Mudar status para "atrasado" → -1pt (padrão), score atualizado
--   ✓ Mudar status para "justificou" → 0pts, registrado sem penalidade
--   ✓ Se auto_pontuar=false, nenhuma alteração de score ocorre
--   ✓ admin_recalcular_scores_paroquia recalcula todos os membros
-- ─────────────────────────────────────────────────────────────
