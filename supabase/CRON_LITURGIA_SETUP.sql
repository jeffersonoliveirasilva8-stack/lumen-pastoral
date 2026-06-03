-- ============================================================
-- CRON_LITURGIA_SETUP.sql
-- Configura atualização automática diária da liturgia via
-- Supabase pg_cron + pg_net → chama a Edge Function liturgia-diaria
--
-- Executar no Supabase Dashboard → SQL Editor
-- Substitua eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I pela sua chave pública (Settings → API)
-- ============================================================

-- 1. Habilitar extensões (pg_net já vem habilitado no Supabase)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remover cron existente se houver (idempotente)
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'liturgia-diaria-sync';

-- 3. Agendar para 02:30 UTC diariamente
--    • days=3 → busca hoje + amanhã + depois = buffer de 3 dias
--    • Rode "SELECT cron.job_run_details" para monitorar execuções
SELECT cron.schedule(
  'liturgia-diaria-sync',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/liturgia-diaria?days=3',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Verificar se foi agendado
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'liturgia-diaria-sync';

-- ============================================================
-- EXECUÇÃO MANUAL (teste imediato)
-- ============================================================
-- Para testar agora sem esperar o cron, execute:
--
-- SELECT net.http_post(
--   url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/liturgia-diaria?days=7',
--   headers := jsonb_build_object(
--     'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
--     'Content-Type',  'application/json'
--   ),
--   body    := '{}'::jsonb
-- );
--
-- Ou via curl:
-- curl -X GET \
--   "https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/liturgia-diaria?days=7" \
--   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I"
-- ============================================================

-- 5. Monitoramento — últimas execuções do cron
-- SELECT * FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'liturgia-diaria-sync')
-- ORDER BY start_time DESC
-- LIMIT 10;
