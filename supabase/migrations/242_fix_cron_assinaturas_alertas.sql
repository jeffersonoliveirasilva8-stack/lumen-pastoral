-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 242 — Jobs 53 (check-subscriptions-daily) e 54 (send-billing-alerts-daily)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Erro nos dois jobs desde 05/08/2026 (112 falhas seguidas):
--   unrecognized configuration parameter "app.supabase_url"
-- Causa: o comando (migration 133) usa current_setting('app.supabase_url') e
--   current_setting('app.service_role_key') sem missing_ok. Esses GUCs nunca
--   existiram em produção (ALTER DATABASE exige superuser no Supabase Cloud).
--
-- Correção do comando (os dois jobs): URL via public._edge_fn_url() e Bearer via
--   public._cfg_anon_key() (migration 092), o mesmo padrão do job 59 e da
--   migration 241. Nenhuma service_role no cron: as Edge Functions já usam a
--   service role do próprio ambiente.
--
-- DECISÃO DE NEGÓCIO (Jeff, 24/11/2026): NÃO reativar a suspensão/bloqueio
--   automático de paróquias. O job 53 recebe o comando corrigido mas fica
--   INATIVO (active = false). check-subscriptions suspende e bloqueia paróquias
--   (trial vencido → past_due; past_due > 7 d → suspended; suspended > 15 d →
--   blocked); reativar só com decisão explícita:
--     SELECT cron.alter_job((SELECT jobid FROM cron.job
--                            WHERE jobname = 'check-subscriptions-daily'), active := true);
--
-- Job 54 (06:00 Brasília) volta a rodar. A função só registra em
--   subscription_alerts e escreve no log; não envia e-mail.
--
-- IDEMPOTENTE: sim. Não altera nenhum outro job. Horários inalterados
--   (UTC: 02:00 e 09:00; 23:00 e 06:00 em America/Sao_Paulo).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Job 53: comando corrigido, mantido INATIVO ────────────────────────────────
DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'check-subscriptions-daily';
  IF v_id IS NULL THEN
    RAISE NOTICE 'job check-subscriptions-daily não existe; nada a fazer';
  ELSE
    PERFORM cron.alter_job(
      job_id   := v_id,
      schedule := '0 2 * * *',
      command  := $cmd$
  SELECT net.http_post(
    url     := public._edge_fn_url('check-subscriptions'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public._cfg_anon_key()
    ),
    body    := '{}'::jsonb
  );
  $cmd$,
      active   := false
    );
  END IF;
END $$;

-- ── Job 54: comando corrigido, ATIVO ──────────────────────────────────────────
SELECT cron.schedule(
  'send-billing-alerts-daily',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url     := public._edge_fn_url('send-billing-alerts'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public._cfg_anon_key()
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
