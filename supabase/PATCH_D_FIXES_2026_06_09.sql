-- ============================================================
-- LUMEN PASTORAL — PATCH D (2026-06-09)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- Idempotente: seguro para executar múltiplas vezes.
--
-- Resolve 4 bugs reportados:
--   1. "0 escalados" no portal do membro — policy usava auth_user_id
--      direto (NULL antes do auto-link). Agora usa _portal_membro_id()
--      com fallback por e-mail (SECURITY DEFINER).
--   2. "Não foi possível excluir" — policy ocorrencia_membro_delete
--      pode não existir. Garante criação da tabela + todas as policies.
--   3. Admin não vê ocorrências — policy ocorrencia_admin_read pode
--      não existir. Garante criação.
--   4. Fluxo de autorização — garante portal_auto_link_by_email RPC
--      e sincroniza auth_user_id para membros já cadastrados.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. HELPER: _portal_membro_id() com fallback por e-mail
-- ══════════════════════════════════════════════════════════════
-- SECURITY DEFINER: a subquery em membros e auth.users não é
-- bloqueada por RLS, permitindo encontrar o membro mesmo antes
-- de auth_user_id ser preenchido (primeiro acesso via OTP).
CREATE OR REPLACE FUNCTION public._portal_membro_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM membros
     WHERE auth_user_id = auth.uid() AND ativo = true
     LIMIT 1),
    (SELECT id FROM membros
     WHERE lower(trim(coalesce(email, ''))) =
           lower(trim(coalesce(
             (SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1), ''
           )))
       AND ativo = true
     LIMIT 1)
  );
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. HELPER: portal_auto_link_by_email (garante existência)
-- ══════════════════════════════════════════════════════════════
-- Vincula auth.uid() ao membro pelo email, cria profile e role.
-- Chamado pelo hook use-membro-auth no primeiro acesso.
CREATE OR REPLACE FUNCTION public.portal_auto_link_by_email()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_email       TEXT;
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_nome        TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_auth_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_email');
  END IF;

  SELECT id, paroquia_id, nome
  INTO   v_membro_id, v_paroquia_id, v_nome
  FROM   membros
  WHERE  LOWER(email) = LOWER(v_email)
    AND  (auth_user_id IS NULL OR auth_user_id = v_auth_id)
    AND  ativo = true
  ORDER  BY created_at ASC
  LIMIT  1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'member_not_found');
  END IF;

  UPDATE membros SET auth_user_id = v_auth_id WHERE id = v_membro_id;

  INSERT INTO profiles (id, email, nome_completo, paroquia_id)
  VALUES (v_auth_id, v_email, v_nome, v_paroquia_id)
  ON CONFLICT (id) DO UPDATE
    SET nome_completo = EXCLUDED.nome_completo,
        paroquia_id   = EXCLUDED.paroquia_id,
        email         = EXCLUDED.email;

  INSERT INTO user_roles (user_id, paroquia_id, role)
  VALUES (v_auth_id, v_paroquia_id, 'membro')
  ON CONFLICT (user_id, paroquia_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id, 'nome', v_nome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_auto_link_by_email TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. SINCRONIZAR auth_user_id para membros já cadastrados
-- ══════════════════════════════════════════════════════════════
-- Vincula membros existentes com conta auth criada mas sem link.
UPDATE public.membros m
SET    auth_user_id = au.id
FROM   auth.users au
WHERE  lower(trim(coalesce(m.email, ''))) = lower(trim(coalesce(au.email, '')))
  AND  m.auth_user_id IS NULL
  AND  m.ativo = true
  AND  au.email IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 4. escala_membros — visibilidade completa (bug "0 escalados")
-- ══════════════════════════════════════════════════════════════
-- Usa _portal_membro_id() (SECURITY DEFINER com fallback e-mail)
-- em vez de m.auth_user_id = auth.uid() diretamente, para cobrir
-- membros cujo auth_user_id ainda não foi preenchido.
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;

CREATE POLICY "membro_read_escala_paroquia_full" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.escalas e
        WHERE e.id = escala_membros.escala_id
          AND e.status = 'publicada'
      )
      AND public._portal_escala_paroquia(escala_membros.escala_id)
          = public._portal_membro_paroquia(public._portal_membro_id())
    )
    OR public._portal_is_admin(public._portal_escala_paroquia(escala_membros.escala_id))
    OR public._portal_is_coord(public._portal_membro_id())
  );

-- ══════════════════════════════════════════════════════════════
-- 5. escalas — policy de leitura para membros (de PATCH_B)
-- ══════════════════════════════════════════════════════════════
-- Sem esta policy, a listagem de escalas no portal retorna vazio.
DROP POLICY IF EXISTS "escalas_membro_read_publicadas" ON public.escalas;
DROP POLICY IF EXISTS "escalas_admin_all"              ON public.escalas;

CREATE POLICY "escalas_membro_read_publicadas" ON public.escalas
  FOR SELECT TO authenticated
  USING (
    (
      status = 'publicada'
      AND paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
    )
    OR public._portal_is_admin(paroquia_id)
    OR public._portal_is_coord(public._portal_membro_id())
  );

CREATE POLICY "escalas_admin_all" ON public.escalas
  FOR ALL TO authenticated
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

GRANT SELECT ON public.escalas TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 6. ocorrencias_membros — tabela + RLS + triggers
-- ══════════════════════════════════════════════════════════════

