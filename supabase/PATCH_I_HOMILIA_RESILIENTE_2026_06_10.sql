-- ============================================================
-- LUMEN PASTORAL — PATCH I: Homilia Diária Resiliente
-- Data: 2026-06-10
-- Projeto: cusuoggmlhtvrclrzvfr
--
-- PROBLEMA CORRIGIDO:
--   sync_homilia_diaria() falhava com:
--     ERROR: relation public.homilia_sync_logs does not exist
--   porque a tabela não havia sido criada, e o bloco EXCEPTION
--   tentava inserir na mesma tabela ausente — propagando o erro.
--
-- CORREÇÕES APLICADAS:
--   1. Cria a tabela homilia_sync_logs (IF NOT EXISTS — idempotente)
--   2. Armazena a anon key no Supabase Vault (criptografada em repouso)
--      — remove a chave hardcoded do código SQL para facilitar rotações.
--   3. Torna o logging NÃO-BLOQUEANTE: a sincronização ocorre mesmo
--      que a tabela de logs esteja ausente ou com falha.
--   4. Redefine cron jobs (idempotente).
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar este arquivo.
--
-- PRÉ-REQUISITOS:
--   - pg_cron habilitado  (Dashboard → Database → Extensions)
--   - pg_net  habilitado  (Dashboard → Database → Extensions)
--   - Edge Function homilia-diaria deployada com verify_jwt = false
-- ============================================================

-- ── 1. Tabela homilia_sync_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homilia_sync_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  data_alvo  date        NOT NULL,
  sucesso    boolean     NOT NULL,
  erro       text,
  detalhes   jsonb,
  strategy   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Adiciona coluna strategy caso a tabela já existisse sem ela (criada por patch anterior)
ALTER TABLE public.homilia_sync_logs ADD COLUMN IF NOT EXISTS strategy text;

COMMENT ON TABLE public.homilia_sync_logs
  IS 'Logs de sincronização da homilia diária — não-bloqueante, crescimento limitado a 90 dias.';

ALTER TABLE public.homilia_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "homilia_logs_admin_read" ON public.homilia_sync_logs;
CREATE POLICY "homilia_logs_admin_read"
  ON public.homilia_sync_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'super_admin')
    )
  );

CREATE INDEX IF NOT EXISTS homilia_sync_logs_created_at_idx
  ON public.homilia_sync_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS homilia_sync_logs_data_alvo_idx
  ON public.homilia_sync_logs (data_alvo DESC);

CREATE INDEX IF NOT EXISTS homilia_sync_logs_falhas_idx
  ON public.homilia_sync_logs (sucesso) WHERE sucesso = false;

GRANT SELECT ON public.homilia_sync_logs TO authenticated;
GRANT ALL    ON public.homilia_sync_logs TO service_role;

-- ── 2. Armazenar anon key no Vault (executar UMA vez ou a cada rotação) ─────
--
-- O Vault criptografa o valor em repouso usando pgsodium.
-- Para rotacionar a chave: re-execute apenas este bloco com o novo valor.
--
DO $$
BEGIN
  -- Remove entrada anterior se existir (idempotente)
  DELETE FROM vault.secrets WHERE name = 'homilia_anon_key';

  -- Armazena a anon key atual
  PERFORM vault.create_secret(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
    'homilia_anon_key',
    'Anon key pública do Supabase — usada por sync_homilia_diaria via pg_net'
  );
END $$;

-- Verificar: SELECT name, description FROM vault.secrets WHERE name = 'homilia_anon_key';

-- ── 3. Função principal — RESILIENTE ────────────────────────────────────────
--
-- Princípio: a homilia SEMPRE é sincronizada, mesmo que o log falhe.
-- Logging é opcional e nunca interrompe a execução.
-- A anon key é lida do Vault a cada execução — sem hardcoding no código SQL.
--
CREATE OR REPLACE FUNCTION public.sync_homilia_diaria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_url    text := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria';
  v_anon   text;
  v_req_id bigint;
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_erro   text;
BEGIN

  -- ── Etapa 0: Ler anon key do Vault ──────────────────────────────────────
  SELECT decrypted_secret INTO v_anon
  FROM vault.decrypted_secrets
  WHERE name = 'homilia_anon_key';

  IF v_anon IS NULL THEN
    RAISE EXCEPTION '[homilia] Secret "homilia_anon_key" não encontrado no Vault. '
      'Execute o bloco DO $$ vault.create_secret(...) $$ deste patch.';
  END IF;

  -- ── Etapa 1: Sincronização (crítica) ────────────────────────────────────
  -- pg_net enfileira a chamada HTTP de forma assíncrona.
  -- sucesso aqui = requisição enfileirada, não resposta HTTP confirmada.
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body    := jsonb_build_object('date', to_char(v_hoje, 'YYYY-MM-DD'))
  ) INTO v_req_id;

  -- ── Etapa 2: Log de sucesso (não-bloqueante) ────────────────────────────
  BEGIN
    INSERT INTO public.homilia_sync_logs (data_alvo, sucesso, detalhes)
    VALUES (
      v_hoje,
      true,
      jsonb_build_object('pg_net_request_id', v_req_id)
    );
  EXCEPTION WHEN others THEN
    -- Tabela ausente ou outra falha de log → apenas aviso, sincronização já foi disparada
    RAISE WARNING '[homilia] Log de sucesso falhou (ignorado): %', SQLERRM;
  END;

