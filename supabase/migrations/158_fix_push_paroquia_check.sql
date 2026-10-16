-- Migration 158 — Corrige RPC upsert_push_subscription: valida pertencimento à paróquia
--
-- Problema (migration 156): a RPC aceitava qualquer p_paroquia_id sem verificar
-- se o usuário é membro daquela paróquia, permitindo associar um dispositivo
-- a uma paróquia alheia.
--
-- Solução: verifica existência de membro ativo com auth_user_id = auth.uid()
-- na paróquia informada antes de inserir/atualizar.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_paroquia_id UUID,
  p_endpoint    TEXT,
  p_p256dh      TEXT,
  p_auth_key    TEXT,
  p_user_agent  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Garante que o usuário é membro ativo da paróquia informada
  IF NOT EXISTS (
    SELECT 1 FROM public.membros
    WHERE auth_user_id = auth.uid()
      AND paroquia_id  = p_paroquia_id
      AND ativo        = true
  ) THEN
    RAISE EXCEPTION 'not_member_of_paroquia';
  END IF;

  INSERT INTO public.push_subscriptions
    (user_id, paroquia_id, endpoint, p256dh, auth_key, user_agent)
  VALUES
    (auth.uid(), p_paroquia_id, p_endpoint, p_p256dh, p_auth_key, p_user_agent)
  ON CONFLICT (user_id, endpoint)
  DO UPDATE SET
    p256dh       = EXCLUDED.p256dh,
    auth_key     = EXCLUDED.auth_key,
    paroquia_id  = EXCLUDED.paroquia_id,
    user_agent   = EXCLUDED.user_agent,
    last_used_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
