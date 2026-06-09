-- ============================================================
-- LUMEN PASTORAL — PATCH C: Homilia Cron sem service_role_key
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
--
-- Problema: ALTER DATABASE não é permitido no Supabase via SQL Editor.
-- Solução: usa a anon key (chave pública, já no .env do frontend)
--   como Bearer token para chamar a Edge Function via pg_net.
--   A Edge Function tem verify_jwt=false e aceita qualquer JWT válido.
-- ============================================================

-- PRÉ-REQUISITO: pg_net deve estar habilitado
--   Dashboard → Database → Extensions → pg_net → Enable

-- ── Função principal ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_homilia_diaria()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $func$
DECLARE
  v_url    text    := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria';
  -- Anon key: chave pública, segura para uso aqui (já está no .env do cliente)
  v_anon   text    := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I';
  v_req_id bigint;
  v_hoje   date    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
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

-- ── Função fallback ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_homilia_se_ausente()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $func$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.homilias_diarias WHERE data = v_hoje) THEN
    PERFORM public.sync_homilia_diaria();
  END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.sync_homilia_diaria()     TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_homilia_se_ausente() TO service_role;

-- ── Cron jobs ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('homilia-diaria-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-sync');
SELECT cron.schedule('homilia-diaria-sync', '0 10 * * *',
  'SELECT public.sync_homilia_diaria()');

SELECT cron.unschedule('homilia-diaria-fallback')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-fallback');
SELECT cron.schedule('homilia-diaria-fallback', '0 13 * * *',
  'SELECT public.sync_homilia_se_ausente()');

SELECT cron.unschedule('homilia-diaria-tarde')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-tarde');
SELECT cron.schedule('homilia-diaria-tarde', '0 19 * * *',
  'SELECT public.sync_homilia_se_ausente()');

-- ── Teste imediato ────────────────────────────────────────────────────────
-- Após executar, rode:
--
--   SELECT public.sync_homilia_diaria();
--
-- Aguarde ~5 segundos e verifique:
--
--   SELECT * FROM public.homilia_sync_logs ORDER BY executado_em DESC LIMIT 3;
--   SELECT id, status, response_status FROM net._http_response ORDER BY id DESC LIMIT 3;
--
-- Se response_status = 200 → funcionou
-- Se response_status = 401 → vá em Dashboard → Edge Functions → homilia-diaria
--                             → Settings → desative "Require JWT Verification"
