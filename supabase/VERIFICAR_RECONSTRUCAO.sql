-- ============================================================
-- VERIFICAR_RECONSTRUCAO.sql
-- Executar após aplicar migrations 001–037 em banco vazio.
-- Todas as queries devem retornar "OK" na coluna status.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 1 — TABELAS OBRIGATÓRIAS
-- ════════════════════════════════════════════════════════════

SELECT
  t.expected_table,
  CASE WHEN i.table_name IS NOT NULL THEN '✅ OK' ELSE '❌ FALTANDO' END AS status
FROM (VALUES
  ('paroquias'),
  ('membros'),
  ('ministerios'),
  ('ministerio_membros'),
  ('escalas'),
  ('escala_membros'),
  ('historico_participacoes'),
  ('historico_substituicoes'),
  ('indisponibilidades'),
  ('missas_padrao'),
  ('missa_padrao_funcoes'),
  ('homilia_sync_logs'),
  ('audit_log'),
  ('mfa_settings'),
  ('notificacoes'),
  ('solicitacoes_paroquia'),
  ('email_logs'),
  ('substituicoes'),
  ('paroquia_config_escalas'),
  ('escala_ocorrencias'),
  ('presencas_eventos'),
  -- Tabelas adicionadas via patches (agora em 037)
  ('tipos_prioridade'),
  ('comunidades'),
  ('coordenadores'),
  ('atuacoes_pastorais'),
  ('membro_atuacoes'),
  ('membro_funcao_restricoes'),
  -- Criada pelo Supabase automaticamente
  ('profiles')
) AS t(expected_table)
LEFT JOIN information_schema.tables i
  ON i.table_schema = 'public' AND i.table_name = t.expected_table
ORDER BY status, t.expected_table;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 2 — COLUNAS CRÍTICAS DE membros
-- ════════════════════════════════════════════════════════════

SELECT
  c.expected_col,
  CASE WHEN col.column_name IS NOT NULL THEN '✅ OK' ELSE '❌ FALTANDO' END AS status
FROM (VALUES
  -- Criadas na migration 001 (schema base)
  ('id'), ('paroquia_id'), ('nome'), ('email'), ('telefone'),
  ('data_nascimento'), ('data_ingresso'), ('observacoes'),
  ('ativo'), ('score'), ('forcar_escalacao_solene'), ('token_acesso'),
  -- Criadas em migrations específicas
  ('conta_ativada'),           -- 012
  ('perfil_completo'),         -- 012
  ('ativacao_enviada_em'),     -- 012
  ('prioridade_escala'),       -- 034 (promote_patches)
  -- Criadas em patches manuais, agora rastreadas em 037
  ('auth_user_id'),
  ('sexo'),
  ('tipo_acesso'),
  ('prioridade_id'),
  ('missas_nao_pode_ids'),
  ('restricoes_dia_semana'),
  ('foto_url'),
  ('comunidade_id'),
  ('cpf'), ('rg'), ('endereco'), ('cidade'), ('cep'),
  ('nome_emergencia'), ('telefone_emergencia'),
  ('nome_pais'), ('contato_pais'),
  ('restricoes_horario'), ('motivo_disponibilidade'),
  ('deslocamento'), ('planilha_url'),
  ('cpf_hash'), ('cpf_enc')
) AS c(expected_col)
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
  AND col.table_name  = 'membros'
  AND col.column_name = c.expected_col
ORDER BY status, c.expected_col;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 3 — FUNÇÕES OBRIGATÓRIAS
-- ════════════════════════════════════════════════════════════

SELECT
  f.expected_fn,
  CASE WHEN p.proname IS NOT NULL THEN '✅ OK' ELSE '❌ FALTANDO' END AS status
FROM (VALUES
  -- Helpers
  ('current_paroquia_id'),
  ('is_admin'),
  -- Portal
  ('portal_get_membro'),
  ('portal_get_escalas_membro'),
  ('portal_get_historico_membro'),
  ('portal_get_indisponibilidades_membro'),
  ('portal_responder_escala'),
  ('portal_add_indisponibilidade'),
  ('portal_remove_indisponibilidade'),
  ('portal_auto_link_by_email'),
  -- Auth / ativação
  ('ativar_conta_rpc'),
  ('reenviar_ativacao_rpc'),
  ('completar_cadastro_rpc'),
  ('admin_get_membro_perfil'),
  ('admin_update_membro_perfil'),
  -- Pontuação
  ('recalcular_score_membro'),
  ('auto_pontuar_escala'),
  -- Substituições
  ('portal_get_substituicoes_disponiveis'),
  ('portal_solicitar_substituicao'),
  ('admin_get_substituicoes'),
  ('admin_atualizar_substituicao'),
  -- Diagnóstico
  ('admin_reprocessar_pendentes'),
  ('admin_diagnostico_ativacao'),
  -- MFA
  ('check_admin_mfa_session')
) AS f(expected_fn)
LEFT JOIN pg_proc p
  ON p.proname = f.expected_fn
  AND p.pronamespace = 'public'::regnamespace
ORDER BY status, f.expected_fn;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 4 — TRIGGERS OBRIGATÓRIOS
-- ════════════════════════════════════════════════════════════

SELECT
  t.expected_trigger,
  t.expected_table,
  CASE WHEN tg.tgname IS NOT NULL THEN '✅ OK' ELSE '❌ FALTANDO' END AS status
