-- ============================================================
-- LUMEN PASTORAL — PATCH G (2026-06-09)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- Idempotente.
--
-- Problema: membros não conseguem apagar notificações.
-- Causa: RLS na tabela notificacoes não tinha policy DELETE
--   para membros — apenas SELECT, UPDATE e ALL (admins).
--   O frontend chama delete().eq("id", id) e recebe 0 linhas
--   removidas (sem erro explícito, bloqueio silencioso).
--
-- Fix: cria notif_membro_delete permitindo que o membro
--   delete apenas notificações da sua paróquia destinadas a
--   ele OU sem destinatário específico.
-- ============================================================

DROP POLICY IF EXISTS "notif_membro_delete" ON public.notificacoes;

CREATE POLICY "notif_membro_delete" ON public.notificacoes
  FOR DELETE TO authenticated
  USING (
    paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
    AND (destinatario_id IS NULL OR destinatario_id = public._portal_membro_id())
  );

NOTIFY pgrst, 'reload schema';

-- ── Validação ─────────────────────────────────────────────────
SELECT
  'PATCH G aplicado' AS status,
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'notificacoes'
     AND policyname = 'notif_membro_delete') AS policy_delete_existe;
-- Esperado: policy_delete_existe = 1
