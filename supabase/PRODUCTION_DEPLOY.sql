-- ============================================================
-- LUMEN PASTORAL — DEPLOY DE PRODUÇÃO
-- Versão: 2026-06-09
--
-- EXECUTE TODO ESTE SCRIPT NO SQL EDITOR DO SUPABASE.
-- É idempotente: pode ser executado múltiplas vezes sem dano.
--
-- Contém:
--   1. Funções auxiliares de segurança (RLS helpers)
--   2. RLS — indisponibilidades
--   3. RLS — escala_membros
--   4. RLS — notificacoes
--   5. RLS — ocorrencias_membros (tabela + policies + trigger)
--   6. Colunas extras em homilias_diarias
--   7. Sincronização auth_user_id nos membros
--   8. Homilia sync logs + funções cron
--   9. Recarregar schema PostgREST
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. FUNÇÕES AUXILIARES (RLS HELPERS)
-- ════════════════════════════════════════════════════════════

-- Retorna o ID do membro autenticado (por auth_user_id ou por e-mail)
CREATE OR REPLACE FUNCTION public._portal_membro_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM membros
     WHERE auth_user_id = auth.uid() AND ativo = true
     LIMIT 1),
    (SELECT id FROM membros
     WHERE lower(trim(coalesce(email,''))) =
           lower(trim(coalesce(
             (SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1), ''
           )))
       AND ativo = true
     LIMIT 1)
  );
$$;

