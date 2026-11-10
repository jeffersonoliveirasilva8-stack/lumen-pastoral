-- Migration 215 — Sprint B Fix: _trigger_pontuar_convocacao — SUM e idempotência v2
--
-- Correções v2:
-- 1. v_tem_historicos_antigos separado de v_soma_antigas: distingue
--    "sem registros" de "soma = 0 ou negativa" — resolve falso negativo
--    da condição anterior v_soma_antigas > 0
-- 2. Uma única query calcula COUNT > 0 e SUM simultaneamente
-- 3. ON CONFLICT usa v_tem_historicos_antigos como chave de decisão
-- Nome do trigger confirmado: on_escala_convocacao_status_final (197 → 209 → 215).

CREATE OR REPLACE FUNCTION public._trigger_pontuar_convocacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id            UUID;
  v_escala_data            DATE;
  v_solene                 BOOLEAN;
  v_tem_bispo              BOOLEAN;
  v_config                 public.paroquia_config_escalas%ROWTYPE;
  v_config_found           BOOLEAN;
  v_auto_pontuar           BOOLEAN;
  v_pontos_calculados      INTEGER;
  v_tem_historicos_antigos BOOLEAN;  -- existência independente do valor da soma
  v_soma_antigas           INTEGER;  -- SUM dos históricos antigos ativos
  v_pontos_finais          INTEGER;  -- valor para o INSERT (conflict-free path)
  v_presenca_mapeada       TEXT;
  v_status_final           CONSTANT TEXT[] := ARRAY['presente','ausente','justificou'];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL OR NOT v_solene THEN RETURN NEW; END IF;

  -- Captura config e FOUND em variável local imediatamente
  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;
  v_config_found := FOUND;
  v_auto_pontuar := v_config_found AND v_config.auto_pontuar;

  v_presenca_mapeada := CASE NEW.status WHEN 'ausente' THEN 'faltou' ELSE NEW.status END;

  IF v_auto_pontuar THEN
    v_pontos_calculados := public._get_pontos_status(
      v_paroquia_id, v_presenca_mapeada, v_solene, v_tem_bispo
    );
  ELSE
    v_pontos_calculados := 0;
  END IF;

  -- Calcula existência e soma em uma única query para garantir consistência.
  -- ministerio_id IS NOT NULL: exclui o próprio registro canônico convocacao_solene.
  -- tipo_evento IN (...): exclui convocacao_solene explicitamente pelo tipo.
  -- anulada=false: somente registros ainda ativos.
  -- COUNT(*) > 0: existência independente do sinal da soma.
  -- COALESCE(SUM,0): SUM de conjunto vazio = NULL; substituímos por 0.
  SELECT
    COUNT(*) > 0,
    COALESCE(SUM(pontos), 0)
  INTO v_tem_historicos_antigos, v_soma_antigas
  FROM   public.historico_participacoes
  WHERE  membro_id     = NEW.membro_id
    AND  escala_id     = NEW.escala_id
    AND  tipo_evento   IN ('escala','solene','bispo')
    AND  ministerio_id IS NOT NULL
    AND  anulada       = false;

  -- Pontos para o INSERT (conflict-free path):
  -- auto_pontuar=true              → recalcula pela regra de pontuação
  -- auto_pontuar=false, há antigos → consolida a soma (pode ser 0 ou negativo)
  -- auto_pontuar=false, sem antigos → insere 0 (nenhum histórico a consolidar)
  v_pontos_finais := CASE
    WHEN v_auto_pontuar              THEN v_pontos_calculados
    WHEN v_tem_historicos_antigos    THEN v_soma_antigas
    ELSE                                  0
  END;

  -- Anula históricos anteriores para evitar dupla contagem na FASE 6C
  UPDATE public.historico_participacoes
  SET    anulada = true
  WHERE  membro_id    = NEW.membro_id
    AND  escala_id    = NEW.escala_id
    AND  tipo_evento  IN ('escala','solene','bispo')
    AND  anulada      = false;

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
                     -- auto_pontuar=true: recalcula sempre
                     WHEN v_auto_pontuar           THEN EXCLUDED.pontos

                     -- auto_pontuar=false, registros antigos ainda ativos:
                     -- consolida a soma (incluindo casos onde soma = 0 ou negativo)
                     WHEN v_tem_historicos_antigos THEN v_soma_antigas

                     -- auto_pontuar=false, sem registros antigos ativos
                     -- (já anulados em execução anterior, ou membro sem função):
                     -- preserva os pontos que o canônico já carrega — idempotente
                     ELSE historico_participacoes.pontos
                   END,
        anulada  = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_convocacao_status_final ON public.escala_convocacoes;

CREATE TRIGGER on_escala_convocacao_status_final
  AFTER UPDATE OF status
  ON    public.escala_convocacoes
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_convocacao();
