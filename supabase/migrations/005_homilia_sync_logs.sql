-- 005_homilia_sync_logs.sql
-- Cria a tabela de logs de sincronização da Homilia Diária.
--
-- Esta migration é idempotente (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Pode ser executada em produção sem interrupção de serviço.

-- ── Extensão necessária ──────────────────────────────────────────────────────
-- gen_random_uuid() requer pgcrypto (já habilitado no Supabase por padrão)

-- ── Tabela ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homilia_sync_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  data_alvo  date        NOT NULL,
  sucesso    boolean     NOT NULL,
  erro       text,
  detalhes   jsonb,
  strategy   text,        -- 'janela_exata' | 'fallback_homilia_recente' | 'fallback_conteudo_pastoral'
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Compatibilidade: adiciona coluna caso tabela já existisse sem ela
ALTER TABLE public.homilia_sync_logs ADD COLUMN IF NOT EXISTS strategy text;

COMMENT ON TABLE  public.homilia_sync_logs                IS 'Registros de cada tentativa de sincronização automática da homilia diária.';
COMMENT ON COLUMN public.homilia_sync_logs.data_alvo      IS 'Data para a qual a sincronização foi tentada (fuso America/Sao_Paulo).';
COMMENT ON COLUMN public.homilia_sync_logs.sucesso        IS 'True se a chamada pg_net foi enfileirada sem erro; não confirma resposta da Edge Function.';
COMMENT ON COLUMN public.homilia_sync_logs.erro           IS 'Mensagem de erro PL/pgSQL em caso de falha.';
COMMENT ON COLUMN public.homilia_sync_logs.detalhes       IS 'Metadados extras, ex: {"pg_net_request_id": 123}.';
COMMENT ON COLUMN public.homilia_sync_logs.strategy       IS 'Estratégia de detecção usada pela Edge Function.';
COMMENT ON COLUMN public.homilia_sync_logs.created_at     IS 'Timestamp de quando a tentativa foi registrada.';

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS homilia_sync_logs_created_at_idx
  ON public.homilia_sync_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS homilia_sync_logs_data_alvo_idx
  ON public.homilia_sync_logs (data_alvo DESC);

CREATE INDEX IF NOT EXISTS homilia_sync_logs_sucesso_idx
  ON public.homilia_sync_logs (sucesso)
  WHERE sucesso = false;  -- índice parcial: acelera consultas de falhas

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.homilia_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "homilia_logs_admin_read" ON public.homilia_sync_logs;
CREATE POLICY "homilia_logs_admin_read"
  ON public.homilia_sync_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'super_admin')
    )
  );

-- ── Permissões ────────────────────────────────────────────────────────────────
GRANT SELECT          ON public.homilia_sync_logs TO authenticated;
GRANT ALL             ON public.homilia_sync_logs TO service_role;

-- ── Limpeza automática (retenção de 90 dias) ─────────────────────────────────
-- Roda via pg_cron: remove logs com mais de 90 dias para evitar crescimento ilimitado.
-- Pré-requisito: pg_cron habilitado (Dashboard → Database → Extensions).
SELECT cron.unschedule('homilia-sync-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-sync-logs-cleanup');

SELECT cron.schedule(
  'homilia-sync-logs-cleanup',
  '0 2 * * 0',   -- todo domingo às 02:00 UTC
  $$DELETE FROM public.homilia_sync_logs WHERE created_at < now() - INTERVAL '90 days'$$
);
