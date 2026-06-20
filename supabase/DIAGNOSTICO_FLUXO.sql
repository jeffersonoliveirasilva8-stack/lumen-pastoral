-- DIAGNÓSTICO COMPLETO DO FLUXO DE SUBSTITUIÇÕES
-- Execute no SQL Editor do Supabase (cada bloco separado)

-- ── 1. Tabela notificacao_tokens existe? ───────────────────────────────────────
SELECT 'notificacao_tokens EXISTS' AS check,
       EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'notificacao_tokens') AS ok;

-- ── 2. pg_net está habilitado? ─────────────────────────────────────────────────
SELECT 'pg_net enabled' AS check,
       EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS ok;

-- ── 3. Últimas chamadas pg_net (últimas 10) ────────────────────────────────────
SELECT id, method, url, status_code, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 10;

-- ── 4. Tokens pendentes (não consumidos) ──────────────────────────────────────
SELECT * FROM public.notificacao_tokens ORDER BY created_at DESC LIMIT 10;

-- ── 5. Substituições existentes ───────────────────────────────────────────────
SELECT id, status, created_at, motivo_solicitacao FROM public.substituicoes ORDER BY created_at DESC LIMIT 10;

-- ── 6. Função coord_reenviar existe e tem inline auth? ───────────────────────
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'coord_reenviar_notificacao_substituicao';

-- ── 7. Teste direto: reenviar para uma substituição existente ─────────────────
-- (substitua o UUID pelo ID real de uma substituição com status 'solicitada')
-- SELECT public.coord_reenviar_notificacao_substituicao('SEU-UUID-AQUI'::UUID);
