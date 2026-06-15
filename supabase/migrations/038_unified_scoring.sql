-- ============================================================
-- Migration 038: Arquitetura unificada de pontuação
-- Data: 2026-06-15
--
-- OBJETIVO:
--   Unificar os dois caminhos independentes que alteravam
--   membros.score (escalas via trigger SQL + formações via
--   TypeScript direto) em um único caminho canônico:
--
--     QUALQUER evento pontuável → historico_participacoes
--     → trigger on_historico_score_recalc → membros.score
--
-- MUDANÇAS:
--   1. historico_participacoes: escala_id/ministerio_id nullable,
--      novos campos tipo_evento / origem / referencia_id / descricao
--   2. paroquia_config_escalas: campos de pontuação para todos
--      os tipos de evento (solene, bispo, formação, reunião…)
--   3. _get_pontos_status: parâmetros solene/bispo
--   4. _get_pontos_tipo_evento: nova função para agenda pastoral
--   5. _trigger_pontuar_participacao: usa solene/bispo, remove
--      UPDATE membros direto (delegado ao novo trigger)
--   6. on_historico_score_recalc: trigger ÚNICO de recálculo
--   7. marcar_presenca_evento: RPC atômica para agenda pastoral
--   8. Migração de dados: presencas_eventos → historico
--   9. Recálculo completo de scores
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE, ALTER ... IF NOT EXISTS,
--              DROP IF EXISTS, ON CONFLICT ... DO NOTHING)
-- REQUER: migrations 001–037 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. EXPANDIR historico_participacoes
-- ══════════════════════════════════════════════════════════════

-- 1a. Tornar escala_id e ministerio_id nullable para eventos
--     que não são de escala de missa.
ALTER TABLE public.historico_participacoes
  ALTER COLUMN escala_id     DROP NOT NULL,
  ALTER COLUMN ministerio_id DROP NOT NULL;

-- 1b. Novos campos para identificar origem e tipo do evento.
ALTER TABLE public.historico_participacoes
  ADD COLUMN IF NOT EXISTS tipo_evento   TEXT NOT NULL DEFAULT 'escala',
  ADD COLUMN IF NOT EXISTS origem        TEXT,
  ADD COLUMN IF NOT EXISTS referencia_id UUID,
  ADD COLUMN IF NOT EXISTS descricao     TEXT;

-- 1c. Substituir a constraint UNIQUE antiga por dois índices
--     parciais (um para escalas, um para eventos de agenda).
ALTER TABLE public.historico_participacoes
  DROP CONSTRAINT IF EXISTS historico_participacoes_membro_id_escala_id_ministerio_id_key;