-- Retorna paroquia_id de um membro pelo ID
CREATE OR REPLACE FUNCTION public._portal_membro_paroquia(p_membro_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM membros WHERE id = p_membro_id LIMIT 1;
$$;

-- Retorna paroquia_id de uma escala pelo ID
CREATE OR REPLACE FUNCTION public._portal_escala_paroquia(p_escala_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT paroquia_id FROM escalas WHERE id = p_escala_id LIMIT 1;
$$;

-- Verifica se o usuário autenticado é admin da paróquia
CREATE OR REPLACE FUNCTION public._portal_is_admin(p_paroquia_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role IN ('super_admin', 'admin_paroquial', 'lider')
      AND (paroquia_id = p_paroquia_id OR paroquia_id IS NULL)
  );
$$;

-- Verifica se um membro é coordenador ativo
CREATE OR REPLACE FUNCTION public._portal_is_coord(p_membro_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  );
$$;

-- ════════════════════════════════════════════════════════════
-- 2. INDISPONIBILIDADES — RLS
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "indisponibilidades_paroquia" ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_membro_own"           ON indisponibilidades;
DROP POLICY IF EXISTS "indisp_admin_all"            ON indisponibilidades;

-- Membro gerencia apenas as próprias indisponibilidades
CREATE POLICY "indisp_membro_own" ON indisponibilidades
  FOR ALL TO authenticated
  USING  (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

-- Admin gerencia todas da paróquia
CREATE POLICY "indisp_admin_all" ON indisponibilidades
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON indisponibilidades TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. ESCALA_MEMBROS — RLS
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON escala_membros;
DROP POLICY IF EXISTS "em_membro_read_own"               ON escala_membros;
DROP POLICY IF EXISTS "em_membro_update_own"             ON escala_membros;
DROP POLICY IF EXISTS "em_coord_read"                    ON escala_membros;
DROP POLICY IF EXISTS "em_coord_update"                  ON escala_membros;
DROP POLICY IF EXISTS "em_coord_manage"                  ON escala_membros;
DROP POLICY IF EXISTS "em_admin_all"                     ON escala_membros;

-- Membro vê TODOS os escalados da paróquia em escalas publicadas
CREATE POLICY "membro_read_escala_paroquia_full" ON escala_membros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.paroquia_id = _portal_escala_paroquia(escala_membros.escala_id)
        AND m.auth_user_id = auth.uid()
        AND m.ativo = true
    )
    OR _portal_is_admin(_portal_escala_paroquia(escala_membros.escala_id))
  );

-- Membro confirma/recusa apenas a própria posição
CREATE POLICY "em_membro_update_own" ON escala_membros
  FOR UPDATE TO authenticated
  USING  (membro_id = _portal_membro_id())
  WITH CHECK (membro_id = _portal_membro_id());

-- Admin gerencia todos os membros das suas escalas
CREATE POLICY "em_admin_all" ON escala_membros
  FOR ALL TO authenticated
  USING  (_portal_is_admin(_portal_escala_paroquia(escala_id)))
  WITH CHECK (_portal_is_admin(_portal_escala_paroquia(escala_id)));

-- Coordenador gerencia escalas da sua paróquia
CREATE POLICY "em_coord_manage" ON escala_membros
  FOR ALL TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  )
  WITH CHECK (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON escala_membros TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. NOTIFICAÇÕES — RLS
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_membro_read"       ON notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read"  ON notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"      ON notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"   ON notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"     ON notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"         ON notificacoes;

-- Membro lê notificações da sua paróquia
CREATE POLICY "notif_membro_read" ON notificacoes
  FOR SELECT TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Membro pode marcar notificação como lida
CREATE POLICY "notif_membro_mark_read" ON notificacoes
  FOR UPDATE TO authenticated
  USING (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  )
  WITH CHECK (
    paroquia_id = _portal_membro_paroquia(_portal_membro_id())
    OR _portal_is_admin(paroquia_id)
  );

-- Admin cria, atualiza e deleta notificações da paróquia
CREATE POLICY "notif_admin_manage" ON notificacoes
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON notificacoes TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 5. OCORRÊNCIAS — Tabela + RLS + Trigger de notificação
-- ════════════════════════════════════════════════════════════

-- 5a. Tabela
CREATE TABLE IF NOT EXISTS public.ocorrencias_membros (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id    uuid        NOT NULL REFERENCES public.paroquias(id)  ON DELETE CASCADE,
  membro_id      uuid        NOT NULL REFERENCES public.membros(id)    ON DELETE CASCADE,
  tipo           text        NOT NULL,
  titulo         text        NOT NULL,
  descricao      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'aberta',
  resposta       text,
  respondido_por uuid        REFERENCES public.membros(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ocorrencias_membros_paroquia_idx ON public.ocorrencias_membros (paroquia_id);
CREATE INDEX IF NOT EXISTS ocorrencias_membros_membro_idx   ON public.ocorrencias_membros (membro_id);
CREATE INDEX IF NOT EXISTS ocorrencias_membros_status_idx   ON public.ocorrencias_membros (status);

ALTER TABLE public.ocorrencias_membros ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocorrencias_membros TO authenticated;
GRANT ALL                             ON public.ocorrencias_membros TO service_role;

-- 5b. Trigger updated_at
CREATE OR REPLACE FUNCTION public._ocorrencia_membro_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ocorrencias_membros_updated_at ON public.ocorrencias_membros;
CREATE TRIGGER ocorrencias_membros_updated_at
  BEFORE UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._ocorrencia_membro_updated_at();

-- 5c. RLS
DROP POLICY IF EXISTS "ocorrencia_membro_read_own"  ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_insert"    ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_delete"    ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_read"       ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_update"     ON public.ocorrencias_membros;

-- Membro lê as próprias ocorrências
CREATE POLICY "ocorrencia_membro_read_own" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (membro_id = _portal_membro_id());

-- Membro cria ocorrências na sua paróquia
CREATE POLICY "ocorrencia_membro_insert" ON public.ocorrencias_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = _portal_membro_id()
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = _portal_membro_id()
        AND m.paroquia_id = ocorrencias_membros.paroquia_id
        AND m.ativo = true
    )
  );

-- Membro exclui apenas ocorrências próprias abertas sem resposta
CREATE POLICY "ocorrencia_membro_delete" ON public.ocorrencias_membros
  FOR DELETE TO authenticated
  USING (
    membro_id = _portal_membro_id()
    AND status = 'aberta'
    AND (resposta IS NULL OR resposta = '')
  );

-- Admin/coordenador lê todas as ocorrências da paróquia
CREATE POLICY "ocorrencia_admin_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR _portal_is_coord(_portal_membro_id())
  );

-- Admin atualiza (status + resposta)
CREATE POLICY "ocorrencia_admin_update" ON public.ocorrencias_membros
  FOR UPDATE TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- 5d. Trigger: notifica a paróquia quando membro abre ocorrência
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_membro_nome text;
  v_tipo_label  text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  v_tipo_label := CASE NEW.tipo
    WHEN 'problema_pastoral'      THEN 'Problema pastoral'
    WHEN 'dificuldade_pessoal'    THEN 'Dificuldade pessoal'
    WHEN 'ausencia_futura'        THEN 'Ausência futura'
    WHEN 'situacao_urgente'       THEN 'Situação urgente'
    WHEN 'observacao_coordenacao' THEN 'Observação para coordenação'
    ELSE NEW.tipo
  END;

  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ' — ' || NEW.titulo,
    'Registrado por ' || COALESCE(v_membro_nome, 'membro') || ': ' || left(NEW.descricao, 200),
    CASE WHEN NEW.tipo = 'situacao_urgente' THEN 'urgente' ELSE 'alerta' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- ════════════════════════════════════════════════════════════
