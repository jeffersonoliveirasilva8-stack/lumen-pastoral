-- Migration 214 — Sprint B Fix: _trigger_pontuar_participacao — pontos
--
-- DO UPDATE preserva pontos existentes quando auto_pontuar=false.
-- Nome do trigger confirmado: on_escala_membro_status_final (196 → 210 → 214).

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id    UUID;
  v_escala_data    DATE;
  v_solene         BOOLEAN;
  v_tem_bispo      BOOLEAN;
  v_conv_geral     BOOLEAN;
  v_config         public.paroquia_config_escalas%ROWTYPE;
  v_config_found   BOOLEAN;
  v_auto_pontuar   BOOLEAN;
  v_pontos         INTEGER;
  v_tipo_evento    TEXT;
  v_status_final   CONSTANT TEXT[] := ARRAY[
    'presente','faltou','ausente','atrasado','justificou'
  ];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo, e.tem_convocacao_geral
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo, v_conv_geral
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  -- Em escalas solenes com convocação geral, o histórico é gerido pelo
  -- trigger de escala_convocacoes para garantir um único registro por membro.
  IF v_solene AND v_conv_geral THEN RETURN NEW; END IF;

  -- Captura config e FOUND imediatamente em variável local
  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;
  v_config_found := FOUND;
  v_auto_pontuar := v_config_found AND v_config.auto_pontuar;

  -- Pontos calculados (0 quando auto_pontuar=false; INSERT sempre ocorre para FASE 6C)
  IF v_auto_pontuar THEN
    v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status, v_solene, v_tem_bispo);
  ELSE
    v_pontos := 0;
  END IF;

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

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
        pontos      = CASE
                        WHEN v_auto_pontuar THEN EXCLUDED.pontos
                        ELSE historico_participacoes.pontos  -- preserva pontos legítimos
                      END,
        anulada     = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status
  ON    public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_participacao();
