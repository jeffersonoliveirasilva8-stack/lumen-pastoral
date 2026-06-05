-- ============================================================
-- DIAGNÓSTICO HOMILIA — Execute no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ── 1. Ver homilias dos últimos 10 dias ───────────────────────────────────────
SELECT
  data,
  titulo,
  video_id,
  autor,
  created_at AT TIME ZONE 'America/Sao_Paulo' AS criado_em_br
FROM homilias_diarias
WHERE data >= CURRENT_DATE - 10
ORDER BY data DESC;

-- ── 2. Ver log do cron (últimas 20 execuções) ─────────────────────────────────
SELECT
  j.jobname,
  d.start_time AT TIME ZONE 'America/Sao_Paulo' AS inicio_br,
  d.end_time   AT TIME ZONE 'America/Sao_Paulo' AS fim_br,
  d.status,
  d.return_message
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname IN ('homilia-diaria-sync', 'liturgia-diaria-sync')
ORDER BY d.start_time DESC
LIMIT 20;

-- ── 3. Verificar se o cron está agendado ─────────────────────────────────────
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname IN ('homilia-diaria-sync', 'liturgia-diaria-sync')
ORDER BY jobname;

-- ── 4. Verificar hora atual no servidor ──────────────────────────────────────
SELECT
  NOW() AS utc,
  NOW() AT TIME ZONE 'America/Sao_Paulo' AS brasilia,
  CURRENT_DATE AS data_utc;

-- ============================================================
-- SE homilias_diarias está VAZIA para 2026-06-04 e 2026-06-05:
--   Causa: cron falhou silenciosamente OU Edge Function não encontrou vídeo.
--   Ação: inserir manualmente via INSERT_HOMILIA_HOJE.sql
--         e investigar cron.job_run_details.
--
-- SE homilias_diarias TEM registros mas UI não mostra:
--   Causa: cache de 1h no React Query (já corrigido para 15min).
--   Ação: limpar cache do browser / aguardar expiração.
-- ============================================================

-- ── 5. Inserção manual de emergência (descomente e adapte) ───────────────────
/*
INSERT INTO homilias_diarias (data, titulo, descricao, youtube_url, video_id, thumbnail_url, autor)
VALUES (
  '2026-06-05',          -- ← data
  'Homilia do dia — 5 de junho de 2026',  -- ← título real
  NULL,
  'https://www.youtube.com/watch?v=XXXXXXXXX',  -- ← URL real
  'XXXXXXXXX',           -- ← video_id (parte final da URL)
  'https://i.ytimg.com/vi/XXXXXXXXX/hqdefault.jpg',
  'Padre Paulo Ricardo'
)
ON CONFLICT (data) DO UPDATE SET
  titulo        = EXCLUDED.titulo,
  youtube_url   = EXCLUDED.youtube_url,
  video_id      = EXCLUDED.video_id,
  thumbnail_url = EXCLUDED.thumbnail_url,
  updated_at    = now();
*/
