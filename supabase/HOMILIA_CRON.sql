-- ============================================================
-- HOMILIA DIÁRIA — CRON AUTOMÁTICO v2
-- Execute no SQL Editor do Supabase
--
-- PRÉ-REQUISITOS (fazer antes de executar este script):
--   1. Extensions habilitadas: pg_cron + pg_net
--      Dashboard → Database → Extensions → ativar ambas
--
--   2. Configurar a service_role key como parâmetro do banco:
--      Copie a "service_role key" em Dashboard → Settings → API
--      Execute UMA VEZ no SQL Editor:
--
--      ALTER DATABASE postgres
--        SET app.service_role_key = 'eyJhbGciOiJIUzI1NiI...sua_chave_aqui...';
--
--   3. Fazer deploy da Edge Function:
--      supabase functions deploy homilia-diaria
-- ============================================================

-- ── 1. Tabela de logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homilia_sync_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em  timestamptz NOT NULL DEFAULT now(),
  data_alvo     date        NOT NULL,
  sucesso       boolean     NOT NULL,
  strategy      text,
  detalhes      jsonb,
  erro          text
);

ALTER TABLE public.homilia_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "homilia_logs_admin_read" ON public.homilia_sync_logs;
CREATE POLICY "homilia_logs_admin_read"
  ON public.homilia_sync_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'super_admin')
    )
  );

GRANT SELECT ON public.homilia_sync_logs TO authenticated;
GRANT ALL    ON public.homilia_sync_logs TO service_role;

-- ── 2. Função principal de sincronização ─────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_homilia_diaria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_url    text;
  v_key    text;
  v_req_id bigint;
  v_hoje   date;
BEGIN
  v_url  := 'https://hbbkdebuhueqjyrdeyyc.supabase.co/functions/v1/homilia-diaria';
  v_key  := current_setting('app.service_role_key', true);
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING '[homilia-diaria] app.service_role_key não configurado';
    INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, erro)
    VALUES (v_hoje, false, 'app.service_role_key não configurado');
    RETURN;
  END IF;

  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('date', to_char(v_hoje, 'YYYY-MM-DD'))
  ) INTO v_req_id;

  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, detalhes)
  VALUES (v_hoje, true, jsonb_build_object('pg_net_request_id', v_req_id));

EXCEPTION WHEN others THEN
  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, erro)
  VALUES (v_hoje, false, SQLERRM);
END;
$func$;

-- ── 3. Função fallback — só executa se hoje ainda não tiver homilia ───
CREATE OR REPLACE FUNCTION public.sync_homilia_se_ausente()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.homilias_diarias WHERE data = v_hoje
  ) THEN
    PERFORM public.sync_homilia_diaria();
  END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.sync_homilia_diaria()    TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_homilia_se_ausente() TO service_role;

-- ── 4. Cron principal — 07:00 Brasília (10:00 UTC) ───────────────────
SELECT cron.unschedule('homilia-diaria-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-sync');

SELECT cron.schedule(
  'homilia-diaria-sync',
  '0 10 * * *',
  'SELECT public.sync_homilia_diaria()'
);

-- ── 5. Cron fallback — 10:00 Brasília (13:00 UTC) ────────────────────
-- Só dispara se a execução das 10h falhou ou não encontrou vídeo
SELECT cron.unschedule('homilia-diaria-fallback')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-fallback');

SELECT cron.schedule(
  'homilia-diaria-fallback',
  '0 13 * * *',
  'SELECT public.sync_homilia_se_ausente()'
);

-- ── 6. Cron terceiro disparo — 16:00 Brasília (19:00 UTC) ────────────
-- Para canais que postam homilia à tarde
SELECT cron.unschedule('homilia-diaria-tarde')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-tarde');

SELECT cron.schedule(
  'homilia-diaria-tarde',
  '0 19 * * *',
  'SELECT public.sync_homilia_se_ausente()'
);

-- ── Verificação ───────────────────────────────────────────────────────
-- Jobs agendados:
--   SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
--
-- Testar manualmente:
--   SELECT public.sync_homilia_diaria();
--
-- Ver logs:
--   SELECT * FROM public.homilia_sync_logs ORDER BY executado_em DESC LIMIT 20;
--
-- Ver resultado pg_net:
--   SELECT id, status, response FROM net._http_response ORDER BY id DESC LIMIT 5;
