-- ============================================================
-- PATCH: Corrige políticas de leitura pública
-- Problema: as policies sem auth.uid() IS NULL se aplicavam
-- também a admins autenticados, expondo dados de outras paróquias.
-- Cole no Supabase SQL Editor e execute.
-- URL: https://supabase.com/dashboard/project/hbbkdebuhueqjyrdeyyc/sql/new
-- ============================================================

-- escalas: apenas anônimos leem escalas publicadas
DROP POLICY IF EXISTS "escalas_leitura_publica" ON escalas;
CREATE POLICY "escalas_leitura_publica" ON escalas
  FOR SELECT USING (status = 'publicada' AND auth.uid() IS NULL);

-- escala_funcoes: apenas anônimos
DROP POLICY IF EXISTS "escala_funcoes_leitura_publica" ON escala_funcoes;
CREATE POLICY "escala_funcoes_leitura_publica" ON escala_funcoes
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

-- escala_membros: apenas anônimos
DROP POLICY IF EXISTS "escala_membros_leitura_publica" ON escala_membros;
CREATE POLICY "escala_membros_leitura_publica" ON escala_membros
  FOR SELECT USING (
    auth.uid() IS NULL AND
    EXISTS (SELECT 1 FROM escalas e WHERE e.id = escala_id AND e.status = 'publicada')
  );

-- membros: apenas anônimos (para mostrar nome no portal público)
DROP POLICY IF EXISTS "membros_leitura_publica" ON membros;
CREATE POLICY "membros_leitura_publica" ON membros
  FOR SELECT USING (
    auth.uid() IS NULL AND
    ativo = true AND EXISTS (
      SELECT 1 FROM escala_membros em
      JOIN escalas e ON e.id = em.escala_id
      WHERE em.membro_id = membros.id AND e.status = 'publicada'
    )
  );

-- ministerios: apenas anônimos
DROP POLICY IF EXISTS "ministerios_leitura_publica" ON ministerios;
CREATE POLICY "ministerios_leitura_publica" ON ministerios
  FOR SELECT USING (auth.uid() IS NULL AND ativo = true);

-- Validação
SELECT policyname, tablename, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE '%leitura_publica%'
ORDER BY tablename;
