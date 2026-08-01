-- ── 128: SaaS — Subscriptions, Invoices e Funções de Plano ───────────────

-- 1. Tabela de assinaturas (1:1 com paroquias)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id             UUID UNIQUE NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  plan_id                 UUID NOT NULL REFERENCES public.plans(id),
  status                  sub_status NOT NULL DEFAULT 'trial',
  trial_until             TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT false,
  canceled_at             TIMESTAMPTZ,
  past_due_since          TIMESTAMPTZ,
  gateway                 TEXT CHECK (gateway IN ('mercadopago','stripe','asaas','manual')),
  gateway_subscription_id TEXT,
  gateway_customer_id     TEXT,
  price_brl               NUMERIC(10,2),
  billing_cycle           TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  next_billing_date       DATE,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status       ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing ON public.subscriptions(next_billing_date);

-- 2. Tabela de faturas
CREATE TABLE IF NOT EXISTS public.invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  paroquia_id         UUID NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  gateway_invoice_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','chargeback')),
  amount_brl          NUMERIC(10,2) NOT NULL,
  due_date            DATE NOT NULL,
  paid_at             TIMESTAMPTZ,
  period_start        DATE,
  period_end          DATE,
  description         TEXT,
  payment_method      TEXT CHECK (payment_method IN ('pix','boleto','credit_card')),
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_paroquia ON public.invoices(paroquia_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON public.invoices(status);

-- 3. Trigger updated_at em subscriptions
DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. RLS — subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_own_read"          ON public.subscriptions;
DROP POLICY IF EXISTS "sub_super_admin_all"   ON public.subscriptions;
DROP POLICY IF EXISTS "sub_no_direct_write"   ON public.subscriptions;
DROP POLICY IF EXISTS "inv_own_read"          ON public.invoices;
DROP POLICY IF EXISTS "inv_super_admin_all"   ON public.invoices;

CREATE POLICY "sub_own_read" ON public.subscriptions
  FOR SELECT USING (paroquia_id = public.current_paroquia_id());

CREATE POLICY "sub_super_admin_all" ON public.subscriptions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- Assinaturas só podem ser escritas por super_admin ou service_role (via RPC)
CREATE POLICY "sub_no_direct_write" ON public.subscriptions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "inv_own_read" ON public.invoices
  FOR SELECT USING (paroquia_id = public.current_paroquia_id());

CREATE POLICY "inv_super_admin_all" ON public.invoices
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- 5. Função: verifica se a paróquia atual tem uma feature habilitada
CREATE OR REPLACE FUNCTION public.check_plan_feature(p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Super admin sempre tem acesso
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
    OR
    -- Paróquia com subscription ativa/trial e feature habilitada
    EXISTS (
      SELECT 1
      FROM subscriptions s
      JOIN plan_features pf ON pf.plan_id = s.plan_id
      WHERE s.paroquia_id = current_paroquia_id()
        AND s.status IN ('trial', 'active')
        AND (
          s.status != 'trial'
          OR s.trial_until IS NULL
          OR s.trial_until > now()
        )
        AND pf.feature_key = p_feature
        AND pf.enabled = true
    );
$$;

-- 6. Stub de paroquia_is_accessible() — redefinida na migration 129 após a coluna status ser criada
CREATE OR REPLACE FUNCTION public.paroquia_is_accessible()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT TRUE;
$$;

-- 7. Função: verifica limite numérico de uma feature
CREATE OR REPLACE FUNCTION public.check_feature_limit(p_feature TEXT, p_current_count INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
    OR
    EXISTS (
      SELECT 1
      FROM subscriptions s
      JOIN plan_features pf ON pf.plan_id = s.plan_id
      WHERE s.paroquia_id = current_paroquia_id()
        AND s.status IN ('trial', 'active')
        AND pf.feature_key = p_feature
        AND pf.enabled = true
        AND (pf.limit_value IS NULL OR p_current_count < pf.limit_value)
    );
$$;
