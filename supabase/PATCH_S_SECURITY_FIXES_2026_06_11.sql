-- PATCH_S — Correções de Segurança (2026-06-11)
-- Aplique no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
--
-- O que este patch corrige:
--   BUG C-1: Qualquer membro podia deletar notificações broadcast da paróquia.
--            A policy "notif_membro_delete" permitia DELETE onde destinatario_id IS NULL,
--            o que inclui comunicados gerais da paróquia.
--   FIX:     Membros só podem deletar notificações onde eles são o destinatário específico.
--            Notificações broadcast (destinatario_id IS NULL) são protegidas de deleção.
--
-- Dependências: PATCH_O (coluna destinatario_id deve existir em notificacoes)

-- ═══════════════════════════════════════════════════════════════════
-- 1. Corrige a policy de DELETE em notificacoes
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_membro_delete" ON public.notificacoes;

CREATE POLICY "notif_membro_delete" ON public.notificacoes
  FOR DELETE
  TO authenticated
  USING (
    -- Apenas notificações não-admin (broadcasts gerais da coordenação nunca deletáveis por membro)
    apenas_admin = false
    -- O membro só pode deletar notificações ENDEREÇADAS ESPECIFICAMENTE a ele
    AND destinatario_id IN (
      SELECT id FROM public.membros
      WHERE auth_user_id = auth.uid()
        AND ativo = true
    )
  );

-- NOTA: Notificações com destinatario_id IS NULL (broadcast) NÃO são deletáveis por membros.
-- Apenas a coordenação (via RLS de admin) pode gerenciar comunicados gerais.

-- ═══════════════════════════════════════════════════════════════════
-- 2. Verifica o resultado (execução opcional — só para conferência)
-- ═══════════════════════════════════════════════════════════════════

-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'notificacoes'
-- ORDER BY cmd, policyname;
