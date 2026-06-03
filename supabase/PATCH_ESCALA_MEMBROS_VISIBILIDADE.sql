-- ============================================================
-- PATCH: Visibilidade completa de escala_membros para membros
--
-- Problema: membros do portal só conseguiam ver seus próprios
--   registros em escala_membros. Isso impedia visualizar quem
--   mais está escalado em cada celebração.
--
-- Solução: adicionar política que permite a qualquer membro
--   autenticado da paróquia ler TODOS os registros de
--   escala_membros de escalas publicadas da sua paróquia.
--
-- Execute INTEIRO no SQL Editor do Supabase
-- ============================================================

-- Verifica e cria a política
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;

CREATE POLICY "membro_read_escala_paroquia_full" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    -- Permite leitura se o usuário autenticado é membro da mesma paróquia
    -- que a escala (e a escala está publicada)
    EXISTS (
      SELECT 1
      FROM public.escalas e
      JOIN public.membros m ON m.paroquia_id = e.paroquia_id
      WHERE e.id  = escala_membros.escala_id
        AND m.auth_user_id = auth.uid()
        AND e.status = 'publicada'
        AND m.ativo = true
    )
  );

-- Recarregar schema PostgREST
NOTIFY pgrst, 'reload schema';

-- ── Validação ───────────────────────────────────────────────
-- Após executar, teste com um membro autenticado:
--
-- SELECT count(*) FROM escala_membros em
-- JOIN escalas e ON e.id = em.escala_id
-- WHERE e.status = 'publicada';
--
-- Deve retornar > 0 se há escalas publicadas na paróquia.
-- ============================================================
