-- ============================================================
-- DIAGNÓSTICO: Por que escalas não aparecem no portal do membro
-- ============================================================

-- 1. VERIFICAR ESCALAS PUBLICADAS NA PARÓQUIA
SELECT 
  'Escalas por Status' as diagnostico,
  status,
  COUNT(*) as quantidade,
  COUNT(CASE WHEN data >= CURRENT_DATE THEN 1 END) as futuras
FROM escalas
GROUP BY status
ORDER BY status;

-- 2. VERIFICAR SE HÁ MEMBROS ATRIBUÍDOS A ESCALAS PUBLICADAS
SELECT 
  'Membros em escalas publicadas' as diagnostico,
  COUNT(DISTINCT em.id) as total_atribuicoes,
  COUNT(DISTINCT em.membro_id) as membros_unicos,
  COUNT(DISTINCT e.id) as escalas_uniques
FROM escala_membros em
JOIN escalas e ON em.escala_id = e.id
WHERE e.status = 'publicada'
  AND e.data >= CURRENT_DATE;

-- 3. DETALHE: PRIMEIRAS 10 ESCALAS PUBLICADAS E SEUS MEMBROS
SELECT 
  'Detalhe escalas publicadas' as tipo,
  e.id,
  e.titulo,
  e.data,
  e.status,
  COUNT(em.id) as membros_atribuidos
FROM escalas e
LEFT JOIN escala_membros em ON e.id = em.escala_id
WHERE e.status = 'publicada'
  AND e.data >= CURRENT_DATE
GROUP BY e.id, e.titulo, e.data, e.status
ORDER BY e.data
LIMIT 10;

-- 4. VERIFICAR RLS - Pode haver problema de permissão?
SELECT 
  'RLS Policies' as tipo,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual
FROM pg_policies
WHERE tablename IN ('escalas', 'escala_membros')
ORDER BY tablename, policyname;

-- 5. TESTE: Query que o portal do membro faz
-- (Substitua 'MEMBRO_ID' e 'PAROQUIA_ID' pelos valores reais)
-- SELECT 
--   em.id,
--   em.status,
--   e.id as escala_id,
--   e.titulo,
--   e.data,
--   e.status as escala_status,
--   m.nome as ministerio
-- FROM escala_membros em
-- JOIN escalas e ON e.id = em.escala_id
-- JOIN ministerios m ON m.id = em.ministerio_id
-- WHERE em.membro_id = 'MEMBRO_ID'
--   AND e.status = 'publicada'
--   AND e.data >= CURRENT_DATE
-- ORDER BY e.data;

-- 6. VERIFICAR ISSUES DE FOREIGN KEY
SELECT 
  'Referências órfãs' as tipo,
  COUNT(*) as quantidade
FROM escala_membros em
LEFT JOIN escalas e ON em.escala_id = e.id
WHERE e.id IS NULL;

SELECT 
  'RLS por escala' as tipo,
  tablename,
  COUNT(*) as policies
FROM pg_policies
WHERE tablename = 'escalas'
GROUP BY tablename;