FROM (VALUES
  ('on_escala_membro_status_final',  'escala_membros'),
  ('audit_escala_membros',           'escala_membros'),
  ('audit_historico',                'historico_participacoes'),
  ('on_substituicao_insert',         'substituicoes'),
  ('on_substituicao_update',         'substituicoes'),
  ('on_auth_user_created_mfa',       'users')     -- schema auth
) AS t(expected_trigger, expected_table)
LEFT JOIN pg_trigger tg
  ON tg.tgname = t.expected_trigger
ORDER BY status, t.expected_trigger;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 5 — TRIGGERS QUE NÃO DEVEM EXISTIR
-- ════════════════════════════════════════════════════════════

SELECT
  tg.tgname    AS trigger_problemático,
  c.relname    AS tabela,
  '❌ REMOVER' AS status
FROM pg_trigger tg
JOIN pg_class   c ON c.oid = tg.tgrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND tg.tgname IN (
    'historico_score_trigger',       -- removido em 036
    'tg_escala_membro_pontuacao'     -- removido via PATCH_REMOVE_TRIGGER_LEGADO.sql
  )
ORDER BY tg.tgname;
-- Esperado: 0 linhas

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 6 — RLS HABILITADO
-- ════════════════════════════════════════════════════════════

SELECT
  tablename,
  CASE WHEN rowsecurity THEN '✅ OK' ELSE '❌ RLS DESABILITADO' END AS status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'paroquias', 'membros', 'ministerios', 'ministerio_membros',
    'escalas', 'escala_membros', 'historico_participacoes',
    'indisponibilidades', 'notificacoes', 'substituicoes',
    'audit_log', 'email_logs', 'profiles',
    'tipos_prioridade', 'comunidades', 'coordenadores',
    'atuacoes_pastorais', 'membro_atuacoes', 'membro_funcao_restricoes'
  )
ORDER BY status, tablename;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 7 — ÍNDICES CRÍTICOS
-- ════════════════════════════════════════════════════════════

SELECT
  i.expected_index,
  CASE WHEN ix.indexname IS NOT NULL THEN '✅ OK' ELSE '❌ FALTANDO' END AS status
FROM (VALUES
  ('idx_membros_auth_user_id'),
  ('idx_membros_auth_user_id_unique'),
  ('idx_membros_paroquia_id'),
  ('idx_escala_membros_membro_id'),
  ('idx_escala_membros_escala_id'),
  ('idx_historico_participacoes_membro_id'),
  ('idx_historico_participacoes_paroquia_id'),
  ('idx_notificacoes_destinatario_id'),
  ('idx_notificacoes_paroquia_id'),
  ('idx_indisponibilidades_membro_data'),
  ('atuacoes_pastorais_paroquia_idx')
) AS i(expected_index)
LEFT JOIN pg_indexes ix
  ON ix.schemaname = 'public' AND ix.indexname = i.expected_index
ORDER BY status, i.expected_index;

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 8 — POLICY membro_self_link SEGURA
-- Deve conter paroquia_id na cláusula USING
-- ════════════════════════════════════════════════════════════

SELECT
  policyname,
  CASE
    WHEN qual ILIKE '%paroquia_id%' THEN '✅ OK — cross-paróquia bloqueado'
    ELSE '❌ VULNERÁVEL — paroquia_id ausente do USING'
  END AS status,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'membros'
  AND policyname = 'membro_self_link';

-- ════════════════════════════════════════════════════════════
-- SEÇÃO 9 — INTEGRIDADE DE SCORES (banco com dados)
-- ════════════════════════════════════════════════════════════

SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '✅ OK — nenhum score divergente'
    ELSE '❌ ' || COUNT(*) || ' membros com score incorreto'
  END AS status
FROM public.membros m
WHERE m.ativo = true
  AND m.score != COALESCE(
    (SELECT SUM(hp.pontos)
     FROM public.historico_participacoes hp
     WHERE hp.membro_id = m.id),
    0
  );

-- ════════════════════════════════════════════════════════════
-- RESUMO FINAL — copie este bloco para o relatório
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  n_tabelas_ok    INT;
  n_tabelas_miss  INT;
  n_colunas_ok    INT;
  n_colunas_miss  INT;
  n_fn_ok         INT;
  n_fn_miss       INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE i.table_name IS NOT NULL),
    COUNT(*) FILTER (WHERE i.table_name IS NULL)
  INTO n_tabelas_ok, n_tabelas_miss
  FROM (VALUES
    ('paroquias'),('membros'),('ministerios'),('escalas'),
    ('escala_membros'),('historico_participacoes'),('substituicoes'),
    ('tipos_prioridade'),('comunidades'),('coordenadores'),
    ('atuacoes_pastorais'),('membro_atuacoes'),('membro_funcao_restricoes'),
    ('profiles')
  ) AS t(expected_table)
  LEFT JOIN information_schema.tables i
    ON i.table_schema = 'public' AND i.table_name = t.expected_table;

  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'RESULTADO DA RECONSTRUÇÃO:';
  RAISE NOTICE '  Tabelas:  % OK / % faltando', n_tabelas_ok, n_tabelas_miss;
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'SE TODOS OK: banco pode ser reconstruído do zero via migrations 001-037';
END $$;