EXCEPTION WHEN others THEN
  -- A chamada pg_net falhou — captura o erro antes de qualquer outra operação
  v_erro := SQLERRM;

  -- ── Etapa 2-E: Log de falha (também não-bloqueante) ──────────────────
  BEGIN
    INSERT INTO public.homilia_sync_logs (data_alvo, sucesso, erro)
    VALUES (v_hoje, false, v_erro);
  EXCEPTION WHEN others THEN
    RAISE WARNING '[homilia] Log de falha também falhou (ignorado): %', SQLERRM;
  END;

  -- Emite RAISE WARNING (não ERROR) para não quebrar o cron
  RAISE WARNING '[homilia] sync_homilia_diaria falhou em %: %', v_hoje, v_erro;

END;
$func$;

COMMENT ON FUNCTION public.sync_homilia_diaria()
  IS 'Dispara a Edge Function homilia-diaria via pg_net. Logging não-bloqueante: falha de log não impede a sincronização.';

-- ── 4. Função fallback — resiliente ─────────────────────────────────────────
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
EXCEPTION WHEN others THEN
  -- Nunca deixa o cron falhar
  RAISE WARNING '[homilia] sync_homilia_se_ausente falhou em %: %', v_hoje, SQLERRM;
END;
$func$;

COMMENT ON FUNCTION public.sync_homilia_se_ausente()
  IS 'Fallback: dispara sync_homilia_diaria() somente se ainda não houver homilia registrada para hoje.';

-- ── 5. Permissões ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.sync_homilia_diaria()     TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_homilia_se_ausente() TO service_role;

-- ── 6. Cron jobs (idempotente) ────────────────────────────────────────────────
--
--   Horário Brasília → UTC
--   07:00 → 10:00 UTC   (disparo principal)
--   10:00 → 13:00 UTC   (fallback manhã)
--   16:00 → 19:00 UTC   (fallback tarde — canais que postam à tarde)
--

SELECT cron.unschedule('homilia-diaria-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-sync');
SELECT cron.schedule(
  'homilia-diaria-sync',
  '0 10 * * *',
  'SELECT public.sync_homilia_diaria()'
);

SELECT cron.unschedule('homilia-diaria-fallback')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-fallback');
SELECT cron.schedule(
  'homilia-diaria-fallback',
  '0 13 * * *',
  'SELECT public.sync_homilia_se_ausente()'
);

SELECT cron.unschedule('homilia-diaria-tarde')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-tarde');
SELECT cron.schedule(
  'homilia-diaria-tarde',
  '0 19 * * *',
  'SELECT public.sync_homilia_se_ausente()'
);

-- ── 7. Cleanup automático de logs (retenção 90 dias) ─────────────────────────
SELECT cron.unschedule('homilia-sync-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-sync-logs-cleanup');
SELECT cron.schedule(
  'homilia-sync-logs-cleanup',
  '0 2 * * 0',  -- todo domingo às 02:00 UTC
  $$DELETE FROM public.homilia_sync_logs WHERE created_at < now() - INTERVAL '90 days'$$
);

-- ── 8. Verificação final ──────────────────────────────────────────────────────
--
-- Execute os blocos abaixo para confirmar que tudo está correto:
--
-- A) Testar a função manualmente:
--
--   SELECT public.sync_homilia_diaria();
--
-- B) Verificar se o log foi criado (aguarde ~1 segundo):
--
--   SELECT id, data_alvo, sucesso, erro, created_at
--   FROM public.homilia_sync_logs
--   ORDER BY created_at DESC
--   LIMIT 5;
--
-- C) Verificar resultado real da chamada HTTP (~5 segundos após A):
--
--   SELECT id, status, response_status, error_msg
--   FROM net._http_response
--   ORDER BY id DESC
--   LIMIT 3;
--
--   response_status = 200  → Edge Function executou com sucesso
--   response_status = 401  → desative "Require JWT Verification" na Edge Function
--   response_status = 500  → verifique os logs da Edge Function no Dashboard
--
-- D) Confirmar homilia inserida (após ~10 segundos):
--
--   SELECT id, data, titulo, video_id, created_at
--   FROM public.homilias_diarias
--   ORDER BY data DESC
--   LIMIT 3;
--
-- E) Verificar cron jobs registrados:
--
--   SELECT jobname, schedule, active
--   FROM cron.job
--   WHERE jobname LIKE 'homilia%'
--   ORDER BY jobname;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ SELECT public.sync_homilia_diaria()  →  sem erros
--   ✓ homilia_sync_logs tem registro com sucesso = true
--   ✓ homilias_diarias tem registro para hoje
--   ✓ net._http_response tem response_status = 200
--   ✓ 4 cron jobs registrados (sync + fallback + tarde + cleanup)
-- ─────────────────────────────────────────────────────────────────────────────
