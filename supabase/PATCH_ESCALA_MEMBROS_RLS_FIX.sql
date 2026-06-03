-- ============================================================
-- FIX: Corrigir recursão infinita em escala_membros
--
-- Problema: a política anterior fazia JOIN direto com a tabela
--   `escalas`, que por sua vez tem uma policy que lê
--   `escala_membros` → recursão infinita (erro 42P17).
--
-- Solução: usar a função SECURITY DEFINER `_portal_escala_paroquia()`
--   que lê `escalas` bypassando o RLS, evitando o loop.
--
-- PASSO 1: execute isto para remover a policy problemática
-- PASSO 2: execute a policy corrigida abaixo
--
-- Execute INTEIRO no SQL Editor do Supabase
-- ============================================================

-- Remove a policy que causou recursão
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;

-- ─────────────────────────────────────────────────────────
-- Policy corrigida:
-- Usa _portal_escala_paroquia() (SECURITY DEFINER) para obter
-- o paroquia_id da escala sem disparar o RLS de `escalas`.
-- Em seguida, verifica se o usuário é membro ativo dessa paróquia.
-- ─────────────────────────────────────────────────────────

CREATE POLICY "membro_read_escala_paroquia_full" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.membros m
      WHERE m.paroquia_id = _portal_escala_paroquia(escala_membros.escala_id)
        AND m.auth_user_id = auth.uid()
        AND m.ativo = true
    )
  );

-- Recarregar schema
NOTIFY pgrst, 'reload schema';

-- ── Verificação ─────────────────────────────────────────
-- Após aplicar, teste como um membro autenticado:
--
-- SELECT count(*) FROM escala_membros em
-- JOIN escalas e ON e.id = em.escala_id
-- WHERE e.status = 'publicada';
--
-- Deve retornar o total de membros em escalas publicadas
-- da sua paróquia (não apenas os seus próprios registros).
-- ============================================================
