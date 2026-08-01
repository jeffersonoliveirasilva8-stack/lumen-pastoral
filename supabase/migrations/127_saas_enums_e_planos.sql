-- ── 127: SaaS — Enums, Planos e Feature Flags ─────────────────────────────

-- 1. ENUM para status de assinatura
DO $$ BEGIN
  CREATE TYPE sub_status AS ENUM (
    'trial', 'active', 'past_due', 'suspended', 'canceled', 'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

-- 2. Tabela de planos
CREATE TABLE IF NOT EXISTS public.plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  preco_mensal  NUMERIC(10,2),
  preco_anual   NUMERIC(10,2),
  max_membros   INTEGER,          -- NULL = ilimitado
  max_coordenadores INTEGER,      -- NULL = ilimitado
  trial_dias    INTEGER NOT NULL DEFAULT 30,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  destaque      BOOLEAN NOT NULL DEFAULT false,
  ordem         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Feature flags por plano
CREATE TABLE IF NOT EXISTS public.plan_features (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  limit_value INTEGER,            -- NULL = sem limite numérico
  UNIQUE(plan_id, feature_key)
);

-- 4. RLS
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_public_read"            ON public.plans;
DROP POLICY IF EXISTS "plans_super_admin_write"      ON public.plans;
DROP POLICY IF EXISTS "plan_features_public_read"    ON public.plan_features;
DROP POLICY IF EXISTS "plan_features_super_admin_w"  ON public.plan_features;

CREATE POLICY "plans_public_read" ON public.plans
  FOR SELECT USING (true);

CREATE POLICY "plans_super_admin_write" ON public.plans
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "plan_features_public_read" ON public.plan_features
  FOR SELECT USING (true);

CREATE POLICY "plan_features_super_admin_w" ON public.plan_features
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- 5. Seed dos 4 planos
INSERT INTO public.plans (slug, nome, descricao, preco_mensal, preco_anual, max_membros, max_coordenadores, trial_dias, ativo, destaque, ordem) VALUES
  ('gratuito',   'Gratuito',   'Para paróquias pequenas que estão começando',    0,      0,       20,   1,    30, true, false, 0),
  ('essencial',  'Essencial',  'Para paróquias em crescimento',                  49.90,  499.00,  80,   3,    30, true, false, 1),
  ('premium',    'Premium',    'Para paróquias com equipe litúrgica completa',   99.90,  999.00,  NULL, NULL, 30, true, true,  2),
  ('enterprise', 'Enterprise', 'Para dioceses e múltiplas unidades',             249.90, 2499.00, NULL, NULL, 30, true, false, 3)
ON CONFLICT (slug) DO NOTHING;

-- 6. Seed de features por plano
DO $$
DECLARE
  v_gratuito   UUID;
  v_essencial  UUID;
  v_premium    UUID;
  v_enterprise UUID;
BEGIN
  SELECT id INTO v_gratuito   FROM public.plans WHERE slug = 'gratuito';
  SELECT id INTO v_essencial  FROM public.plans WHERE slug = 'essencial';
  SELECT id INTO v_premium    FROM public.plans WHERE slug = 'premium';
  SELECT id INTO v_enterprise FROM public.plans WHERE slug = 'enterprise';

  -- Gratuito: funcionalidades básicas, sem portal nem substituições
  INSERT INTO public.plan_features (plan_id, feature_key, enabled, limit_value) VALUES
    (v_gratuito, 'escalas_basicas',    true,  NULL),
    (v_gratuito, 'motor_inteligente',  false, NULL),
    (v_gratuito, 'portal_membro',      false, NULL),
    (v_gratuito, 'substituicoes',      false, NULL),
    (v_gratuito, 'sacristia',          true,  NULL),
    (v_gratuito, 'relatorio_basico',   true,  NULL),
    (v_gratuito, 'relatorio_avancado', false, NULL),
    (v_gratuito, 'notificacoes',       true,  50),
    (v_gratuito, 'auditoria',          false, NULL),
    (v_gratuito, 'export_dados',       true,  NULL),
    (v_gratuito, 'api_acesso',         false, NULL),
    (v_gratuito, 'multi_unidade',      false, NULL)
  ON CONFLICT (plan_id, feature_key) DO NOTHING;

  -- Essencial: portal + substituições, sem motor e sem relatório avançado
  INSERT INTO public.plan_features (plan_id, feature_key, enabled, limit_value) VALUES
    (v_essencial, 'escalas_basicas',    true,  NULL),
    (v_essencial, 'motor_inteligente',  false, NULL),
    (v_essencial, 'portal_membro',      true,  NULL),
    (v_essencial, 'substituicoes',      true,  NULL),
    (v_essencial, 'sacristia',          true,  NULL),
    (v_essencial, 'relatorio_basico',   true,  NULL),
    (v_essencial, 'relatorio_avancado', false, NULL),
    (v_essencial, 'notificacoes',       true,  500),
    (v_essencial, 'auditoria',          false, NULL),
    (v_essencial, 'export_dados',       true,  NULL),
    (v_essencial, 'api_acesso',         false, NULL),
    (v_essencial, 'multi_unidade',      false, NULL)
  ON CONFLICT (plan_id, feature_key) DO NOTHING;

  -- Premium: tudo incluído exceto API e multi-unidade
  INSERT INTO public.plan_features (plan_id, feature_key, enabled, limit_value) VALUES
    (v_premium, 'escalas_basicas',    true, NULL),
    (v_premium, 'motor_inteligente',  true, NULL),
    (v_premium, 'portal_membro',      true, NULL),
    (v_premium, 'substituicoes',      true, NULL),
    (v_premium, 'sacristia',          true, NULL),
    (v_premium, 'relatorio_basico',   true, NULL),
    (v_premium, 'relatorio_avancado', true, NULL),
    (v_premium, 'notificacoes',       true, NULL),
    (v_premium, 'auditoria',          true, NULL),
    (v_premium, 'export_dados',       true, NULL),
    (v_premium, 'api_acesso',         false, NULL),
    (v_premium, 'multi_unidade',      false, NULL)
  ON CONFLICT (plan_id, feature_key) DO NOTHING;

  -- Enterprise: sem limites
  INSERT INTO public.plan_features (plan_id, feature_key, enabled, limit_value) VALUES
    (v_enterprise, 'escalas_basicas',    true, NULL),
    (v_enterprise, 'motor_inteligente',  true, NULL),
    (v_enterprise, 'portal_membro',      true, NULL),
    (v_enterprise, 'substituicoes',      true, NULL),
    (v_enterprise, 'sacristia',          true, NULL),
    (v_enterprise, 'relatorio_basico',   true, NULL),
    (v_enterprise, 'relatorio_avancado', true, NULL),
    (v_enterprise, 'notificacoes',       true, NULL),
    (v_enterprise, 'auditoria',          true, NULL),
    (v_enterprise, 'export_dados',       true, NULL),
    (v_enterprise, 'api_acesso',         true, NULL),
    (v_enterprise, 'multi_unidade',      true, NULL)
  ON CONFLICT (plan_id, feature_key) DO NOTHING;
END;
$$;
