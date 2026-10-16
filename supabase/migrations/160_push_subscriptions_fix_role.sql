-- Migration 160 — Cria push_subscriptions com correção de 156
--
-- A migration 156 usa m.role (inexistente); esta substitui com tipo_acesso.
-- A policy push_sub_admin_read é desnecessária para o fluxo real (send-push
-- usa service_role que bypassa RLS), mas é criada corretamente para completude.
--
-- IDEMPOTENTE: sim (IF NOT EXISTS / CREATE OR REPLACE)

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  paroquia_id  UUID        NOT NULL REFERENCES public.paroquias(id)  ON DELETE CASCADE,
  endpoint     TEXT        NOT NULL,
  p256dh       TEXT        NOT NULL,
  auth_key     TEXT        NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_paroquia_idx
  ON public.push_subscriptions (paroquia_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'push_subscriptions'
      AND policyname = 'push_sub_owner'
  ) THEN
    CREATE POLICY "push_sub_owner"
      ON public.push_subscriptions FOR ALL TO authenticated
      USING  (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'push_subscriptions'
      AND policyname = 'push_sub_admin_read'
  ) THEN
    CREATE POLICY "push_sub_admin_read"
      ON public.push_subscriptions FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.membros m
          WHERE m.auth_user_id = auth.uid()
            AND m.paroquia_id  = push_subscriptions.paroquia_id
            AND m.ativo        = true
            AND m.tipo_acesso  IN ('administrador', 'coordenador')
        )
      );
  END IF;
END;
$$;

-- RPC: inscrever dispositivo
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

-- RPC: remover inscrição
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM public.push_subscriptions
  WHERE user_id = auth.uid() AND endpoint = p_endpoint;
END;
$$;

NOTIFY pgrst, 'reload schema';
