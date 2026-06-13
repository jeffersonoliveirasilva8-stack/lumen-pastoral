-- ============================================================
-- AUDITORIA DE NOTIFICAÇÕES — Lumen Pastoral
-- Data: 2026-06-13
-- Execute no SQL Editor do Supabase para verificar o estado atual.
--
-- REQUER: migrations 020 e 021 aplicadas.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 1 — Verificar triggers ativos e funções esperadas
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== TRIGGERS ESPERADOS ===' AS secao,
  trigger_name,
  event_object_table AS tabela,
  event_manipulation AS evento,
  CASE trigger_name
    WHEN 'notify_escala_membro'         THEN '✓ PRIVADO — destinatario_id = membro escalado'
    WHEN 'notify_ocorrencia_membro'     THEN '✓ COORD   — apenas_admin=true, notifica admins'
    WHEN 'notify_ocorrencia_respondida' THEN '✓ PRIVADO — destinatario_id = membro que abriu'
    WHEN 'on_escala_publicada_membros'  THEN '✓ PRIVADO — destinatario_id por membro escalado'
    WHEN 'on_escala_alterada'           THEN '✓ PRIVADO — destinatario_id por membro escalado'
    WHEN 'on_evento_criado'             THEN '✓ BROADCAST — todos membros da paróquia'
    WHEN 'on_indisponibilidade'         THEN '✓ COORD   — apenas_admin=true (fix 020)'
    WHEN 'on_falta_registrada'          THEN '✓ COORD   — apenas_admin=true (fix 020)'
    WHEN 'on_ocorrencia_escala'         THEN '✓ COORD   — apenas_admin=true (fix 020)'
    ELSE '⚠ NÃO ESPERADO'
  END AS status_esperado
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name NOT LIKE 'trg_audit_%'
  AND trigger_name NOT LIKE 'set_updated_at%'
ORDER BY event_object_table, trigger_name;

-- ── Triggers que NÃO devem existir ────────────────────────────
SELECT
  '=== TRIGGERS REMOVIDOS (não devem existir) ===' AS secao,
  t.trigger_name AS nome,
  'PROBLEMA: trigger legado ainda ativo!' AS alerta
FROM (
  VALUES
    ('on_membro_escalado'),
    ('on_escala_publicada'),
    ('notify_escala_publicada'),
    ('notify_escala_status'),
    ('trg_notify_escala_publish')
) AS esperados(trigger_name)
JOIN information_schema.triggers t
  ON t.trigger_name = esperados.trigger_name
  AND t.trigger_schema = 'public';

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 2 — Verificar policies RLS de notificacoes
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== POLICIES notificacoes ===' AS secao,
  policyname,
  cmd AS operacao,
  CASE policyname
    WHEN 'notif_membro_read'    THEN '✓ SELECT — membro vê apenas_admin=false + próprias'
    WHEN 'notif_membro_mark_read' THEN '✓ UPDATE — membro só atualiza notificações acessíveis'
    WHEN 'notif_membro_delete'  THEN '✓ DELETE — membro deleta apenas destinatario_id = próprio'
    WHEN 'notif_admin_manage'   THEN '✓ ALL    — admin gerencia todas da paróquia'
    ELSE '⚠ POLICY NÃO RECONHECIDA'
  END AS verificacao
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'notificacoes'
ORDER BY policyname;

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 3 — Verificar link_referencia nas notificações existentes
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== LINKS NAS NOTIFICAÇÕES (amostra últimas 100) ===' AS secao,
  COALESCE(link_referencia, '(sem link)') AS link,
  COUNT(*) AS qtd,
  CASE
    WHEN link_referencia IS NULL                        THEN '✓ Informativa (sem navegação)'
    WHEN link_referencia = '/portal-membro/escalas'    THEN '✓ Abre /portal-membro/escalas'
    WHEN link_referencia = '/portal-membro/ocorrencias' THEN '✓ Abre /portal-membro/ocorrencias'
    WHEN link_referencia = '/portal-membro/eventos'    THEN '✓ Abre /portal-membro/eventos'
    WHEN link_referencia = '/portal-membro/perfil'     THEN '✓ Abre /portal-membro/perfil'
    WHEN link_referencia = '/ocorrencias'              THEN '✓ Abre painel admin /ocorrencias'
    ELSE '⚠ LINK NÃO MAPEADO — verificar rota'
  END AS status_link
FROM public.notificacoes
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY link_referencia
ORDER BY qtd DESC;

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 4 — Verificar notificações que ainda vazam
--           (apenas_admin=false, destinatario_id=NULL, título suspeito)
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== POSSÍVEIS VAZAMENTOS (apenas_admin=false, broadcast, título sensível) ===' AS secao,
  id,
  titulo,
  tipo,
  created_at,
  'AÇÃO: definir apenas_admin=true se for informação privada' AS acao_necessaria
FROM public.notificacoes
WHERE apenas_admin = false
  AND destinatario_id IS NULL
  AND (
    titulo ILIKE 'Indisponibilidade:%'
    OR titulo ILIKE 'Falta:%'
    OR titulo ILIKE 'Ausência:%'
    OR titulo ILIKE 'Atraso:%'
    OR titulo ILIKE 'Ocorrência:%'
  )
