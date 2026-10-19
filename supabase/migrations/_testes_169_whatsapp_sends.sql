-- Testes de verificação — Migration 169: whatsapp_sends + _pode_enviar_whatsapp
-- Executar no SQL Editor do Supabase APÓS aplicar a migration.
-- Todos os blocos são read-only ou usam BEGIN/ROLLBACK para não persistir dados.
-- Resultados esperados indicados em cada bloco.


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-1: Tabela criada com estrutura correta
-- ═══════════════════════════════════════════════════════════════════════════
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'whatsapp_sends'
ORDER  BY ordinal_position;
-- Esperado: 10 colunas — id, membro_id, paroquia_id, evento_tipo, evento_ref_id,
--           status, telefone_hash, enviado_em, resposta_http, resposta_body, criado_em


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-2: Índice de deduplicação (parcial) existe e é válido
-- ═══════════════════════════════════════════════════════════════════════════
SELECT indexname, indexdef, idx.indisvalid, idx.indislive
FROM   pg_indexes pi
JOIN   pg_class c   ON c.relname = pi.indexname
JOIN   pg_index idx ON idx.indexrelid = c.oid
WHERE  pi.tablename = 'whatsapp_sends'
  AND  pi.schemaname = 'public'
  AND  pi.indexname  = 'whatsapp_sends_dedup';
-- Esperado: 1 linha | indisvalid=true | indislive=true
-- indexdef deve conter: UNIQUE ... WHERE ((status = ANY ('{pending,sent}'...)))


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-3: RLS está habilitada
-- ═══════════════════════════════════════════════════════════════════════════
SELECT relname, relrowsecurity, relforcerowsecurity
FROM   pg_class
WHERE  relnamespace = 'public'::regnamespace
  AND  relname = 'whatsapp_sends';
-- Esperado: relrowsecurity=true


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-4: Função existe com SECURITY DEFINER e search_path corretos
-- ═══════════════════════════════════════════════════════════════════════════
SELECT p.proname, r.rolname AS owner, p.prosecdef,
       p.proconfig AS configuracao
FROM   pg_proc p
JOIN   pg_roles r ON r.oid = p.proowner
WHERE  p.pronamespace = 'public'::regnamespace
  AND  p.proname = '_pode_enviar_whatsapp';
-- Esperado: owner=postgres | prosecdef=true | proconfig inclui 'search_path='


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-5: ACL da função — authenticated e anon NÃO têm EXECUTE
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  CASE WHEN (acl).grantee = 0 THEN 'PUBLIC'
       ELSE (acl).grantee::regrole::text
  END AS grantee,
  (acl).privilege_type AS privilegio
FROM (
  SELECT aclexplode(proacl) AS acl
  FROM   pg_proc
  WHERE  pronamespace = 'public'::regnamespace
    AND  proname = '_pode_enviar_whatsapp'
    AND  proacl IS NOT NULL
) sub
ORDER BY grantee;
-- Esperado: somente 'service_role' com EXECUTE
-- Não deve aparecer: PUBLIC, anon, authenticated


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-6: T3-A — membro sem consentimento retorna 'sem_consentimento'
-- ═══════════════════════════════════════════════════════════════════════════
-- Substituir <UUID_MEMBRO_SEM_OPT_IN> por um membro real com whatsapp_opt_in = false
/*
SELECT *
FROM   public._pode_enviar_whatsapp(
  '<UUID_MEMBRO_SEM_OPT_IN>'::uuid,
  'escala_publicada',
  gen_random_uuid()
);
-- Esperado: pode=false | telefone=NULL | motivo='sem_consentimento'
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-7: T3-B — membro com consentimento retorna pode=true
-- ═══════════════════════════════════════════════════════════════════════════
-- Substituir <UUID_MEMBRO_COM_OPT_IN> por um membro real com whatsapp_opt_in = true
/*
SELECT *
FROM   public._pode_enviar_whatsapp(
  '<UUID_MEMBRO_COM_OPT_IN>'::uuid,
  'escala_publicada',
  gen_random_uuid()
);
-- Esperado: pode=true | telefone='55XXXXXXXXXXX' | motivo=NULL
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-8: T3-C — deduplicação bloqueia segundo envio (BEGIN/ROLLBACK)
-- ═══════════════════════════════════════════════════════════════════════════
-- Substituir os UUIDs pelos valores reais de um membro com opt-in
/*
BEGIN;

-- Insere um registro 'sent' simulando envio anterior
INSERT INTO public.whatsapp_sends
  (membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash)
VALUES (
  '<UUID_MEMBRO>'::uuid,
  '<UUID_PAROQUIA>'::uuid,
  'escala_publicada',
  '<UUID_ESCALA>'::uuid,
  'sent',
  encode(digest('55119999XXXX', 'sha256'), 'hex')
);

-- Verifica que a função bloqueia novo envio para o mesmo triplo
SELECT *
FROM   public._pode_enviar_whatsapp(
  '<UUID_MEMBRO>'::uuid,
  'escala_publicada',
  '<UUID_ESCALA>'::uuid
);
-- Esperado: pode=false | telefone=NULL | motivo='duplicado'

-- Verifica que evento DIFERENTE não é bloqueado
SELECT *
FROM   public._pode_enviar_whatsapp(
  '<UUID_MEMBRO>'::uuid,
  'substituicao_aprovada',        -- evento_tipo diferente
  '<UUID_ESCALA>'::uuid
);
-- Esperado: pode=true | telefone=<número> | motivo=NULL

ROLLBACK;
-- Nada foi persistido.
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-9: T3-D — registro 'failed' NÃO bloqueia nova tentativa (BEGIN/ROLLBACK)
-- ═══════════════════════════════════════════════════════════════════════════
/*
BEGIN;

INSERT INTO public.whatsapp_sends
  (membro_id, paroquia_id, evento_tipo, evento_ref_id, status, telefone_hash)
VALUES (
  '<UUID_MEMBRO>'::uuid,
  '<UUID_PAROQUIA>'::uuid,
  'escala_publicada',
  '<UUID_ESCALA>'::uuid,
  'failed',
  encode(digest('55119999XXXX', 'sha256'), 'hex')
);

SELECT *
FROM   public._pode_enviar_whatsapp(
  '<UUID_MEMBRO>'::uuid,
  'escala_publicada',
  '<UUID_ESCALA>'::uuid
);
-- Esperado: pode=true — failed não bloqueia nova tentativa

ROLLBACK;
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- PÓS-10: UUID inválido retorna 'membro_nao_encontrado'
-- ═══════════════════════════════════════════════════════════════════════════
SELECT *
FROM   public._pode_enviar_whatsapp(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'escala_publicada',
  gen_random_uuid()
);
-- Esperado: pode=false | telefone=NULL | motivo='membro_nao_encontrado'
-- Este teste não requer substituição de UUID — pode ser executado diretamente.
