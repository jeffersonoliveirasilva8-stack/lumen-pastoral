-- ── 130: SaaS — Auditoria Global + Impersonate + RPCs Super Admin ─────────

-- 1. Tabela de auditoria da plataforma (complementa audit_logs por paróquia)
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES auth.users(id),
  actor_email   TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,                    -- 'paroquia' | 'subscription' | 'user' | 'plan'
  target_id     UUID,
  target_label  TEXT,
  old_value     JSONB,
  new_value     JSONB,
  ip_address    INET,
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_actor  ON public.platform_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_target ON public.platform_audit_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON public.platform_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_platform_audit_ts     ON public.platform_audit_logs(created_at DESC);

-- 2. Tabela de sessões de impersonação
CREATE TABLE IF NOT EXISTS public.impersonate_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id       UUID NOT NULL REFERENCES auth.users(id),
  target_paroquia_id   UUID NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  target_user_id       UUID NOT NULL REFERENCES auth.users(id),
  token                TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 hour',
  used_at              TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ,
  ip_address           INET,
  user_agent           TEXT,
  reason               TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonate_admin  ON public.impersonate_sessions(super_admin_id);
CREATE INDEX IF NOT EXISTS idx_impersonate_parq   ON public.impersonate_sessions(target_paroquia_id);