-- 6. HOMILIAS_DIARIAS — colunas extras
-- ════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.homilias_diarias
  ADD COLUMN IF NOT EXISTS video_id      text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS youtube_url   text,
  ADD COLUMN IF NOT EXISTS autor         text DEFAULT 'Padre Paulo Ricardo';

-- ════════════════════════════════════════════════════════════
-- 7. SINCRONIZAR auth_user_id nos membros
-- ════════════════════════════════════════════════════════════
-- Vincula membros existentes que têm conta Auth mas auth_user_id NULL
UPDATE public.membros m
SET    auth_user_id = au.id
FROM   auth.users au
WHERE  lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(au.email,'')))
  AND  m.auth_user_id IS NULL
  AND  m.ativo = true
  AND  au.email IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 8. HOMILIA SYNC — Tabela de logs + funções cron
--    (pg_cron e pg_net devem estar habilitados)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.homilia_sync_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em  timestamptz NOT NULL DEFAULT now(),
  data_alvo     date        NOT NULL,
  sucesso       boolean     NOT NULL,
  strategy      text,
  detalhes      jsonb,
  erro          text
);

ALTER TABLE public.homilia_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "homilia_logs_admin_read" ON public.homilia_sync_logs;
CREATE POLICY "homilia_logs_admin_read"
  ON public.homilia_sync_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin_paroquial', 'super_admin')
    )
  );

GRANT SELECT ON public.homilia_sync_logs TO authenticated;
GRANT ALL    ON public.homilia_sync_logs TO service_role;

CREATE OR REPLACE FUNCTION public.sync_homilia_diaria()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $func$
DECLARE
  v_url    text    := 'https://cusuoggmlhtvrclrzvfr.supabase.co/functions/v1/homilia-diaria';
  -- VAULT: chave removida — auditoria de segurança 2026-06-10
  -- Use PATCH_I_HOMILIA_RESILIENTE_2026_06_10.sql (lê do vault.decrypted_secrets)
  v_anon   text    := '<VAULT:homilia_anon_key>';
  v_req_id bigint;
  v_hoje   date    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body    := jsonb_build_object('date', to_char(v_hoje, 'YYYY-MM-DD'))
  ) INTO v_req_id;

  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, detalhes)
  VALUES (v_hoje, true, jsonb_build_object('pg_net_request_id', v_req_id));

EXCEPTION WHEN others THEN
  INSERT INTO public.homilia_sync_logs(data_alvo, sucesso, erro)
  VALUES (v_hoje, false, SQLERRM);
END;
$func$;

CREATE OR REPLACE FUNCTION public.sync_homilia_se_ausente()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $func$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.homilias_diarias WHERE data = v_hoje) THEN
    PERFORM public.sync_homilia_diaria();
  END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.sync_homilia_diaria()     TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_homilia_se_ausente() TO service_role;

-- Cron principal: 07:00 Brasília (10:00 UTC)
SELECT cron.unschedule('homilia-diaria-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-sync');
SELECT cron.schedule('homilia-diaria-sync', '0 10 * * *',
  'SELECT public.sync_homilia_diaria()');

-- Cron fallback: 10:00 Brasília (13:00 UTC)
SELECT cron.unschedule('homilia-diaria-fallback')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-fallback');
SELECT cron.schedule('homilia-diaria-fallback', '0 13 * * *',
  'SELECT public.sync_homilia_se_ausente()');

-- Cron tarde: 16:00 Brasília (19:00 UTC)
SELECT cron.unschedule('homilia-diaria-tarde')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homilia-diaria-tarde');
SELECT cron.schedule('homilia-diaria-tarde', '0 19 * * *',
  'SELECT public.sync_homilia_se_ausente()');

-- ════════════════════════════════════════════════════════════
-- 9. RECARREGAR SCHEMA POSTGREST
-- ════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- FIM DO SCRIPT
-- Próximos passos manuais:
--   1. Configurar service_role key (se ainda não fez):
--      ALTER DATABASE postgres SET app.service_role_key = 'sua_chave';
--   2. Deploy da Edge Function:
--      supabase functions deploy homilia-diaria
--   3. Verificar:
--      SELECT jobname, schedule FROM cron.job;
--      SELECT public.sync_homilia_diaria();
-- ════════════════════════════════════════════════════════════
