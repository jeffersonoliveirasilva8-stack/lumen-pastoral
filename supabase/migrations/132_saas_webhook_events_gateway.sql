-- ── 132: SaaS — Tabelas de gateway e histórico de mudanças de plano ───────

-- Histórico de mudanças de plano
CREATE TABLE IF NOT EXISTS public.plan_change_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  UUID NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  old_plan_id  UUID REFERENCES public.plans(id),
  new_plan_id  UUID NOT NULL REFERENCES public.plans(id),
  changed_by   UUID REFERENCES auth.users(id),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_change_super_admin" ON public.plan_change_history
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "plan_change_own_read" ON public.plan_change_history
  FOR SELECT USING (paroquia_id = public.current_paroquia_id());

-- Alertas de cobrança enviados
CREATE TABLE IF NOT EXISTS public.subscription_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id    UUID NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  alert_type     TEXT NOT NULL CHECK (alert_type IN ('trial_7d','trial_3d','trial_1d','past_due_1d','past_due_7d','past_due_15d','past_due_30d','blocked')),
  sent_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to_email  TEXT,
  UNIQUE(paroquia_id, alert_type, sent_date)
);

ALTER TABLE public.subscription_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_alerts_super_admin" ON public.subscription_alerts
  FOR ALL USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'));
