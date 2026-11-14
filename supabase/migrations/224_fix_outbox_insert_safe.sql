-- Migration 224 — fix _outbox_insert_safe tipo v_inserted
--
-- Bug: v_inserted declarado como boolean, mas GET DIAGNOSTICS ROW_COUNT
-- retorna bigint. Isso causa "operator does not exist: boolean > integer"
-- em toda chamada, e o trigger swallowa a exceção silenciosamente via
-- EXCEPTION WHEN OTHERS → nenhuma mensagem chegava ao outbox.
--
-- Fix: declarar v_inserted como bigint (mesmo tipo que ROW_COUNT).

CREATE OR REPLACE FUNCTION public._outbox_insert_safe(
  p_evento_id    uuid,
  p_evento_ref_id uuid,
  p_evento_tipo  text,
  p_membro_id    uuid,
  p_paroquia_id  uuid,
  p_payload      jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_inserted bigint := 0;   -- FIX: era boolean, ROW_COUNT é bigint
BEGIN
  INSERT INTO public.whatsapp_outbox (
    evento_id,
    evento_ref_id,
    evento_tipo,
    membro_id,
    paroquia_id,
    payload,
    status,
    next_attempt_at
  ) VALUES (
    p_evento_id,
    p_evento_ref_id,
    p_evento_tipo,
    p_membro_id,
    p_paroquia_id,
    p_payload,
    'pending',
    now()
  )
  ON CONFLICT (evento_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public._outbox_insert_safe(uuid, uuid, text, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._outbox_insert_safe(uuid, uuid, text, uuid, uuid, jsonb) TO service_role;