-- 3. Tabela de webhook events (pagamentos)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway             TEXT NOT NULL CHECK (gateway IN ('mercadopago','stripe','asaas')),
  event_type          TEXT NOT NULL,
  idempotency_key     TEXT UNIQUE NOT NULL,
  payload             JSONB NOT NULL,
  processed           BOOLEAN NOT NULL DEFAULT false,
  processed_at        TIMESTAMPTZ,
  processing_error    TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  related_paroquia_id UUID REFERENCES public.paroquias(id),
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.webhook_events(processed, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_gateway   ON public.webhook_events(gateway, event_type);

-- 4. RLS
ALTER TABLE public.platform_audit_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impersonate_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_audit_super_admin"  ON public.platform_audit_logs;
DROP POLICY IF EXISTS "impersonate_super_admin_only" ON public.impersonate_sessions;
DROP POLICY IF EXISTS "webhook_super_admin_only"    ON public.webhook_events;

CREATE POLICY "platform_audit_super_admin" ON public.platform_audit_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "impersonate_super_admin_only" ON public.impersonate_sessions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "webhook_super_admin_only" ON public.webhook_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- 5. RPC: métricas da plataforma para o dashboard do Super Admin
CREATE OR REPLACE FUNCTION public.saas_get_platform_metrics()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Apenas super_admin pode chamar
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT jsonb_build_object(
    'total_paroquias',       (SELECT COUNT(*) FROM paroquias),
    'paroquias_ativas',      (SELECT COUNT(*) FROM paroquias WHERE status = 'active'),
    'paroquias_trial',       (SELECT COUNT(*) FROM paroquias WHERE status = 'trial'),
    'paroquias_bloqueadas',  (SELECT COUNT(*) FROM paroquias WHERE status IN ('blocked','suspended')),
    'total_membros',         (SELECT COUNT(*) FROM membros WHERE ativo = true),
    'total_escalas',         (SELECT COUNT(*) FROM escalas),
    'escalas_publicadas',    (SELECT COUNT(*) FROM escalas WHERE status = 'publicada'),
    'total_substituicoes',   (SELECT COUNT(*) FROM substituicoes),
    'mrr_brl', (
      SELECT COALESCE(SUM(
        CASE billing_cycle
          WHEN 'monthly' THEN price_brl
          WHEN 'yearly'  THEN price_brl / 12
          ELSE 0
        END
      ), 0)
      FROM subscriptions
      WHERE status = 'active' AND gateway != 'manual'
    ),
    'arr_brl', (
      SELECT COALESCE(SUM(
        CASE billing_cycle
          WHEN 'monthly' THEN price_brl * 12
          WHEN 'yearly'  THEN price_brl
          ELSE 0
        END
      ), 0)
      FROM subscriptions
      WHERE status = 'active' AND gateway != 'manual'
    ),
    'inadimplentes', (SELECT COUNT(*) FROM subscriptions WHERE status = 'past_due'),
    'cancelamentos_30d', (
      SELECT COUNT(*) FROM subscriptions
      WHERE status = 'canceled' AND canceled_at >= now() - interval '30 days'
    ),
    'novos_30d', (
      SELECT COUNT(*) FROM paroquias
      WHERE created_at >= now() - interval '30 days'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 6. RPC: criar token de impersonação
CREATE OR REPLACE FUNCTION public.saas_create_impersonate_token(
  p_paroquia_id UUID,
  p_reason      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id UUID;
  v_token          TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 5 caracteres)';
  END IF;

  -- Pegar o admin principal da paróquia
  SELECT ur.user_id INTO v_target_user_id
  FROM user_roles ur
  WHERE ur.paroquia_id = p_paroquia_id
    AND ur.role IN ('admin_paroquial', 'coordenador')
  ORDER BY ur.created_at
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum administrador encontrado para esta paróquia';
  END IF;

  INSERT INTO impersonate_sessions (
    super_admin_id, target_paroquia_id, target_user_id, reason
  ) VALUES (
    auth.uid(), p_paroquia_id, v_target_user_id, p_reason
  )
  RETURNING token INTO v_token;

  -- Registrar em auditoria
  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, target_label, metadata)
  VALUES (
    auth.uid(), 'impersonate.created', 'paroquia', p_paroquia_id,
    (SELECT nome FROM paroquias WHERE id = p_paroquia_id),
    jsonb_build_object('reason', p_reason, 'target_user_id', v_target_user_id)
  );

  RETURN v_token;
END;
$$;

-- 7. RPC: suspender paróquia
CREATE OR REPLACE FUNCTION public.saas_suspend_paroquia(
  p_paroquia_id UUID,
  p_reason      TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE paroquias
  SET status = 'suspended', suspension_reason = p_reason, updated_at = now()
  WHERE id = p_paroquia_id;

  UPDATE subscriptions
  SET status = 'suspended', updated_at = now()
  WHERE paroquia_id = p_paroquia_id;

  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, target_label, new_value)
  VALUES (
    auth.uid(), 'paroquia.suspended', 'paroquia', p_paroquia_id,
    (SELECT nome FROM paroquias WHERE id = p_paroquia_id),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;

-- 8. RPC: bloquear paróquia (inadimplência grave)
CREATE OR REPLACE FUNCTION public.saas_block_paroquia(
  p_paroquia_id UUID,
  p_reason      TEXT DEFAULT 'Inadimplência superior a 30 dias'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE paroquias
  SET status = 'blocked', blocked_at = now(), updated_at = now()
  WHERE id = p_paroquia_id;

  UPDATE subscriptions
  SET status = 'blocked', updated_at = now()
  WHERE paroquia_id = p_paroquia_id;

  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, target_label, new_value)
  VALUES (
    auth.uid(), 'paroquia.blocked', 'paroquia', p_paroquia_id,
    (SELECT nome FROM paroquias WHERE id = p_paroquia_id),
    jsonb_build_object('reason', p_reason, 'blocked_at', now())
  );
END;
$$;

-- 9. RPC: trocar plano
CREATE OR REPLACE FUNCTION public.saas_change_plan(
  p_paroquia_id  UUID,
  p_new_plan_slug TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_plan_id UUID;
  v_old_plan_slug TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT id INTO v_new_plan_id FROM plans WHERE slug = p_new_plan_slug AND ativo = true;
  IF v_new_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plano inválido: %', p_new_plan_slug;
  END IF;

  SELECT p.slug INTO v_old_plan_slug
  FROM subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.paroquia_id = p_paroquia_id;

  UPDATE subscriptions
  SET plan_id = v_new_plan_id, updated_at = now()
  WHERE paroquia_id = p_paroquia_id;

  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, old_value, new_value)
  VALUES (
    auth.uid(), 'subscription.plan_changed', 'paroquia', p_paroquia_id,
    jsonb_build_object('plan', v_old_plan_slug),
    jsonb_build_object('plan', p_new_plan_slug, 'reason', p_reason)
  );
END;
$$;

-- 10. RPC: reprocessar webhook
CREATE OR REPLACE FUNCTION public.saas_reprocess_webhook(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE webhook_events
  SET processed = false, processing_error = NULL, retry_count = retry_count + 1
  WHERE id = p_event_id;
END;
$$;

-- 11. Corrigir bug em admin_deletar_paroquia (lia profiles.role que não existe)
DROP FUNCTION IF EXISTS public.admin_deletar_paroquia(UUID);
CREATE OR REPLACE FUNCTION public.admin_deletar_paroquia(p_paroquia_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Apenas super_admin pode deletar paróquias';
  END IF;

  DELETE FROM paroquias WHERE id = p_paroquia_id;

  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id)
  VALUES (auth.uid(), 'paroquia.deleted', 'paroquia', p_paroquia_id);
END;
$$;

-- 12. Reescrever aprovação de paróquia para realmente criar a paróquia
CREATE OR REPLACE FUNCTION public.saas_approve_paroquia(
  p_solicitacao_id UUID,
  p_plan_slug      TEXT DEFAULT 'premium',
  p_trial_dias     INTEGER DEFAULT 30
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol       RECORD;
  v_plan_id   UUID;
  v_paroquia_id UUID;
  v_trial_end TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_sol FROM solicitacoes_paroquia WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF v_sol.status = 'aprovada' THEN RAISE EXCEPTION 'Solicitação já aprovada'; END IF;

  SELECT id INTO v_plan_id FROM plans WHERE slug = p_plan_slug AND ativo = true;
  IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Plano inválido: %', p_plan_slug; END IF;

  v_trial_end := now() + (p_trial_dias || ' days')::interval;

  -- Criar a paróquia
  INSERT INTO paroquias (nome, diocese, cidade, contato_email, contato_telefone, status, trial_until, slug)
  VALUES (
    v_sol.nome_paroquia,
    v_sol.diocese,
    v_sol.cidade,
    v_sol.email,
    v_sol.telefone,
    'trial',
    v_trial_end,
    lower(regexp_replace(v_sol.nome_paroquia, '[^a-zA-Z0-9]+', '-', 'g'))
  )
  RETURNING id INTO v_paroquia_id;

  -- Criar a subscription de trial
  INSERT INTO subscriptions (paroquia_id, plan_id, status, trial_until)
  VALUES (v_paroquia_id, v_plan_id, 'trial', v_trial_end);

  -- Atualizar status da solicitação
  UPDATE solicitacoes_paroquia
  SET status = 'aprovada', analisado_por = auth.uid(), analisado_em = now()
  WHERE id = p_solicitacao_id;

  -- Auditoria
  INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  VALUES (
    auth.uid(), 'paroquia.approved', 'paroquia', v_paroquia_id,
    jsonb_build_object('plan', p_plan_slug, 'trial_dias', p_trial_dias, 'solicitacao_id', p_solicitacao_id)
  );

  RETURN v_paroquia_id;
END;
$$;
