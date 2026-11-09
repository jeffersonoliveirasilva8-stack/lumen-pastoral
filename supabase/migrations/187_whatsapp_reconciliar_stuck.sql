-- ============================================================
-- Migration 187 — _reconciliar_tentativas_stuck
--
-- Detecta e finaliza tentativas que ficaram presas em status
-- 'iniciado' após crash do worker (dispatch_started_at definido
-- mas dispatch_finished_at nunca preenchido).
--
-- Threshold: dispatch_started_at < clock_timestamp() - p_threshold
-- Default: 10 minutos (EF timeout 20s + janela 120s + folga)
--
-- Para cada tentativa stuck:
--   1. Marca tentativa como 'falhou' (dispatch_finished_at = now)
--   2. Reintegra outbox para 'pending' com backoff exponencial
--      (mesma lógica de _expirar_e_reemitir_tentativa)
--
-- Retorna: número de tentativas reconciliadas.
-- Chamado pelo worker no início de cada run.
--
-- search_path = '' em todas as funções.
-- ============================================================

CREATE OR REPLACE FUNCTION public._reconciliar_tentativas_stuck(
  p_threshold interval DEFAULT interval '10 minutes'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec              record;
  v_tentativas_count int;
  v_backoff_minutes  numeric;
  v_next_attempt_at  timestamptz;
  v_rows_tent        int;
  v_rows_outbox      int;
  v_total            int := 0;
BEGIN
  FOR v_rec IN
    SELECT t.id          AS tentativa_id,
           t.outbox_id,
           t.tentativa_num
    FROM   public.whatsapp_outbox_tentativas t
    JOIN   public.whatsapp_outbox o ON o.id = t.outbox_id
    WHERE  t.status               = 'iniciado'
      AND  t.dispatch_started_at  IS NOT NULL
      AND  t.dispatch_finished_at IS NULL
      AND  t.dispatch_started_at  < clock_timestamp() - p_threshold
      AND  o.status               = 'reserved'
    FOR UPDATE OF t, o SKIP LOCKED
  LOOP
    -- Marcar tentativa como falhou
    UPDATE public.whatsapp_outbox_tentativas
    SET    status               = 'falhou',
           dispatch_finished_at = clock_timestamp(),
           updated_at           = clock_timestamp()
    WHERE  id = v_rec.tentativa_id
      AND  status = 'iniciado';

    GET DIAGNOSTICS v_rows_tent = ROW_COUNT;

    IF v_rows_tent = 0 THEN
      CONTINUE;  -- outro processo ganhou a corrida
    END IF;

    -- Calcular backoff para o outbox
    SELECT tentativas_count INTO v_tentativas_count
    FROM   public.whatsapp_outbox
    WHERE  id = v_rec.outbox_id;

    v_backoff_minutes := LEAST(5.0 * POWER(2.0, v_tentativas_count - 1), 60.0);
    v_next_attempt_at := clock_timestamp() + (v_backoff_minutes || ' minutes')::interval;

    -- Reintegrar outbox para 'pending' com backoff
    UPDATE public.whatsapp_outbox
    SET    status          = 'pending',
           next_attempt_at = v_next_attempt_at,
           updated_at      = clock_timestamp()
    WHERE  id     = v_rec.outbox_id
      AND  status = 'reserved';

    GET DIAGNOSTICS v_rows_outbox = ROW_COUNT;

    IF v_rows_outbox = 0 THEN
      RAISE WARNING '_reconciliar_tentativas_stuck: outbox % não estava reserved ao reintegrar (tentativa %)',
        v_rec.outbox_id, v_rec.tentativa_id;
      CONTINUE;
    END IF;

    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public._reconciliar_tentativas_stuck(interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._reconciliar_tentativas_stuck(interval) TO service_role;

NOTIFY pgrst, 'reload schema';
