-- Migration 225 — fix _adquirir_outbox_pendente coluna ambígua
--
-- Bug: RETURNING outbox_id dentro de INSERT INTO whatsapp_outbox_tentativas
-- em contexto PL/pgSQL onde existe variável v_outbox_id e coluna outbox_id.
-- PostgreSQL reporta "column reference outbox_id is ambiguous".
--
-- Fix: qualificar com nome da tabela no RETURNING.

CREATE OR REPLACE FUNCTION public._adquirir_outbox_pendente(
  p_paroquia_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  outbox_id              uuid,
  tentativa_id           uuid,
  reservation_token      uuid,
  reservation_expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_outbox_id uuid;
BEGIN
  WITH candidato AS (
    SELECT id
    FROM   public.whatsapp_outbox
    WHERE  status           = 'pending'
      AND  next_attempt_at <= clock_timestamp()
      AND  (p_paroquia_id IS NULL OR paroquia_id = p_paroquia_id)
    ORDER  BY created_at
    FOR    UPDATE SKIP LOCKED
    LIMIT  1
  )
  UPDATE public.whatsapp_outbox o
  SET    status           = 'reserved',
         updated_at       = clock_timestamp(),
         tentativas_count = tentativas_count + 1
  FROM   candidato
  WHERE  o.id = candidato.id
  RETURNING o.id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.whatsapp_outbox_tentativas (
    outbox_id,
    tentativa_num,
    reservation_token,
    reservation_expires_at,
    status
  )
  SELECT
    v_outbox_id,
    COALESCE((
      SELECT MAX(t2.tentativa_num)
      FROM   public.whatsapp_outbox_tentativas t2
      WHERE  t2.outbox_id = v_outbox_id
    ), 0) + 1,
    gen_random_uuid(),
    clock_timestamp() + interval '5 minutes',
    'reservado'
  -- FIX: qualificar com alias de tabela para evitar ambiguidade com variável PL/pgSQL
  RETURNING
    whatsapp_outbox_tentativas.outbox_id,
    whatsapp_outbox_tentativas.id,
    whatsapp_outbox_tentativas.reservation_token,
    whatsapp_outbox_tentativas.reservation_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public._adquirir_outbox_pendente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._adquirir_outbox_pendente(uuid) TO service_role;