ORDER BY created_at DESC
LIMIT 20;

-- Se retornar 0 linhas: ✓ sem vazamentos históricos após migration 020

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 5 — Verificar _notify_coordenacao é segura (apenas_admin=true)
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== DEFINIÇÃO ATUAL de _notify_coordenacao ===' AS secao,
  prosrc LIKE '%apenas_admin%' AS tem_apenas_admin,
  prosrc LIKE '%true%'         AS tem_true,
  CASE
    WHEN prosrc LIKE '%apenas_admin%' AND prosrc LIKE '%, true%'
    THEN '✓ CORRETA — insere com apenas_admin = true'
    ELSE '✗ PROBLEMA — função precisa ser corrigida (aplicar migration 020)'
  END AS status
FROM pg_proc
WHERE proname = '_notify_coordenacao'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 6 — Verificar atualizar_perfil_membro (sem user_id errado)
-- ══════════════════════════════════════════════════════════════

SELECT
  '=== DEFINIÇÃO ATUAL de atualizar_perfil_membro ===' AS secao,
  prosrc LIKE '%WHERE id = v_auth_id%'   AS usa_id_correto,
  prosrc LIKE '%WHERE user_id%'           AS usa_user_id_errado,
  CASE
    WHEN prosrc LIKE '%WHERE id = v_auth_id%' AND prosrc NOT LIKE '%WHERE user_id%'
    THEN '✓ CORRETA — profiles sync usa id (não user_id)'
    WHEN prosrc LIKE '%WHERE user_id%'
    THEN '✗ PROBLEMA — ainda usa user_id; aplicar migration 020'
    ELSE '? Verificar manualmente'
  END AS status
FROM pg_proc
WHERE proname = 'atualizar_perfil_membro'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
LIMIT 1;

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 7 — Simulação de visibilidade por tipo de usuário
-- (substitua os UUIDs por IDs reais para testar)
-- ══════════════════════════════════════════════════════════════

/*
-- Testar como Membro A (substitua :membro_a_auth_id e :paroquia_id):
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": ":membro_a_auth_id", "email": "membro_a@test.com"}';
SELECT id, titulo, apenas_admin, destinatario_id FROM public.notificacoes
WHERE paroquia_id = ':paroquia_id'
ORDER BY created_at DESC LIMIT 20;

-- Verificar: não deve aparecer nenhuma notificação com apenas_admin=true
-- Verificar: não deve aparecer notificação com destinatario_id de outro membro
*/

-- ══════════════════════════════════════════════════════════════
-- SEÇÃO 8 — Resumo consolidado
-- ══════════════════════════════════════════════════════════════

SELECT
  item,
  status,
  detalhe
FROM (VALUES
  ('notif_membro_read policy',     (SELECT COUNT(*)::text FROM pg_policies WHERE tablename='notificacoes' AND policyname='notif_membro_read'),    'policies ativas'),
  ('notif_admin_manage policy',    (SELECT COUNT(*)::text FROM pg_policies WHERE tablename='notificacoes' AND policyname='notif_admin_manage'),   'policies ativas'),
  ('notif_membro_delete tightened',(SELECT COUNT(*)::text FROM pg_policies WHERE tablename='notificacoes' AND policyname='notif_membro_delete'),  'policies ativas'),
  ('_notify_coordenacao segura',   (SELECT CASE WHEN prosrc LIKE '%, true%' THEN '✓ SIM' ELSE '✗ NÃO' END FROM pg_proc WHERE proname='_notify_coordenacao' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')), 'apenas_admin=true'),
  ('atualizar_perfil_membro safe', (SELECT CASE WHEN prosrc LIKE '%WHERE id = v_auth_id%' THEN '✓ SIM' ELSE '✗ NÃO' END FROM pg_proc WHERE proname='atualizar_perfil_membro' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public') LIMIT 1), 'sem erro user_id'),
  ('notify_escala_membro ativo',   (SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='notify_escala_membro' AND trigger_schema='public'), 'triggers'),
  ('notify_ocorrencia_membro ativo',(SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='notify_ocorrencia_membro' AND trigger_schema='public'), 'triggers'),
  ('on_escala_publicada_membros',  (SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='on_escala_publicada_membros' AND trigger_schema='public'), 'triggers'),
  ('on_indisponibilidade ativo',   (SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='on_indisponibilidade' AND trigger_schema='public'), 'triggers'),
  ('on_membro_escalado REMOVIDO',  (SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='on_membro_escalado' AND trigger_schema='public'), 'deve ser 0'),
  ('on_escala_publicada REMOVIDO', (SELECT COUNT(*)::text FROM information_schema.triggers WHERE trigger_name='on_escala_publicada' AND trigger_schema='public'), 'deve ser 0'),
  ('vazamentos históricos',        (SELECT COUNT(*)::text FROM public.notificacoes WHERE apenas_admin=false AND destinatario_id IS NULL AND titulo ILIKE ANY(ARRAY['Indisponibilidade:%','Falta:%','Ausência:%','Atraso:%','Ocorrência:%'])), 'deve ser 0')
) AS t(item, status, detalhe)
ORDER BY item;