-- 6a. Tabela
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
GRANT ALL ON public.ocorrencias_membros TO service_role;

-- 6b. Trigger updated_at
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

-- 6c. RLS
DROP POLICY IF EXISTS "ocorrencia_membro_read_own"  ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_insert"    ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_membro_delete"    ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_read"       ON public.ocorrencias_membros;
DROP POLICY IF EXISTS "ocorrencia_admin_update"     ON public.ocorrencias_membros;

-- Membro lê as próprias ocorrências
CREATE POLICY "ocorrencia_membro_read_own" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (membro_id = public._portal_membro_id());

-- Membro cria ocorrências na sua paróquia
CREATE POLICY "ocorrencia_membro_insert" ON public.ocorrencias_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = public._portal_membro_id()
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = public._portal_membro_id()
        AND m.paroquia_id = ocorrencias_membros.paroquia_id
        AND m.ativo = true
    )
  );

-- Membro exclui apenas as próprias ocorrências abertas sem resposta
CREATE POLICY "ocorrencia_membro_delete" ON public.ocorrencias_membros
  FOR DELETE TO authenticated
  USING (
    membro_id = public._portal_membro_id()
    AND status = 'aberta'
    AND (resposta IS NULL OR resposta = '')
  );

-- Admin e coordenador leem todas as ocorrências da paróquia
CREATE POLICY "ocorrencia_admin_read" ON public.ocorrencias_membros
  FOR SELECT TO authenticated
  USING (
    public._portal_is_admin(paroquia_id)
    OR public._portal_is_coord(public._portal_membro_id())
  );

-- Admin atualiza (status + resposta)
CREATE POLICY "ocorrencia_admin_update" ON public.ocorrencias_membros
  FOR UPDATE TO authenticated
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

-- 6d. Trigger: notifica a paróquia quando membro abre ocorrência
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

  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, link_referencia)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ' — ' || NEW.titulo,
    'Registrado por ' || COALESCE(v_membro_nome, 'membro') || ': ' || left(NEW.descricao, 200),
    CASE WHEN NEW.tipo = 'situacao_urgente' THEN 'urgente' ELSE 'alerta' END,
    '/ocorrencias'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- 6e. Trigger: notifica membro quando ocorrência recebe resposta
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_respondida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF (OLD.resposta IS NOT DISTINCT FROM NEW.resposta AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.resposta IS NOT NULL AND (OLD.resposta IS NULL OR OLD.resposta <> NEW.resposta) THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Sua ocorrência recebeu uma resposta',
      left(NEW.resposta, 200),
      'alerta',
      '/portal-membro/ocorrencias'
    );
  ELSIF OLD.status <> NEW.status THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Status da ocorrência atualizado: ' || NEW.status,
      'Sua ocorrência "' || left(NEW.titulo, 80) || '" foi atualizada.',
      'sistema',
      '/portal-membro/ocorrencias'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_respondida ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_respondida
  AFTER UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_respondida();

-- ══════════════════════════════════════════════════════════════
-- 7. notificacoes — coluna destinatario_id (de PATCH_B)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS destinatario_id uuid
    REFERENCES public.membros(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notificacoes_destinatario_idx
  ON public.notificacoes(destinatario_id);

-- Atualiza policies para incluir destinatario_id
DROP POLICY IF EXISTS "notif_membro_read"      ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read" ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"     ON public.notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"  ON public.notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"    ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"        ON public.notificacoes;

-- Membro lê: notificações da paróquia sem destinatário OU destinadas a ele
CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    (
      paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = public._portal_membro_id())
    )
    OR public._portal_is_admin(paroquia_id)
  );

CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    (
      paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = public._portal_membro_id())
    )
    OR public._portal_is_admin(paroquia_id)
  )
  WITH CHECK (
    (
      paroquia_id = public._portal_membro_paroquia(public._portal_membro_id())
      AND (destinatario_id IS NULL OR destinatario_id = public._portal_membro_id())
    )
    OR public._portal_is_admin(paroquia_id)
  );

CREATE POLICY "notif_admin_manage" ON public.notificacoes
  FOR ALL TO authenticated
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 8. Trigger: notifica membro escalado (de PATCH_B)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo   text;
  v_data     date;
  v_paroquia uuid;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id
  INTO   v_titulo, v_data, v_paroquia
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia)
  VALUES (
    v_paroquia,
    NEW.membro_id,
    'Você foi escalado(a): ' || v_titulo,
    'Data: ' || to_char(v_data, 'DD/MM/YYYY') || '. Confirme ou recuse sua participação no portal.',
    'aviso',
    '/portal-membro/escalas'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_escala_membro ON public.escala_membros;
CREATE TRIGGER notify_escala_membro
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_escala_membro();

-- ══════════════════════════════════════════════════════════════
-- 9. Recarregar schema PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- Validação rápida
-- ══════════════════════════════════════════════════════════════
SELECT
  'PATCH D aplicado com sucesso' AS status,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'ocorrencias_membros')               AS policies_ocorrencias,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'escala_membros'
     AND policyname = 'membro_read_escala_paroquia_full')                                  AS policy_escalados_full,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'escalas'
     AND policyname = 'escalas_membro_read_publicadas')                                    AS policy_escalas_publicadas,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'notificacoes' AND column_name = 'destinatario_id')                AS col_destinatario_id,
  (SELECT count(*) FROM information_schema.routines
     WHERE routine_name = 'portal_auto_link_by_email')                                     AS fn_auto_link;
