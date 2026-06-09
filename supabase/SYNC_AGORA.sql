-- ============================================================
-- SYNC_AGORA.sql — Execute INTEIRO no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ── DIAGNÓSTICO ────────────────────────────────────────────────────────────────

-- 1. Homilias dos últimos 10 dias
SELECT
  data,
  titulo,
  video_id,
  created_at AT TIME ZONE 'America/Sao_Paulo' AS criado_br
FROM homilias_diarias
WHERE data >= CURRENT_DATE - 10
ORDER BY data DESC;

-- 2. Liturgia: quantos dias sincronizados nos próximos 30 dias
SELECT
  COUNT(*) AS dias_cobertos,
  MIN(data) AS primeiro,
  MAX(data) AS ultimo
FROM liturgia_base
WHERE data >= CURRENT_DATE AND data <= CURRENT_DATE + 30;

-- 3. Log das últimas execuções do cron
SELECT
  j.jobname,
  d.start_time AT TIME ZONE 'America/Sao_Paulo' AS inicio_br,
  d.status,
  LEFT(d.return_message, 200) AS resultado
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname IN ('homilia-diaria-sync', 'liturgia-diaria-sync')
ORDER BY d.start_time DESC
LIMIT 20;

-- ── SINCRONIZAÇÃO FORÇADA ──────────────────────────────────────────────────────
-- Descomente e execute para forçar sync agora sem esperar o cron:

-- 4a. Forçar sync da LITURGIA (próximos 30 dias)
/*
SELECT net.http_post(
  url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/liturgia-diaria?days=30',
  headers := jsonb_build_object(
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb
);
*/

-- 4b. Forçar sync da HOMILIA de HOJE
/*
SELECT net.http_post(
  url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria',
  headers := jsonb_build_object(
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb
);
*/

-- 4c. Forçar sync da HOMILIA para data específica (ontem)
/*
SELECT net.http_post(
  url     := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria?date=2026-06-04',
  headers := jsonb_build_object(
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1c3VvZ2dtbGh0dnJjbHJ6dmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzk1OTUsImV4cCI6MjA5NDg1NTU5NX0.14p2eZ2SLHYLlJ5mWsOyxAR_cGNbxHSZ9E9kmEbuI5I',
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb
);
*/

-- ── INSERÇÃO MANUAL DE EMERGÊNCIA ─────────────────────────────────────────────
-- Se a Edge Function não encontrar o vídeo, insira manualmente:
-- 1. Abra o canal do Padre Paulo Ricardo no YouTube
-- 2. Encontre o vídeo da homilia do dia
-- 3. Copie o video_id da URL (parte após v=)
-- 4. Substitua 'XXXXXXXXXXX' e execute:

/*
INSERT INTO homilias_diarias (data, titulo, youtube_url, video_id, thumbnail_url, autor)
VALUES
  ('2026-06-05', 'Homilia — Sexta-feira, 5 de junho', 'https://www.youtube.com/watch?v=XXXXXXXXXXX', 'XXXXXXXXXXX', 'https://i.ytimg.com/vi/XXXXXXXXXXX/hqdefault.jpg', 'Padre Paulo Ricardo'),
  ('2026-06-04', 'Homilia — Quinta-feira, 4 de junho', 'https://www.youtube.com/watch?v=YYYYYYYYYYY', 'YYYYYYYYYYY', 'https://i.ytimg.com/vi/YYYYYYYYYYY/hqdefault.jpg', 'Padre Paulo Ricardo')
ON CONFLICT (data) DO UPDATE SET
  titulo        = EXCLUDED.titulo,
  youtube_url   = EXCLUDED.youtube_url,
  video_id      = EXCLUDED.video_id,
  thumbnail_url = EXCLUDED.thumbnail_url,
  updated_at    = now();
*/
