-- ============================================================
-- Migration 009: Audit Log
-- Data: 2026-06-10
-- Objetivo: Rastreabilidade completa de todas as ações críticas
--           do sistema (quem fez o quê, quando, em qual paróquia).
-- ============================================================

-- ── 1. Tabela principal ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id      uuid        REFERENCES public.paroquias(id) ON DELETE SET NULL,
  actor_user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_nome       text,
  entidade         text        NOT NULL,   -- 'membros', 'escalas', 'user_roles', etc.
  entidade_id      uuid,
  acao             text        NOT NULL,   -- 'INSERT', 'UPDATE', 'DELETE'
  dados_anteriores jsonb,
  dados_novos      jsonb,
  ip               inet,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.audit_logs                    IS 'Registro imutável de todas as ações críticas do sistema.';
COMMENT ON COLUMN public.audit_logs.entidade           IS 'Nome da tabela afetada (membros, escalas, user_roles, etc.).';
COMMENT ON COLUMN public.audit_logs.acao               IS 'Tipo da operação: INSERT, UPDATE, DELETE.';
COMMENT ON COLUMN public.audit_logs.dados_anteriores   IS 'Estado da linha ANTES da modificação (null em INSERT).';
COMMENT ON COLUMN public.audit_logs.dados_novos        IS 'Estado da linha APÓS a modificação (null em DELETE).';

-- ── 2. Índices ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS audit_logs_paroquia_idx   ON public.audit_logs (paroquia_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx      ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entidade_idx   ON public.audit_logs (entidade, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);

-- ── 3. RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Admins e coordenadores veem apenas logs da própria paróquia
CREATE POLICY "audit_logs_paroquia_read" ON public.audit_logs
  FOR SELECT
  USING (
    paroquia_id = current_paroquia_id()
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'coordenador', 'super_admin')
    )
  );

-- super_admin vê tudo
CREATE POLICY "audit_logs_super_admin" ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Ninguém pode INSERT/UPDATE/DELETE manualmente (apenas triggers)
-- service_role é o único com ALL (para os triggers SECURITY DEFINER)
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL    ON public.audit_logs TO service_role;

-- ── 4. Função genérica de auditoria ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id    uuid;
  v_entidade_id    uuid;
  v_dados_ant      jsonb;
  v_dados_novos    jsonb;
  v_actor_id       uuid;
  v_actor_nome     text;
  v_acao           text;

  -- Campos a omitir dos dados auditados (sensíveis ou desnecessários)
  v_omit_fields    text[] := ARRAY[
    'token_acesso', 'token_acesso_expires_at',
    'cpf', 'rg', 'senha', 'password'
  ];
BEGIN
  v_acao := TG_OP;  -- INSERT, UPDATE, DELETE

  -- ── Identifica o actor pelo JWT ──
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NOT NULL THEN
    SELECT nome_completo INTO v_actor_nome
    FROM public.profiles WHERE id = v_actor_id;
  END IF;

  -- ── Extrai paroquia_id e entidade_id ──
  CASE TG_OP
    WHEN 'INSERT', 'UPDATE' THEN
      v_dados_novos := to_jsonb(NEW);
      v_entidade_id := (to_jsonb(NEW) ->> 'id')::uuid;
      v_paroquia_id := (to_jsonb(NEW) ->> 'paroquia_id')::uuid;
    WHEN 'DELETE' THEN
      v_dados_ant   := to_jsonb(OLD);
      v_entidade_id := (to_jsonb(OLD) ->> 'id')::uuid;
      v_paroquia_id := (to_jsonb(OLD) ->> 'paroquia_id')::uuid;
  END CASE;

  IF TG_OP = 'UPDATE' THEN
    v_dados_ant := to_jsonb(OLD);
  END IF;

  -- ── Remove campos sensíveis ──
  DECLARE
    v_field text;
  BEGIN
    FOREACH v_field IN ARRAY v_omit_fields LOOP
      v_dados_novos := v_dados_novos - v_field;
      v_dados_ant   := v_dados_ant   - v_field;
    END LOOP;
  END;

  -- ── Em UPDATE, guarda apenas os campos que mudaram ──
  IF TG_OP = 'UPDATE' THEN
    DECLARE
      v_key      text;
      v_changed  jsonb := '{}'::jsonb;
    BEGIN
      FOR v_key IN SELECT jsonb_object_keys(v_dados_novos) LOOP
        IF (v_dados_ant ->> v_key) IS DISTINCT FROM (v_dados_novos ->> v_key) THEN
          v_changed := v_changed || jsonb_build_object(v_key, v_dados_novos -> v_key);
        END IF;
      END LOOP;
      -- Se nada mudou de fato, não registra
      IF v_changed = '{}'::jsonb THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
      END IF;
      v_dados_novos := v_changed;
    END;
  END IF;

  -- ── Insere o log ──
  INSERT INTO public.audit_logs (
    paroquia_id, actor_user_id, actor_nome,
    entidade, entidade_id, acao,
    dados_anteriores, dados_novos
  ) VALUES (
    v_paroquia_id, v_actor_id, v_actor_nome,
    TG_TABLE_NAME, v_entidade_id, v_acao,
    v_dados_ant, v_dados_novos
  );

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;

EXCEPTION WHEN OTHERS THEN
  -- Audit failure NEVER blocks the operation
  RAISE WARNING '[audit] Falha ao registrar log de % em %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.fn_audit_trigger()
  IS 'Trigger genérico de auditoria. Falha de log nunca bloqueia a operação original.';

-- ── 5. Aplicar triggers nas tabelas críticas ───────────────────────────

-- membros
DROP TRIGGER IF EXISTS audit_membros ON public.membros;
CREATE TRIGGER audit_membros
  AFTER INSERT OR UPDATE OR DELETE ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- escalas
DROP TRIGGER IF EXISTS audit_escalas ON public.escalas;
CREATE TRIGGER audit_escalas
  AFTER INSERT OR UPDATE OR DELETE ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- escala_membros (confirmações e recusas)
DROP TRIGGER IF EXISTS audit_escala_membros ON public.escala_membros;
CREATE TRIGGER audit_escala_membros
  AFTER INSERT OR UPDATE OR DELETE ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- historico_participacoes (pontuação)
DROP TRIGGER IF EXISTS audit_historico ON public.historico_participacoes;
CREATE TRIGGER audit_historico
  AFTER INSERT OR UPDATE OR DELETE ON public.historico_participacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ocorrencias_membros
DROP TRIGGER IF EXISTS audit_ocorrencias_membros ON public.ocorrencias_membros;
CREATE TRIGGER audit_ocorrencias_membros
  AFTER INSERT OR UPDATE OR DELETE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- user_roles (permissões)
DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- paroquias (configurações)
DROP TRIGGER IF EXISTS audit_paroquias ON public.paroquias;
CREATE TRIGGER audit_paroquias
  AFTER UPDATE ON public.paroquias
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ── 6. Cron: limpeza de logs > 2 anos ─────────────────────────────────

SELECT cron.unschedule('audit-logs-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-logs-cleanup');

SELECT cron.schedule(
  'audit-logs-cleanup',
  '0 3 1 * *',  -- todo dia 1º do mês às 03:00 UTC
  $$DELETE FROM public.audit_logs WHERE created_at < now() - INTERVAL '2 years'$$
);
