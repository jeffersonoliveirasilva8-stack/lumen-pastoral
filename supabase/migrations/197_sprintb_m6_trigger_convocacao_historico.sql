-- Migration 197 — Sprint B M6
-- Trigger: escala_convocacoes → historico_participacoes
--
-- Quando o status de uma convocação geral muda para estado final
-- (presente, ausente, justificou), registra (ou atualiza) no histórico
-- com tipo_evento='convocacao_solene'.
--
-- Cobre membros com e sem função específica.
-- Idempotente via ON CONFLICT DO UPDATE usando uniq_hist_convocacao (M4).

CREATE OR REPLACE FUNCTION public._trigger_pontuar_convocacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_pontos       INTEGER;
  v_status_final CONSTANT TEXT[] := ARRAY['presente','ausente','justificou'];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL OR NOT v_solene THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  -- Mapeia status da convocação para presenca do histórico
  -- 'presente' → 'presente'; 'ausente' → 'faltou'; 'justificou' → 'justificou'
  v_pontos := public._get_pontos_status(
    v_paroquia_id,
    CASE NEW.status WHEN 'ausente' THEN 'faltou' ELSE NEW.status END,
    v_solene,     -- p_solene
    v_tem_bispo   -- p_tem_bispo
  );

  -- Upsert usando uniq_hist_convocacao (membro_id, escala_id WHERE convocacao_solene)
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES (
    v_paroquia_id,
    NEW.membro_id,
    NEW.escala_id,
    NULL,                    -- sem ministerio: convocação geral
    'convocacao_solene',
    'convocacao_geral',
    CASE NEW.status WHEN 'ausente' THEN 'faltou' ELSE NEW.status END,
    v_escala_data,
    v_pontos
  )
  ON CONFLICT (membro_id, escala_id)
    WHERE tipo_evento = 'convocacao_solene' AND escala_id IS NOT NULL
  DO UPDATE
    SET presenca = EXCLUDED.presenca,
        pontos   = EXCLUDED.pontos;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_convocacao_status_final ON public.escala_convocacoes;

CREATE TRIGGER on_escala_convocacao_status_final
  AFTER UPDATE OF status
  ON    public.escala_convocacoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_convocacao();
