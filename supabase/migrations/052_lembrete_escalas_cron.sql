-- migration 052 — Cron diário de lembrete de escalas
-- Agenda chamada às 08:00 BRT (11:00 UTC) para enviar e-mails de lembrete
-- a membros com escalas amanhã ou depois de amanhã.

SELECT cron.schedule(
  'lembrete-escalas-diario',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/lembrete-escalas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
