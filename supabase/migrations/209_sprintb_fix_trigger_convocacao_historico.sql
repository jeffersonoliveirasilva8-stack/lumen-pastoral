-- Migration 209 — Sprint B Fix: _trigger_pontuar_convocacao
--
-- Correções aplicadas:
-- 1. Remove gate auto_pontuar: histórico sempre inserido (FASE 6C depende disso)
-- 2. pontos=0 quando auto_pontuar=false; recalculado quando true
-- 3. DO UPDATE preserva pontos existentes quando auto_pontuar=false
--    (não zera pontuações legítimas em reativações ou reavaliações)
-- 4. Captura pontos do melhor registro anterior (MAX) ANTES de anulá-lo
--    para preservar pontuação histórica quando auto_pontuar=false
-- 5. Anula registros tipo='escala','solene','bispo' antes de inserir
--    convocacao_solene, garantindo um único registro efetivo por
--    (membro_id, escala_id) para a FASE 6C
-- 6. anulada=false no DO UPDATE para reativar registros previamente anulados
-- 7. FOUND capturado em variável imediatamente após SELECT INTO

CREATE OR REPLACE FUNCTION public._trigger_pontuar_convocacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id       UUID;
  v_escala_data       DATE;
  v_solene            BOOLEAN;
  v_tem_bispo         BOOLEAN;
  v_config            public.paroquia_config_escalas%ROWTYPE;
  v_config_found      BOOLEAN;
  v_auto_pontuar      BOOLEAN;
  v_pontos_calculados INTEGER;
  v_pontos_anteriores INTEGER;
  v_pontos_finais     INTEGER;
  v_presenca_mapeada  TEXT;
  v_status_final      CONSTANT TEXT[] := ARRAY['presente','ausente','justificou'];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL OR NOT v_solene THEN RETURN NEW; END IF;

  -- Captura config e FOUND imediatamente em variável local
  -- (qualquer SELECT seguinte sobrescreveria FOUND)
  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;
  v_config_found := FOUND;
  v_auto_pontuar := v_config_found AND v_config.auto_pontuar;

  v_presenca_mapeada := CASE NEW.status WHEN 'ausente' THEN 'faltou' ELSE NEW.status END;

  -- Pontos calculados (0 quando auto_pontuar=false, mas INSERT sempre ocorre)
  IF v_auto_pontuar THEN
    v_pontos_calculados := public._get_pontos_status(
      v_paroquia_id, v_presenca_mapeada, v_solene, v_tem_bispo
    );
  ELSE
    v_pontos_calculados := 0;
  END IF;

  -- Captura melhor pontuação anterior ANTES de anular os registros
  -- (MAX evita somar duplicatas; NULL se não houver registro anterior)
  SELECT MAX(pontos) INTO v_pontos_anteriores
  FROM   public.historico_participacoes
  WHERE  membro_id   = NEW.membro_id
    AND  escala_id   = NEW.escala_id
    AND  tipo_evento IN ('escala','solene','bispo')
    AND  anulada     = false;

  -- Pontos finais:
  -- auto_pontuar=true  → sempre recalcular
  -- auto_pontuar=false → preservar pontos anteriores (se existirem) ou 0
  v_pontos_finais := CASE
    WHEN v_auto_pontuar                  THEN v_pontos_calculados
    WHEN v_pontos_anteriores IS NOT NULL THEN v_pontos_anteriores
    ELSE 0
  END;

  -- Anula históricos anteriores para evitar dupla contagem na FASE 6C
  -- (escala/solene/bispo + convocacao_solene contariam separadamente sem isso)
  UPDATE public.historico_participacoes
  SET    anulada = true
  WHERE  membro_id   = NEW.membro_id
    AND  escala_id   = NEW.escala_id
    AND  tipo_evento IN ('escala','solene','bispo')
    AND  anulada     = false;

  -- INSERT canônico — sempre, independente de auto_pontuar
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES (
    v_paroquia_id,
    NEW.membro_id,
    NEW.escala_id,
    NULL,
    'convocacao_solene',
    'convocacao_geral',
    v_presenca_mapeada,
    v_escala_data,
    v_pontos_finais
  )
  ON CONFLICT (membro_id, escala_id)
    WHERE tipo_evento = 'convocacao_solene' AND escala_id IS NOT NULL
  DO UPDATE
    SET presenca = EXCLUDED.presenca,
        pontos   = CASE
                     WHEN v_auto_pontuar
                     THEN EXCLUDED.pontos            -- recalculado
                     ELSE historico_participacoes.pontos  -- preserva existente
                   END,
        anulada  = false;  -- reativa registros previamente anulados

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_convocacao_status_final ON public.escala_convocacoes;

CREATE TRIGGER on_escala_convocacao_status_final
  AFTER UPDATE OF status
  ON    public.escala_convocacoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_convocacao();
