-- ============================================================
-- LUMEN PASTORAL — CHECKLIST DE VALIDAÇÃO PÓS-DEPLOY
-- Execute no SQL Editor do Supabase APÓS o PRODUCTION_DEPLOY.sql
--
-- Cada bloco retorna resultados que permitem confirmar o estado.
-- Resultado esperado está no comentário de cada bloco.
-- ============================================================

-- ── 1. FUNÇÕES AUXILIARES ─────────────────────────────────────────────
-- Esperado: 4 linhas com as funções listadas
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    '_portal_membro_id', '_portal_membro_paroquia',
    '_portal_escala_paroquia', '_portal_is_admin', '_portal_is_coord'
  )
ORDER BY routine_name;

-- ── 2. RLS — POLICIES CRIADAS ────────────────────────────────────────
-- Esperado: todas as policies listadas presentes
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    -- indisponibilidades
    'indisp_membro_own', 'indisp_admin_all',
    -- escala_membros
    'membro_read_escala_paroquia_full', 'em_membro_update_own',
    'em_admin_all', 'em_coord_manage',
    -- notificacoes
    'notif_membro_read', 'notif_membro_mark_read', 'notif_admin_manage',
    -- ocorrencias_membros
    'ocorrencia_membro_read_own', 'ocorrencia_membro_insert',
    'ocorrencia_membro_delete', 'ocorrencia_admin_read', 'ocorrencia_admin_update'
  )
ORDER BY tablename, policyname;

-- ── 3. TRIGGERS CRIADOS ───────────────────────────────────────────────
-- Esperado: 2 triggers (updated_at + notify)
SELECT trigger_name, event_object_table, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'ocorrencias_membros'
ORDER BY trigger_name;

-- ── 4. TABELA OCORRÊNCIAS_MEMBROS ────────────────────────────────────
-- Esperado: tabela existe com as colunas corretas
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'ocorrencias_membros'
ORDER BY ordinal_position;

-- ── 5. HOMILIAS_DIARIAS — colunas extras ─────────────────────────────
-- Esperado: video_id, thumbnail_url, youtube_url, autor presentes
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'homilias_diarias'
  AND column_name  IN ('video_id', 'thumbnail_url', 'youtube_url', 'autor')
ORDER BY column_name;

-- ── 6. MEMBROS COM auth_user_id VINCULADO ────────────────────────────
-- Esperado: contagem de membros SEM auth_user_id deve ser baixa (idealmente 0)
SELECT
  COUNT(*) FILTER (WHERE auth_user_id IS NOT NULL) AS com_auth,
  COUNT(*) FILTER (WHERE auth_user_id IS NULL)     AS sem_auth,
  COUNT(*)                                          AS total
FROM membros
WHERE ativo = true;

-- ── 7. CRON JOBS ─────────────────────────────────────────────────────
-- Esperado: 3 jobs (sync, fallback, tarde)
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'homilia-%'
ORDER BY jobname;

-- ── 8. TABELA HOMILIA_SYNC_LOGS ──────────────────────────────────────
-- Esperado: tabela existe
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'homilia_sync_logs';

-- ── 9. TESTAR FUNÇÃO _portal_membro_id ───────────────────────────────
-- Execute logado como membro autenticado. Deve retornar o UUID do membro.
-- SELECT _portal_membro_id();

-- ── 10. TESTAR SYNC MANUAL DA HOMILIA ────────────────────────────────
-- Executa a sincronização imediatamente e registra no log.
-- Requer: app.service_role_key configurado + Edge Function deployada
-- SELECT public.sync_homilia_diaria();

-- Verificar resultado:
-- SELECT * FROM public.homilia_sync_logs ORDER BY executado_em DESC LIMIT 5;
-- SELECT data, titulo, video_id FROM homilias_diarias ORDER BY data DESC LIMIT 5;

-- ── 11. ESCALAS — VERIFICAR VISIBILIDADE ─────────────────────────────
-- Execute como membro autenticado:
-- SELECT count(*) FROM escala_membros;                     -- deve ser > 0
-- SELECT count(*) FROM escalas WHERE status = 'publicada'; -- deve ser > 0

-- ── 12. INDISPONIBILIDADES — VERIFICAR RLS ───────────────────────────
-- Execute como membro autenticado (deve retornar apenas as próprias):
-- SELECT count(*) FROM indisponibilidades;

-- ── 13. NOTIFICAÇÕES — VERIFICAR UPDATE ──────────────────────────────
-- Execute como membro autenticado:
-- UPDATE notificacoes SET lida = true WHERE lida = false
--   AND paroquia_id = (SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid() LIMIT 1);
-- Deve executar sem erro de RLS.

-- ── 14. RESUMO DE POLICIES POR TABELA ────────────────────────────────
SELECT tablename, count(*) as num_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'indisponibilidades', 'escala_membros', 'notificacoes',
    'ocorrencias_membros', 'homilia_sync_logs'
  )
GROUP BY tablename
ORDER BY tablename;
-- Esperado:
--   escala_membros       → 4
--   homilia_sync_logs    → 1
--   indisponibilidades   → 2 (ou mais, se havia policies anteriores)
--   notificacoes         → 3
--   ocorrencias_membros  → 5
