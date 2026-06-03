-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO — Execute INTEIRO no SQL Editor
-- https://supabase.com/dashboard/project/cusuoggmlhtvrclrzvfr/sql/new
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASSO 1 — DIAGNÓSTICO: verificar permissões atuais
-- ════════════════════════════════════════════════════════════

SELECT
  grantee,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
  AND table_name IN (
    'paroquias','profiles','user_roles',
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes',
    'comunidades','coordenadores',
    'atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes'
  )
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

-- ════════════════════════════════════════════════════════════
-- PASSO 2 — CORREÇÃO: conceder permissões necessárias
-- (seguro executar múltiplas vezes — GRANT é idempotente)
-- ════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- PASSO 3 — Forçar PostgREST a recarregar o schema
-- ════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- PASSO 4 — VALIDAÇÃO: confirmar grants aplicados
-- ════════════════════════════════════════════════════════════

SELECT
  '✓ GRANT' AS status,
  grantee,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'paroquias','profiles','user_roles',
    'ministerios','membros','membro_ministerios',
    'escalas','escala_funcoes','escala_membros',
    'indisponibilidades','historico_participacoes',
    'missas_padrao','missa_padrao_funcoes',
    'comunidades','coordenadores',
    'atuacoes_pastorais','membro_atuacoes','membro_funcao_restricoes'
  )
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

-- ════════════════════════════════════════════════════════════
-- PASSO 5 — TESTE: simular o que o front-end faz
-- (substitua o UUID abaixo pelo seu paroquia_id real)
-- ════════════════════════════════════════════════════════════

-- Para descobrir seu paroquia_id, execute:
SELECT id, nome FROM paroquias LIMIT 5;

-- Depois teste o RLS como se fosse o usuário autenticado:
-- (requer conhecer o user_id do usuário logado)
SELECT id, email FROM auth.users LIMIT 5;

-- Verificar se profiles tem paroquia_id preenchido:
SELECT id, email, paroquia_id FROM profiles;

-- Verificar se current_paroquia_id() funcionaria para cada usuário:
SELECT
  p.id,
  p.email,
  p.paroquia_id,
  CASE WHEN p.paroquia_id IS NULL THEN '⚠ SEM PARÓQUIA' ELSE '✓ OK' END AS status
FROM profiles p;
