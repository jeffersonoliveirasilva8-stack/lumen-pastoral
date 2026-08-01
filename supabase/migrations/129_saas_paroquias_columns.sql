-- ── 129: SaaS — Colunas SaaS em paroquias + migração de existentes ────────

-- 1. Novas colunas em paroquias
ALTER TABLE public.paroquias
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial','active','past_due','suspended','blocked','canceled')),
  ADD COLUMN IF NOT EXISTS trial_until        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason  TEXT,
  ADD COLUMN IF NOT EXISTS cnpj               TEXT,
  ADD COLUMN IF NOT EXISTS estado             TEXT;

COMMENT ON COLUMN public.paroquias.status IS
  'Estado rápido da assinatura — denormalizado de subscriptions para uso em RLS';
COMMENT ON COLUMN public.paroquias.trial_until IS
  'Denormalizado de subscriptions.trial_until para filtros RLS rápidos';

-- 2. Migrar paróquias existentes para plano premium + subscription ativa
-- (Paróquias existentes antes do SaaS recebem acesso total sem cobrança retroativa)
DO $$
DECLARE
  v_premium_id UUID;
  v_p          RECORD;
BEGIN
  SELECT id INTO v_premium_id FROM public.plans WHERE slug = 'premium';

  FOR v_p IN SELECT id FROM public.paroquias WHERE status = 'active' LOOP
    INSERT INTO public.subscriptions (
      paroquia_id, plan_id, status,
      current_period_start, current_period_end,
      gateway, price_brl, billing_cycle
    ) VALUES (
      v_p.id, v_premium_id, 'active',
      now(), now() + interval '1 year',
      'manual', 0, 'yearly'
    )
    ON CONFLICT (paroquia_id) DO NOTHING;
  END LOOP;
END;
$$;

-- Redefinição de paroquia_is_accessible() agora que paroquias.status existe
CREATE OR REPLACE FUNCTION public.paroquia_is_accessible()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
    OR
    NOT EXISTS (
      SELECT 1 FROM paroquias
      WHERE id = current_paroquia_id()
        AND status IN ('blocked', 'canceled', 'suspended')
    );
$$;
