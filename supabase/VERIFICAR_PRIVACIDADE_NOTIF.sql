-- ============================================================
-- VERIFICAÇÃO DE PRIVACIDADE — Notificações e Visibilidade
-- Executar no Supabase SQL Editor ANTES de aplicar 040
-- e DEPOIS para confirmar limpeza.
-- ============================================================

-- ── 1. Confirma que _notify_escala_membro NÃO existe como trigger
--      (nunca foi implementado — documentado apenas em comentário 020)
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'escala_membros'
ORDER BY trigger_name;
-- Esperado: apenas "audit_escala_membros" e "on_escala_membro_status_final"
-- NÃO deve existir nenhum trigger de notificação aqui.

-- ── 2. Conta notificações visíveis por membros comuns
--      (apenas_admin=false, apenas_coordenacao=false, sem destinatario)
--      Estas são broadcasts; não há vínculo a escalas específicas.
SELECT COUNT(*) AS broadcast_visiveis_a_membros
FROM public.notificacoes
WHERE apenas_admin = false
  AND (apenas_coordenacao = false OR apenas_coordenacao IS NULL)
  AND destinatario_id IS NULL;

-- ── 3. Notificações privadas para membros específicos
SELECT COUNT(*) AS notif_privadas_membros
FROM public.notificacoes
WHERE apenas_admin = false
  AND destinatario_id IS NOT NULL;
-- Esperado: notificações de ocorrências respondidas, substituições aprovadas/recusadas.
-- NÃO deve haver "escala atribuída" (trigger nunca implementado).

-- ── 4. Verifica se existem as policies overbroad ANTES da migration 040
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('escalas', 'escala_membros', 'escala_funcoes')
  AND policyname IN (
    'escalas_paroquia',
    'escala_membros_paroquia',
    'escala_funcoes_paroquia'
  )
ORDER BY tablename, policyname;
-- Esperado PRÉ-040: 3 linhas (as policies overbroad existem)
-- Esperado PÓS-040: 0 linhas (foram dropadas)

-- ── 5. PÓS-040: Confirma policies corretas criadas
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('escalas', 'escala_membros', 'escala_funcoes')
ORDER BY tablename, policyname;
-- Deve incluir:
--   escalas: escalas_admin, escalas_coord, escalas_membro_leitura, escalas_leitura_publica
--   escala_membros: escala_membros_admin, escala_membros_membro_update,
--                   membro_read_escala_paroquia_full, em_coord_read, em_coord_update,
--                   escala_membros_leitura_publica
--   escala_funcoes: escala_funcoes_admin, escala_funcoes_coord, escala_funcoes_leitura_publica
-- NÃO deve incluir: escalas_paroquia, escala_membros_paroquia, escala_funcoes_paroquia

-- ── 6. PÓS-040: Testa que portal_get_escalas_membro retorna status='publicada'
--      (requer token real de um membro com escalas)
-- SELECT portal_get_escalas_membro('<uuid-token-aqui>');
-- Verificar no JSON retornado: nenhum item com status diferente de 'publicada'

-- ── 7. PÓS-040: Verifica assinatura da função corrigida
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'portal_get_escalas_membro',
    'portal_get_historico_membro',
    'portal_responder_escala'
  )
ORDER BY routine_name;
-- Confirmar manualmente que 'publicada' aparece na definição de cada função.
