-- ============================================================
-- LUMEN PASTORAL — PATCH V: Deduplicação de Triggers de Notificação
-- Data: 2026-06-11
--
-- PROBLEMA IDENTIFICADO:
--   Dois pares de triggers disparam para o mesmo evento, gerando
--   duplicidade de notificações (2x por ação do usuário).
--
-- PAR 1 — INSERT em escala_membros:
--   • on_membro_escalado   (NOTIFICACOES_ESCALACAO.sql  — sem privacy flags)
--   • notify_escala_membro (PATCH_P_NOTIF_PRIVACIDADE   — com destinatario_id e apenas_admin)
--   → MANTER: notify_escala_membro (PATCH_P, correto)
--   → REMOVER: on_membro_escalado (antigo, substituído)
--
-- PAR 2 — UPDATE de status em escalas:
--   • on_escala_publicada (NOTIFICACOES_AUTOMATICAS.sql)
--     → Chama _notify_all_membros() sem destinatario_id = broadcast indevido
--     → Viola o critério de privacidade do PATCH_P:
--       "Publicar escala → NÃO gera notif para membros não escalados"
--   • on_escala_publicada_membros (NOTIFICACOES_ESCALACAO.sql)
--     → Notifica individualmente cada membro já na escala com destinatario_id
--     → Está correto — mantido
--   → REMOVER: on_escala_publicada (broadcast, viola privacidade)
--   → MANTER: on_escala_publicada_membros (individualized, privacy-correct)
--
-- DEPENDÊNCIAS: PATCH_P_NOTIF_PRIVACIDADE deve estar aplicado.
-- IDEMPOTENTE: sim (DROP IF EXISTS)
-- ============================================================

-- ── 1. Remove trigger duplicado em escala_membros ─────────────────────────────

DROP TRIGGER IF EXISTS on_membro_escalado ON public.escala_membros;

-- Remove a função associada (não é mais referenciada por nenhum trigger)
DROP FUNCTION IF EXISTS public._trigger_membro_escalado() CASCADE;

-- ── 2. Remove trigger broadcast em escalas ────────────────────────────────────

DROP TRIGGER IF EXISTS on_escala_publicada ON public.escalas;

-- Remove a função associada (não é mais referenciada por nenhum trigger)
DROP FUNCTION IF EXISTS public._trigger_escala_publicada() CASCADE;

-- ── 3. Verificação ────────────────────────────────────────────────────────────
--
-- Triggers que DEVEM existir após este patch:
-- SELECT trigger_name, event_object_table, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND trigger_name NOT LIKE 'trg_audit_%'
-- ORDER BY event_object_table, trigger_name;
--
-- ESPERADO:
--   notify_escala_membro           | escala_membros | INSERT
--   notify_ocorrencia_membro       | ocorrencias_membros | INSERT
--   notify_ocorrencia_respondida   | ocorrencias_membros | UPDATE
--   on_escala_alterada             | escalas | UPDATE
--   on_escala_publicada_membros    | escalas | UPDATE
--   on_evento_criado               | formacoes_eventos | INSERT
--   on_falta_registrada            | historico_participacoes | INSERT
--   on_indisponibilidade           | indisponibilidades | INSERT
--   on_ocorrencia_escala           | ocorrencias_membros | INSERT
--
-- NÃO DEVEM existir:
--   on_membro_escalado             (removido aqui)
--   on_escala_publicada            (removido aqui)
--   notify_escala_publicada        (removido pelo PATCH_P)
--   notify_escala_status           (removido pelo PATCH_P)
--   trg_notify_escala_publish      (removido pelo PATCH_P)
--
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ INSERT em escala_membros: apenas notify_escala_membro dispara (1 notif)
--   ✓ Publicação de escala: apenas on_escala_publicada_membros dispara (1 notif/membro)
--   ✓ Nenhuma notificação broadcast sem destinatario_id em flows de escala
-- ─────────────────────────────────────────────────────────────────────────────
