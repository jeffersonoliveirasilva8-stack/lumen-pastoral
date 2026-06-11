-- ============================================================
-- PATCH_R — Tabela de logs de e-mail transacional
-- Data: 2026-06-11
-- Aplicar em: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Tabela principal ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         TEXT        NOT NULL,
  destinatario TEXT        NOT NULL,
  assunto      TEXT,
  status       TEXT        NOT NULL CHECK (status IN ('enviado', 'erro', 'fallback')),
  provider     TEXT,                          -- 'resend' | 'supabase_otp'
  provider_id  TEXT,                          -- ID de rastreamento do Resend
  erro         TEXT,                          -- mensagem de erro quando status = 'erro'
  paroquia     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.email_logs IS 'Log de todos os e-mails transacionais enviados pelo sistema';
COMMENT ON COLUMN public.email_logs.tipo         IS 'Template: ativacao_conta | reenvio_ativacao | reset_senha | boas_vindas';
COMMENT ON COLUMN public.email_logs.status       IS 'enviado = Resend OK | erro = falha no envio | fallback = OTP nativo usado';
COMMENT ON COLUMN public.email_logs.provider     IS 'Provedor usado: resend ou supabase_otp';
COMMENT ON COLUMN public.email_logs.provider_id  IS 'ID de rastreamento retornado pelo Resend';
COMMENT ON COLUMN public.email_logs.erro         IS 'Detalhes do erro quando status = erro';

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- DROP IF EXISTS garante idempotência em re-execuções
DROP POLICY IF EXISTS "email_logs_select_super_admin"  ON public.email_logs;
DROP POLICY IF EXISTS "email_logs_insert_service_role" ON public.email_logs;

-- Apenas super_admin pode consultar os logs
CREATE POLICY "email_logs_select_super_admin"
  ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- service_role (Edge Functions) insere sem restrição
-- (service_role bypassa RLS automaticamente, política explícita para clareza)
CREATE POLICY "email_logs_insert_service_role"
  ON public.email_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── Índices ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_email_logs_tipo         ON public.email_logs (tipo);
CREATE INDEX IF NOT EXISTS idx_email_logs_destinatario ON public.email_logs (destinatario);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at   ON public.email_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status       ON public.email_logs (status);
