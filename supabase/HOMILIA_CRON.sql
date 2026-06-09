-- ============================================================
-- HOMILIA DIÁRIA — CRON AUTOMÁTICO
-- Execute no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/hbbkdebuhueqjyrdeyyc/sql/new
--
-- Pré-requisitos:
--   1. pg_cron habilitado (Settings → Extensions)
--   2. pg_net  habilitado (Settings → Extensions)
--   3. SUPABASE_URL e SERVICE_ROLE_KEY configurados
-- ============================================================

-- ── 1. Tabela de logs para auditoria ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homilia_sync_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em timestamptz NOT NULL DEFAULT now(),
  data_alvo   date        NOT NULL,
  sucesso     boolean     NOT NULL,
  detalhes    jsonb,
  erro        text
);

-- RLS: somente admins leem
ALTER TABLE public.homilia_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin lê logs homilia" ON public.homilia_sync_logs;
CREATE POLICY "admin lê logs homilia"
  ON public.homilia_sync_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin_paroquial', 'super_admin')
    )
  );

GRANT SELECT ON public.homilia_sync_logs TO authenticated;
GRANT ALL    ON public.homilia_sync_logs TO service_role;

-- ── 2. Função que chama a Edge Function via pg_net ────────────────────
-- ATENÇÃO: Substitua <PROJECT_REF> pelo ID do projeto Supabase
--          e <SERVICE_ROLE_KEY> pela chave service_role
CREATE OR REPLACE FUNCTION public.sync_homilia_diaria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    text := 'https://hbbkdebuhueqjyrdeyyc.supabase.co/functions/v1/homilia-diaria';
  v_key    text := current_setting('app.service_role_key', true);
  v_req_id bigint;
BEGIN
  -- Dispara chamada HTTP assíncrona via pg_net
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('date', to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'))
  ) INTO v_req_id;

  -- Registra na tabela de logs
  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, detalhes)
  VALUES (
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    true,
    jsonb_build_object('request_id', v_req_id)
  );

EXCEPTION WHEN others THEN
  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, erro)
  VALUES (
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    false,
    SQLERRM
  );
END;
$$;

-- ── 3. Configura a chave service_role como parâmetro do banco ─────────
-- Execute UMA VEZ com a sua service_role key real:
-- ALTER DATABASE postgres SET app.service_role_key = 'eyJhbGciOiJIUzI1NiI...';

-- ── 4. Agenda o cron — todo dia às 10:00 UTC (07:00 horário de Brasília) ──
SELECT cron.unschedule('homilia-diaria-sync') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-sync'
);

SELECT cron.schedule(
  'homilia-diaria-sync',
  '0 10 * * *',
  'SELECT public.sync_homilia_diaria()'
);

-- ── 5. Segunda execução às 13:00 UTC (10:00 Brasília) como fallback ──
SELECT cron.unschedule('homilia-diaria-fallback') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-fallback'
);

SELECT cron.schedule(
  'homilia-diaria-fallback',
  '0 13 * * *',
  $$
  DO $$
  BEGIN
    -- Só executa se ainda não houver homilia de hoje
    IF NOT EXISTS (
      SELECT 1 FROM public.homilias_diarias
      WHERE data = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ) THEN
      PERFORM public.sync_homilia_diaria();
    END IF;
  END;
  $$ LANGUAGE plpgsql;
  $$
);

-- ── Verificação ───────────────────────────────────────────────────────
-- Para verificar os jobs agendados:
-- SELECT * FROM cron.job;
--
-- Para ver logs:
-- SELECT * FROM public.homilia_sync_logs ORDER BY executado_em DESC LIMIT 20;
--
-- Para executar manualmente:
-- SELECT public.sync_homilia_diaria();
