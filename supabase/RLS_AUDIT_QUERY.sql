-- ============================================================
-- RLS_AUDIT_QUERY.sql
-- Auditoria consolidada de Row Level Security — todas as tabelas
-- Execute no SQL Editor do Supabase (super_admin ou service_role)
-- ============================================================

-- ── 1. Status de RLS por tabela ────────────────────────────────────────

SELECT
  t.tablename                                                  AS "Tabela",
  CASE WHEN t.rowsecurity THEN '✅ SIM' ELSE '❌ NÃO' END    AS "RLS",
  COALESCE(p.total, 0)                                         AS "Nº Políticas",
  COALESCE(p.select_count, 0)                                  AS "SELECT",
  COALESCE(p.insert_count, 0)                                  AS "INSERT",
  COALESCE(p.update_count, 0)                                  AS "UPDATE",
  COALESCE(p.delete_count, 0)                                  AS "DELETE",
  COALESCE(p.all_count, 0)                                     AS "ALL",
  CASE
    WHEN NOT t.rowsecurity THEN '⚠️ SEM RLS'
    WHEN COALESCE(p.total, 0) = 0 THEN '⚠️ RLS SEM POLÍTICAS (bloqueio total)'
    ELSE '✅ OK'
  END                                                          AS "Status"
FROM pg_tables t
LEFT JOIN (
  SELECT
    tablename,
    COUNT(*)                                           AS total,
    COUNT(*) FILTER (WHERE cmd = 'SELECT')             AS select_count,
    COUNT(*) FILTER (WHERE cmd = 'INSERT')             AS insert_count,
    COUNT(*) FILTER (WHERE cmd = 'UPDATE')             AS update_count,
    COUNT(*) FILTER (WHERE cmd = 'DELETE')             AS delete_count,
    COUNT(*) FILTER (WHERE cmd = 'ALL')                AS all_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON p.tablename = t.tablename
WHERE t.schemaname = 'public'
ORDER BY
  t.rowsecurity DESC,    -- tabelas sem RLS primeiro
  p.total ASC NULLS FIRST,
  t.tablename;

-- ── 2. Detalhe de cada política ────────────────────────────────────────

SELECT
  tablename           AS "Tabela",
  policyname          AS "Política",
  cmd                 AS "Comando",
  roles               AS "Roles",
  LEFT(qual, 120)     AS "USING (condição)",
  LEFT(with_check, 80) AS "WITH CHECK"
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ── 3. Tabelas críticas sem RLS ────────────────────────────────────────
-- São críticas aquelas que contenham: paroquia_id, membro_id, user_id, auth_user_id

SELECT
  c.table_name      AS "Tabela crítica SEM RLS",
  STRING_AGG(DISTINCT c.column_name, ', ') AS "Colunas sensíveis encontradas"
FROM information_schema.columns c
JOIN pg_tables t
  ON t.tablename = c.table_name
  AND t.schemaname = 'public'
  AND NOT t.rowsecurity
WHERE c.table_schema = 'public'
  AND c.column_name IN ('paroquia_id', 'membro_id', 'user_id', 'auth_user_id', 'destinatario_id', 'remetente_id')
GROUP BY c.table_name
ORDER BY c.table_name;

-- ── 4. Tabelas com "FOR ALL" sem WITH CHECK ────────────────────────────
-- FOR ALL sem WITH CHECK pode permitir INSERT/UPDATE com dados errados

SELECT
  tablename   AS "Tabela",
  policyname  AS "Política",
  'FOR ALL sem WITH CHECK — INSERT/UPDATE podem bypassar filtro' AS "Alerta"
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'ALL'
  AND (with_check IS NULL OR with_check = '')
ORDER BY tablename, policyname;

-- ── 5. Funções SECURITY DEFINER (contornam RLS) ────────────────────────

SELECT
  routine_name                  AS "Função SECURITY DEFINER",
  routine_type                  AS "Tipo",
  LEFT(routine_definition, 200) AS "Início da definição"
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_definition ILIKE '%SECURITY DEFINER%'
ORDER BY routine_name;