-- Índice para escalas de missa (escala_id + ministerio_id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hist_escala
  ON public.historico_participacoes(membro_id, escala_id, ministerio_id)
  WHERE tipo_evento = 'escala'
    AND escala_id    IS NOT NULL
    AND ministerio_id IS NOT NULL;

-- Índice para eventos de agenda (referencia_id = formacoes_eventos.id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hist_evento
  ON public.historico_participacoes(membro_id, referencia_id)
  WHERE referencia_id IS NOT NULL
    AND tipo_evento   <> 'escala';

-- 1d. Marcar registros históricos existentes como origem 'escala'.
UPDATE public.historico_participacoes
SET    tipo_evento = 'escala',
       origem      = 'escala'
WHERE  tipo_evento = 'escala'   -- idempotente (default já é 'escala')
  AND  origem IS NULL;

-- ══════════════════════════════════════════════════════════════
-- 2. EXPANDIR paroquia_config_escalas
-- ══════════════════════════════════════════════════════════════
-- Adiciona pontuação configurável para todos os tipos de evento
-- que o sistema suporta. Defaults espelham os valores anteriores
-- implícitos no código TypeScript.

ALTER TABLE public.paroquia_config_escalas
  -- Escalas de missa: distinção por solenidade
  ADD COLUMN IF NOT EXISTS pontuacao_presenca_solene      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pontuacao_presenca_bispo       INTEGER NOT NULL DEFAULT 5,
  -- Agenda pastoral
  ADD COLUMN IF NOT EXISTS pontuacao_formacao             INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pontuacao_reuniao              INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pontuacao_retiro               INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pontuacao_adoracao             INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pontuacao_ensaio               INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pontuacao_encontro             INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pontuacao_compromisso          INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pontuacao_evento               INTEGER NOT NULL DEFAULT 3,
  -- Penalidades
  ADD COLUMN IF NOT EXISTS pontuacao_ocorrencia_grave     INTEGER NOT NULL DEFAULT -10,
  -- Substituições
  ADD COLUMN IF NOT EXISTS pontuacao_substituicao_aceita  INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pontuacao_substituicao_recusada INTEGER NOT NULL DEFAULT -1;

-- ══════════════════════════════════════════════════════════════
-- 3. HELPER — _get_pontos_status (atualizado com solene/bispo)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._get_pontos_status(
  p_paroquia_id UUID,
  p_status      TEXT,
  p_solene      BOOLEAN DEFAULT false,
  p_tem_bispo   BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'presente' THEN
      CASE
        WHEN p_tem_bispo THEN COALESCE((SELECT pontuacao_presenca_bispo  FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 5)
        WHEN p_solene    THEN COALESCE((SELECT pontuacao_presenca_solene FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 3)
        ELSE                  COALESCE((SELECT pontuacao_presenca        FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
      END
    WHEN 'confirmado' THEN
      CASE
        WHEN p_tem_bispo THEN COALESCE((SELECT pontuacao_presenca_bispo  FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 5)
        WHEN p_solene    THEN COALESCE((SELECT pontuacao_presenca_solene FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 3)
        ELSE                  COALESCE((SELECT pontuacao_presenca        FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
      END
    WHEN 'faltou'     THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'ausente'    THEN COALESCE((SELECT pontuacao_falta      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -2)
    WHEN 'atrasado'   THEN COALESCE((SELECT pontuacao_atraso     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), -1)
    WHEN 'justificou' THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    WHEN 'recusado'   THEN COALESCE((SELECT pontuacao_justificou FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 0)
    ELSE 0
  END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. HELPER — _get_pontos_tipo_evento (novo, para agenda)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._get_pontos_tipo_evento(
  p_paroquia_id UUID,
  p_tipo        TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_tipo
    WHEN 'formacao'    THEN COALESCE((SELECT pontuacao_formacao    FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 2)
    WHEN 'reuniao'     THEN COALESCE((SELECT pontuacao_reuniao     FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'retiro'      THEN COALESCE((SELECT pontuacao_retiro      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 5)
    WHEN 'adoracao'    THEN COALESCE((SELECT pontuacao_adoracao    FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 2)
    WHEN 'ensaio'      THEN COALESCE((SELECT pontuacao_ensaio      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 1)
    WHEN 'encontro'    THEN COALESCE((SELECT pontuacao_encontro    FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 2)
    WHEN 'compromisso' THEN COALESCE((SELECT pontuacao_compromisso FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 2)
    WHEN 'evento'      THEN COALESCE((SELECT pontuacao_evento      FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 3)
    ELSE COALESCE((SELECT pontuacao_formacao FROM public.paroquia_config_escalas WHERE paroquia_id = p_paroquia_id), 2)
  END;
$$;

GRANT EXECUTE ON FUNCTION public._get_pontos_tipo_evento(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. TRIGGER FUNCTION — _trigger_recalc_score_membro (novo)
-- ══════════════════════════════════════════════════════════════
-- Recalcula membros.score a partir do SUM total de
-- historico_participacoes sempre que uma linha é inserida,
-- atualizada (campo pontos) ou deletada.
-- Este é agora o ÚNICO caminho que atualiza membros.score
-- a partir de eventos individuais.

CREATE OR REPLACE FUNCTION public._trigger_recalc_score_membro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id UUID;
BEGIN
  v_membro_id := COALESCE(NEW.membro_id, OLD.membro_id);

  UPDATE public.membros
  SET    score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM   public.historico_participacoes hp
    WHERE  hp.membro_id = v_membro_id
  )
  WHERE  id = v_membro_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. TRIGGER — on_historico_score_recalc
-- ══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_historico_score_recalc ON public.historico_participacoes;

CREATE TRIGGER on_historico_score_recalc
  AFTER INSERT OR UPDATE OF pontos OR DELETE
  ON    public.historico_participacoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_recalc_score_membro();

-- ══════════════════════════════════════════════════════════════
-- 7. TRIGGER FUNCTION — _trigger_pontuar_participacao (revisado)
-- ══════════════════════════════════════════════════════════════
-- Mudanças em relação à versão 026:
--   • Lê solene e tem_bispo da escala e passa para _get_pontos_status
--   • Determina tipo_evento ('escala', 'solene', 'bispo')
--   • NÃO atualiza membros.score diretamente — delega ao
--     trigger on_historico_score_recalc (passo 6)
--   • ON CONFLICT usa o índice parcial uniq_hist_escala

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_pontos       INTEGER;
  v_tipo_evento  TEXT;
  v_status_final CONSTANT TEXT[] := ARRAY[
    'presente','confirmado','faltou','ausente','atrasado','justificou','recusado'
  ];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status, v_solene, v_tem_bispo);

  -- Determina tipo_evento para o histórico
  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  -- Upsert usando o índice parcial uniq_hist_escala
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, NEW.membro_id, NEW.escala_id, NEW.ministerio_id,
     v_tipo_evento, 'escala', NEW.status, v_escala_data, v_pontos)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala','solene','bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE
    SET presenca    = EXCLUDED.presenca,
        tipo_evento = EXCLUDED.tipo_evento,
        pontos      = EXCLUDED.pontos;

  -- membros.score é atualizado por on_historico_score_recalc automaticamente.
  RETURN NEW;
END;
$$;

-- Recria o trigger com a função revisada
DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status
  ON    public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- ══════════════════════════════════════════════════════════════
-- 8. RPC — marcar_presenca_evento
-- ══════════════════════════════════════════════════════════════
-- Chamada atômica do TypeScript para registrar presença em
-- eventos de agenda pastoral. Substitui o padrão de:
--   1. UPSERT presencas_eventos
--   2. READ membros.score
--   3. UPDATE membros.score += delta   ← removido
-- Por:
--   1. UPSERT presencas_eventos (metadata: presente, pontuacao_recebida)
--   2. UPSERT / DELETE historico_participacoes   ← novo caminho canônico
--   → trigger on_historico_score_recalc cuida do score

CREATE OR REPLACE FUNCTION public.marcar_presenca_evento(
  p_paroquia_id UUID,
  p_evento_id   UUID,
  p_membro_id   UUID,
  p_tipo        TEXT,
  p_data        DATE,
  p_titulo      TEXT,
  p_presente    BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pontos INTEGER := 0;
BEGIN
  -- 1. Upsert presencas_eventos (estado da UI: presente/ausente)
  --    Não toca justificativa/observacoes — JustificativaRow cuida disso.
  INSERT INTO public.presencas_eventos
    (evento_id, membro_id, presente, pontuacao_recebida)
  VALUES
    (p_evento_id, p_membro_id, p_presente, 0)
  ON CONFLICT (evento_id, membro_id) DO UPDATE
    SET presente         = EXCLUDED.presente,
        pontuacao_recebida = 0;

  -- 2. Gerencia pontuação em historico_participacoes
  IF p_presente = true THEN
    v_pontos := public._get_pontos_tipo_evento(p_paroquia_id, p_tipo);

    -- Upsert usando índice parcial uniq_hist_evento
    INSERT INTO public.historico_participacoes
      (paroquia_id, membro_id, tipo_evento, origem,
       referencia_id, descricao, presenca, data, pontos)
    VALUES
      (p_paroquia_id, p_membro_id, p_tipo, 'agenda',
       p_evento_id, p_titulo, 'presente', p_data, v_pontos)
    ON CONFLICT (membro_id, referencia_id)
      WHERE referencia_id IS NOT NULL
        AND tipo_evento   <> 'escala'
    DO UPDATE
      SET pontos    = EXCLUDED.pontos,
          presenca  = EXCLUDED.presenca,
          descricao = EXCLUDED.descricao;

    -- Atualiza pontuacao_recebida para exibição na UI
    UPDATE public.presencas_eventos
    SET    pontuacao_recebida = v_pontos
    WHERE  evento_id = p_evento_id
      AND  membro_id = p_membro_id;

  ELSE
    -- Remove registro de pontuação (trigger recalcula o score)
    DELETE FROM public.historico_participacoes
    WHERE  membro_id     = p_membro_id
      AND  referencia_id = p_evento_id
      AND  tipo_evento  <> 'escala';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_presenca_evento(UUID, UUID, UUID, TEXT, DATE, TEXT, BOOLEAN) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 9. ATUALIZAR admin_recalcular_scores_paroquia
-- ══════════════════════════════════════════════════════════════
-- Já usava SUM(historico_participacoes.pontos) — continua
-- correto após a unificação. Sem mudança de lógica.
-- Mantido aqui como referência (CREATE OR REPLACE idempotente).

CREATE OR REPLACE FUNCTION public.admin_recalcular_scores_paroquia(p_paroquia_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Agora cobre TODOS os eventos (escalas + agenda pastoral)
  -- porque ambos registram em historico_participacoes.
  UPDATE public.membros m
  SET    score = (
    SELECT COALESCE(SUM(hp.pontos), 0)
    FROM   public.historico_participacoes hp
    WHERE  hp.membro_id = m.id
  )
  WHERE  m.paroquia_id = p_paroquia_id
    AND  m.ativo       = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'membros_atualizados', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recalcular_scores_paroquia(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 10. MIGRAÇÃO DE DADOS — presencas_eventos → historico
-- ══════════════════════════════════════════════════════════════
-- Converte o histórico legado de presenças em eventos de agenda
-- para o novo formato unificado em historico_participacoes.
-- Apenas registros com presente=true geram pontuação.
-- ON CONFLICT DO NOTHING garante idempotência.

INSERT INTO public.historico_participacoes
  (paroquia_id, membro_id, tipo_evento, origem,
   referencia_id, descricao, presenca, data, pontos)
SELECT
  fe.paroquia_id,
  pe.membro_id,
  fe.tipo,
  'agenda',
  pe.evento_id,
  fe.titulo,
  'presente',
  fe.data_inicio::DATE,
  COALESCE(
    pe.pontuacao_recebida,
    public._get_pontos_tipo_evento(fe.paroquia_id, fe.tipo),
    2
  )
FROM  public.presencas_eventos    pe
JOIN  public.formacoes_eventos    fe ON fe.id = pe.evento_id
WHERE pe.presente = true
ON CONFLICT (membro_id, referencia_id)
  WHERE referencia_id IS NOT NULL
    AND tipo_evento   <> 'escala'
DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 11. RECÁLCULO COMPLETO DOS SCORES
-- ══════════════════════════════════════════════════════════════
-- Garante consistência total após a migração de dados.
-- membros.score = SUM de TODOS os pontos (escalas + agenda).

UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

-- ══════════════════════════════════════════════════════════════
-- 12. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Presença em missa normal  → historico com tipo_evento='escala'
--   ✓ Presença em missa solene  → historico com tipo_evento='solene'
--   ✓ Presença com bispo        → historico com tipo_evento='bispo'
--   ✓ Presença em formação      → historico com tipo_evento='formacao'
--   ✓ Falta em escala           → historico com pontos negativos
--   ✓ admin_recalcular_scores   → cobre escalas + agenda
--   ✓ marcar_presenca_evento    → único caminho para agenda
--   ✓ on_historico_score_recalc → único atualizador de score
--   ✓ Nenhum UPDATE direto em membros.score no código TS
-- ─────────────────────────────────────────────────────────────
