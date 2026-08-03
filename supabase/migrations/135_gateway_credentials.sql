-- Migration 135: Tabela de credenciais de gateway de pagamento (gerenciada pelo Super Admin)

CREATE TABLE IF NOT EXISTS public.gateway_credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway     TEXT NOT NULL CHECK (gateway IN ('mercadopago', 'stripe', 'asaas')),
  label       TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  -- Credenciais armazenadas como JSONB (valores sensíveis ficam em secrets da Edge Function;
  -- aqui guardamos apenas identificadores públicos e flags de configuração)
  public_key  TEXT,
  webhook_url TEXT,
  sandbox     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gateway_credentials_gateway_unique UNIQUE (gateway)
);

ALTER TABLE public.gateway_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gateway_credentials_super_admin" ON public.gateway_credentials;
CREATE POLICY "gateway_credentials_super_admin"
  ON public.gateway_credentials
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Função para ativar/desativar gateway (garante apenas um ativo por vez)
CREATE OR REPLACE FUNCTION public.set_active_gateway(p_gateway TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.gateway_credentials SET is_active = false;
  UPDATE public.gateway_credentials SET is_active = true, updated_at = now()
  WHERE gateway = p_gateway;
END;
$$;
