-- ============================================================
-- PATCH DEFINITIVO: escala_membros — visibilidade para membros
--
-- Execute este bloco COMPLETO no SQL Editor do Supabase.
-- Ele lista, remove e recria as policies de forma segura.
-- ============================================================

-- ── DIAGNÓSTICO: liste as policies existentes ───────────────
-- (Para referência — não afeta nada)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'escala_membros'
ORDER BY policyname;

-- ── LIMPEZA: remover qualquer policy de leitura de membro ───
-- Remove todas as policies que possam causar recursão

DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;
DROP POLICY IF EXISTS "membro_read_own_escala_membros"   ON public.escala_membros;
DROP POLICY IF EXISTS "membro_escala_read"               ON public.escala_membros;
DROP POLICY IF EXISTS "escala_membros_read_paroquia"     ON public.escala_membros;
DROP POLICY IF EXISTS "members_read_own"                 ON public.escala_membros;
DROP POLICY IF EXISTS "members_read_paroquia"            ON public.escala_membros;
DROP POLICY IF EXISTS "membro_read_escalas_paroquia"     ON public.escala_membros;

-- ── POLICY ÚNICA E SEGURA ────────────────────────────────────
--
-- Usa _portal_escala_paroquia() — SECURITY DEFINER — para obter
-- o paroquia_id sem disparar o RLS de `escalas`.
-- Isso quebra o ciclo de recursão.
--
-- Cobre os dois casos:
--   1. Membro lê seus PRÓPRIOS registros (home, histórico)
--   2. Membro lê TODOS os registros de escalas publicadas
--      da sua paróquia (página de escalas do portal)

CREATE POLICY "escala_membros_select_membro" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.membros m
      WHERE m.paroquia_id = _portal_escala_paroquia(escala_membros.escala_id)
        AND m.auth_user_id = auth.uid()
        AND m.ativo = true
    )
    OR
    _portal_is_admin(_portal_escala_paroquia(escala_membros.escala_id))
  );

-- Recarregar schema
NOTIFY pgrst, 'reload schema';

-- ── VALIDAÇÃO ────────────────────────────────────────────────
-- Após executar, teste como membro autenticado:
--
-- 1. Verifica se vê todos os membros de uma escala publicada:
-- SELECT count(*) FROM escala_membros em
-- JOIN escalas e ON e.id = em.escala_id
-- WHERE e.status = 'publicada';
--
-- 2. Verifica se não há recursão (deve retornar sem erro):
-- SELECT * FROM escalas WHERE status = 'publicada' LIMIT 1;
-- ============================================================
