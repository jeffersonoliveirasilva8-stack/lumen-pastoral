-- Agenda os Edge Functions como cron jobs via pg_cron
-- NOTA: requer pg_cron extension habilitada no projeto Supabase

-- Verificar assinaturas diariamente às 2h UTC
SELECT cron.schedule(
  'check-subscriptions-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-subscriptions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Enviar alertas de cobrança às 9h UTC
SELECT cron.schedule(
  'send-billing-alerts-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/send-billing-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
