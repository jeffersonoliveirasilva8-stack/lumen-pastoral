-- ============================================================
-- CRON_HOMILIA_SETUP.sql
-- Agenda busca automática diária da Homilia do Padre Paulo Ricardo
-- via Edge Function homilia-diaria.
--
-- PRÉ-REQUISITO: Ativar pg_cron via Dashboard → Database → Extensions
-- ============================================================

-- Remover agenda existente se houver (idempotente)
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'homilia-diaria-sync';

-- Agenda: 03:30 UTC (pouco depois da liturgia-diaria que roda às 02:30)
SELECT cron.schedule(
  'homilia-diaria-sync',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verificar se foi agendado
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'homilia-diaria-sync';

-- ============================================================
-- AGENDA RESUMIDA:
--   02:30 UTC → liturgia-diaria (leituras)
--   03:30 UTC → homilia-diaria  (YouTube)
-- ============================================================
