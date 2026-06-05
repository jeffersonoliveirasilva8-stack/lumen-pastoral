-- ============================================================
-- FIX: escala_membros INSERT bloqueado por RLS (código 42501)
--
-- Causa: DEFINITIVO_FIX.sql removeu "escala_membros_rls" e só
--   recriou "em_admin_all", que exige user_roles.
--   Sem entrada em user_roles o INSERT falha silenciosamente.
--
-- Solução: recriar policy de INSERT/UPDATE/DELETE baseada em
--   current_paroquia_id() — a mesma função que funciona em
--   "escalas_rls" (prova: escalas são criadas sem erro).
--
-- Execute INTEIRO no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ── PASSO 1: diagnóstico rápido ────────────────────────────
-- (leia antes de continuar)

SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'escala_membros'
ORDER BY policyname;

-- Verifique se o usuário logado tem paroquia_id:
SELECT id, email, paroquia_id FROM profiles WHERE id = auth.uid();

-- Verifique se o usuário está em user_roles:
SELECT * FROM user_roles WHERE user_id = auth.uid();

-- ── PASSO 2: recriar a policy de escrita ──────────────────

-- Remove a versão antiga (pode não existir — IF EXISTS é seguro)
DROP POLICY IF EXISTS "escala_membros_rls"       ON public.escala_membros;
DROP POLICY IF EXISTS "escala_membros_write_rls" ON public.escala_membros;

-- Policy de leitura/escrita completa para admins autenticados
-- Usa current_paroquia_id() → lê profiles.paroquia_id do usuário logado.
-- Essa função já funciona para a tabela "escalas" (INSERT de escalas não falha).
CREATE POLICY "escala_membros_rls" ON public.escala_membros
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = current_paroquia_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = current_paroquia_id()
    )
  );

-- ── PASSO 3: garantir que o usuário admin está em user_roles ─
-- (se o PASSO 1 mostrou que user_roles está vazio para auth.uid())
--
-- Substitua <SEU_PAROQUIA_ID> pelo UUID da sua paróquia
-- (execute: SELECT id, nome FROM paroquias; para descobrir)
--
-- INSERT INTO public.user_roles (user_id, paroquia_id, role)
-- VALUES (
--   auth.uid(),
--   '<SEU_PAROQUIA_ID>',
--   'admin_paroquial'
-- )
-- ON CONFLICT (user_id, paroquia_id, role) DO NOTHING;

-- ── PASSO 4: recarregar schema ────────────────────────────

NOTIFY pgrst, 'reload schema';

-- ── VALIDAÇÃO ─────────────────────────────────────────────
-- Após executar, tente novamente "Gerar escalas da semana".
-- Não deve mais aparecer erro 42501 no console.
--
-- Para confirmar as policies ativas:
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'escala_membros'
ORDER BY policyname;
