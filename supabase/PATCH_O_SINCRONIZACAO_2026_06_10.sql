-- ============================================================
-- LUMEN PASTORAL — PATCH O: Sincronização, Privacidade e Motivo
-- Data: 2026-06-10
--
-- PROBLEMAS CORRIGIDOS:
--   1. Membro recém-ativado não consegue ler comunidades/atuações
--      (falta policy SELECT em membros para acesso sem auth_user_id).
--   2. Notificações internas de coordenação aparecendo para membros
--      (falta coluna apenas_admin em notificacoes).
--   3. Trigger de ocorrências cria notificação sem destinatario_id
--      → visível para todos os membros em vez de só admins.
--   4. completar_perfil_membro() não aceitava motivo_disponibilidade.
--   5. Nome alterado no Portal do Membro não atualizava no Admin
--      (falta RPC SECURITY DEFINER para update de perfil com audit).
--   6. PATCH_B (destinatario_id + triggers) pode não ter sido aplicado.
--
-- COMO EXECUTAR:
--   Dashboard Supabase → SQL Editor → colar e executar este arquivo.
--
-- IDEMPOTENTE: sim (IF NOT EXISTS + CREATE OR REPLACE + DROP IF EXISTS).
-- ORDEM DE APLICAÇÃO: após PATCH_N_CONTA_ATIVADA_2026_06_10.sql
-- ============================================================

-- ══════════════════════════════════════════════════════════════════
-- 1. MEMBROS — policy de leitura pelo próprio email (primeiro acesso)
-- ══════════════════════════════════════════════════════════════════
-- Membros encontrados por email (auth_user_id ainda não vinculado)
-- precisam ler seu próprio registro. A policy existente
-- "member_portal_select_own" exige auth_user_id = auth.uid(),
-- que ainda é NULL para membros não vinculados.
-- Esta policy é defesa adicional para o caso de portal_auto_link_by_email()
-- ainda não ter sido executado (deep link, nova aba, etc.).

DROP POLICY IF EXISTS "membros_self_read_by_email" ON membros;
CREATE POLICY "membros_self_read_by_email" ON membros
  FOR SELECT TO authenticated
  USING (
    LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
    AND ativo = true
  );

-- ══════════════════════════════════════════════════════════════════
-- 2. MEMBROS — coluna motivo_disponibilidade
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE membros
  ADD COLUMN IF NOT EXISTS motivo_disponibilidade TEXT;

-- ══════════════════════════════════════════════════════════════════
-- 3. NOTIFICAÇÕES — coluna apenas_admin
-- ══════════════════════════════════════════════════════════════════
-- Permite criar notificações visíveis apenas pela coordenação.
-- Notificações de ocorrências, alertas internos, etc. usam apenas_admin = true.
-- Membros nunca veem notificações com apenas_admin = true.

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS apenas_admin BOOLEAN NOT NULL DEFAULT false;

-- ── Garantir que PATCH_B foi aplicado (destinatario_id) ──────────────────
ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS destinatario_id uuid
    REFERENCES public.membros(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notificacoes_destinatario_idx
  ON public.notificacoes(destinatario_id);

CREATE INDEX IF NOT EXISTS notificacoes_apenas_admin_idx
  ON public.notificacoes(apenas_admin);

-- ══════════════════════════════════════════════════════════════════
-- 4. NOTIFICAÇÕES — atualizar RLS para incluir apenas_admin
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_membro_read"       ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_mark_read"  ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_manage"      ON public.notificacoes;
DROP POLICY IF EXISTS "notif_membro_delete"     ON public.notificacoes;
DROP POLICY IF EXISTS "notificacoes_paroquia"   ON public.notificacoes;
DROP POLICY IF EXISTS "notif_read_paroquia"     ON public.notificacoes;
DROP POLICY IF EXISTS "notif_admin_all"         ON public.notificacoes;

-- Membro lê: notificações da paróquia NÃO exclusivas de admin,
-- sem destinatário (broadcast) OU destinadas especificamente a ele.
CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    -- Admins veem tudo
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (destinatario_id IS NULL OR destinatario_id IN (
        SELECT id FROM membros WHERE auth_user_id = auth.uid()
        UNION
        SELECT id FROM membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      ))
    )
  );

-- Membro pode marcar lida (mesma lógica)
CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (destinatario_id IS NULL OR destinatario_id IN (
        SELECT id FROM membros WHERE auth_user_id = auth.uid()
        UNION
        SELECT id FROM membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      ))
    )
  )
  WITH CHECK (true);

-- Membro pode excluir a própria notificação (não-admin)
CREATE POLICY "notif_membro_delete" ON public.notificacoes
  FOR DELETE TO authenticated
  USING (
    apenas_admin = false
    AND paroquia_id IN (
      SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid()
    )
    AND (destinatario_id IS NULL OR destinatario_id IN (
      SELECT id FROM membros WHERE auth_user_id = auth.uid()
    ))
  );

-- Admin gerencia todas (criar, editar, excluir)
CREATE POLICY "notif_admin_manage" ON public.notificacoes
  FOR ALL TO authenticated
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. TRIGGER: ocorrências → notificação apenas para coordenação
-- ══════════════════════════════════════════════════════════════════
-- Quando um membro registra uma ocorrência, a notificação gerada
-- deve ser visível SOMENTE para coordenadores (apenas_admin = true).
-- Antes desta correção, a notificação aparecia para todos os membros.

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
    (paroquia_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
  VALUES (
    NEW.paroquia_id,
    v_tipo_label || ' — ' || NEW.titulo,
    'Registrado por ' || COALESCE(v_membro_nome, 'membro') || ': ' || left(NEW.descricao, 200),
    CASE WHEN NEW.tipo = 'situacao_urgente' THEN 'urgente' ELSE 'alerta' END,
    '/ocorrencias',
    true  -- ← CORREÇÃO: visível apenas para coordenação
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_membro ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_membro
  AFTER INSERT ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_membro();

-- ── Trigger de resposta → notifica O MEMBRO (não admin, com destinatario_id) ──
CREATE OR REPLACE FUNCTION public._notify_ocorrencia_respondida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF (OLD.resposta IS NOT DISTINCT FROM NEW.resposta AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.resposta IS NOT NULL AND (OLD.resposta IS NULL OR OLD.resposta <> NEW.resposta) THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Sua ocorrência recebeu uma resposta',
      left(NEW.resposta, 200),
      'alerta',
      '/portal-membro/ocorrencias',
      false  -- membro pode ver a resposta à própria ocorrência
    );
  ELSIF OLD.status <> NEW.status THEN
    INSERT INTO public.notificacoes
      (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
    VALUES (
      NEW.paroquia_id,
      NEW.membro_id,
      'Status da ocorrência atualizado: ' || NEW.status,
      'Sua ocorrência "' || left(NEW.titulo, 80) || '" foi atualizada.',
      'sistema',
      '/portal-membro/ocorrencias',
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ocorrencia_respondida ON public.ocorrencias_membros;
CREATE TRIGGER notify_ocorrencia_respondida
  AFTER UPDATE ON public.ocorrencias_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_ocorrencia_respondida();

-- ── Trigger de escala → notificação com destinatario_id ─────────────────────
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo    text;
  v_data      date;
  v_paroquia  uuid;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id
  INTO   v_titulo, v_data, v_paroquia
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
  VALUES (
    v_paroquia,
    NEW.membro_id,
    'Você foi escalado(a): ' || v_titulo,
    'Data: ' || to_char(v_data, 'DD/MM/YYYY') || '. Confirme ou recuse sua participação no portal.',
    'aviso',
    '/portal-membro/escalas',
    false  -- membro pode ver a própria escala
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_escala_membro ON public.escala_membros;
CREATE TRIGGER notify_escala_membro
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_escala_membro();

-- ══════════════════════════════════════════════════════════════════
-- 6. ESCALAS — policy de leitura para membros (garantir PATCH_B)
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "escalas_membro_read_publicadas" ON public.escalas;

CREATE POLICY "escalas_membro_read_publicadas" ON public.escalas
  FOR SELECT TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      status = 'publicada'
      AND paroquia_id IN (
        SELECT paroquia_id FROM membros WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
    )
  );

GRANT SELECT ON public.escalas TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. RPC completar_perfil_membro() — aceita motivo_disponibilidade
-- ══════════════════════════════════════════════════════════════════
-- Substitui a versão do PATCH_N_CONTA_ATIVADA adicionando:
--   • p_motivo_disponibilidade TEXT
--   • Salva motivo no campo membros.motivo_disponibilidade

CREATE OR REPLACE FUNCTION public.completar_perfil_membro(
  p_telefone               TEXT     DEFAULT NULL,
  p_data_nascimento        DATE     DEFAULT NULL,
  p_sexo                   TEXT     DEFAULT NULL,
  p_comunidade_id          UUID     DEFAULT NULL,
  p_atuacao_ids            UUID[]   DEFAULT ARRAY[]::UUID[],
  p_missa_restricao_ids    UUID[]   DEFAULT ARRAY[]::UUID[],
  p_motivo_disponibilidade TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id          UUID := auth.uid();
  v_membro_id        UUID;
  v_paroquia_id      UUID;
  v_has_paroquia_col BOOLEAN;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Busca por auth_user_id primeiro
  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM membros
  WHERE auth_user_id = v_auth_id AND ativo = true
  LIMIT 1;

  -- Fallback por email
  IF v_membro_id IS NULL THEN
    SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
    FROM membros
    WHERE auth_user_id IS NULL
      AND ativo = true
      AND LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
    LIMIT 1;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Vincula auth_user_id se necessário
  UPDATE membros SET auth_user_id = v_auth_id
  WHERE id = v_membro_id AND auth_user_id IS NULL;

  -- Garante profiles row
  BEGIN
    INSERT INTO profiles (id, email, paroquia_id)
    VALUES (v_auth_id, auth.email(), v_paroquia_id)
    ON CONFLICT (id) DO UPDATE SET paroquia_id = EXCLUDED.paroquia_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Garante role de membro
  BEGIN
    INSERT INTO user_roles (user_id, paroquia_id, role)
    VALUES (v_auth_id, v_paroquia_id, 'membro')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Atualiza dados pessoais e pastorais
  UPDATE membros SET
    telefone               = CASE WHEN p_telefone IS NOT NULL                THEN p_telefone               ELSE telefone               END,
    data_nascimento        = CASE WHEN p_data_nascimento IS NOT NULL         THEN p_data_nascimento        ELSE data_nascimento        END,
    sexo                   = CASE WHEN p_sexo IS NOT NULL                    THEN p_sexo                   ELSE sexo                   END,
    comunidade_id          = CASE WHEN p_comunidade_id IS NOT NULL           THEN p_comunidade_id          ELSE comunidade_id          END,
    motivo_disponibilidade = CASE WHEN p_motivo_disponibilidade IS NOT NULL  THEN p_motivo_disponibilidade ELSE motivo_disponibilidade END
  WHERE id = v_membro_id;

  -- ── Sincroniza membro_atuacoes ─────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membro_atuacoes' AND column_name = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_atuacoes WHERE membro_id = v_membro_id;

  IF cardinality(p_atuacao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_atuacoes (membro_id, atuacao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_atuacao_ids), v_paroquia_id ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_atuacoes (membro_id, atuacao_id)
      SELECT v_membro_id, unnest(p_atuacao_ids) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ── Sincroniza membro_missa_restricoes ────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membro_missa_restricoes' AND column_name = 'paroquia_id'
  ) INTO v_has_paroquia_col;

  DELETE FROM membro_missa_restricoes WHERE membro_id = v_membro_id;

  IF cardinality(p_missa_restricao_ids) > 0 THEN
    IF v_has_paroquia_col THEN
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id, paroquia_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids), v_paroquia_id ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO membro_missa_restricoes (membro_id, missa_padrao_id)
      SELECT v_membro_id, unnest(p_missa_restricao_ids) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Marca perfil como completo
  UPDATE membros SET perfil_completo = true WHERE id = v_membro_id;

  -- Invalida cache PostgREST
  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object(
    'success',     true,
    'membro_id',   v_membro_id,
    'paroquia_id', v_paroquia_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_perfil_membro TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. RPC atualizar_perfil_membro() — edição de perfil com SECURITY DEFINER
-- ══════════════════════════════════════════════════════════════════
-- Resolve o problema de "nome alterado no portal do membro não aparece no admin".
-- O UPDATE direto via RLS pode falhar silenciosamente se auth_user_id não está
-- corretamente definido. Este RPC faz o update ignorando RLS.

CREATE OR REPLACE FUNCTION public.atualizar_perfil_membro(
  p_nome                TEXT     DEFAULT NULL,
  p_telefone            TEXT     DEFAULT NULL,
  p_data_nascimento     DATE     DEFAULT NULL,
  p_cpf                 TEXT     DEFAULT NULL,
  p_rg                  TEXT     DEFAULT NULL,
  p_endereco            TEXT     DEFAULT NULL,
  p_cidade              TEXT     DEFAULT NULL,
  p_cep                 TEXT     DEFAULT NULL,
  p_nome_pai            TEXT     DEFAULT NULL,
  p_nome_mae            TEXT     DEFAULT NULL,
  p_nome_emergencia     TEXT     DEFAULT NULL,
  p_telefone_emergencia TEXT     DEFAULT NULL,
  p_observacoes         TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Busca por auth_user_id OU email
  SELECT id INTO v_membro_id
  FROM membros
  WHERE auth_user_id = v_auth_id AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    SELECT id INTO v_membro_id
    FROM membros
    WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
      AND ativo = true
    LIMIT 1;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  IF p_nome IS NOT NULL AND length(trim(p_nome)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_obrigatorio');
  END IF;

  UPDATE membros SET
    nome                = COALESCE(NULLIF(p_nome, ''),          nome),
    telefone            = CASE WHEN p_telefone            IS NOT NULL THEN p_telefone            ELSE telefone            END,
    data_nascimento     = CASE WHEN p_data_nascimento     IS NOT NULL THEN p_data_nascimento     ELSE data_nascimento     END,
    cpf                 = CASE WHEN p_cpf                 IS NOT NULL THEN p_cpf                 ELSE cpf                 END,
    rg                  = CASE WHEN p_rg                  IS NOT NULL THEN p_rg                  ELSE rg                  END,
    endereco            = CASE WHEN p_endereco            IS NOT NULL THEN p_endereco            ELSE endereco            END,
    cidade              = CASE WHEN p_cidade              IS NOT NULL THEN p_cidade              ELSE cidade              END,
    cep                 = CASE WHEN p_cep                 IS NOT NULL THEN p_cep                 ELSE cep                 END,
    nome_pai            = CASE WHEN p_nome_pai            IS NOT NULL THEN p_nome_pai            ELSE nome_pai            END,
    nome_mae            = CASE WHEN p_nome_mae            IS NOT NULL THEN p_nome_mae            ELSE nome_mae            END,
    nome_emergencia     = CASE WHEN p_nome_emergencia     IS NOT NULL THEN p_nome_emergencia     ELSE nome_emergencia     END,
    telefone_emergencia = CASE WHEN p_telefone_emergencia IS NOT NULL THEN p_telefone_emergencia ELSE telefone_emergencia END,
    observacoes         = CASE WHEN p_observacoes         IS NOT NULL THEN p_observacoes         ELSE observacoes         END
  WHERE id = v_membro_id;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_perfil_membro TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 9. Migração: marcar notificações de ocorrências existentes como apenas_admin
-- ══════════════════════════════════════════════════════════════════
-- Notificações com link /ocorrencias (sem destinatario_id) são de coordenação
UPDATE public.notificacoes
SET apenas_admin = true
WHERE link_referencia = '/ocorrencias'
  AND destinatario_id IS NULL
  AND apenas_admin = false;

-- ══════════════════════════════════════════════════════════════════
-- 10. Verificações finais
-- ══════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO DE APROVAÇÃO:
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'membros' AND column_name = 'motivo_disponibilidade';
-- → deve retornar 1 linha
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'notificacoes' AND column_name IN ('apenas_admin','destinatario_id');
-- → deve retornar 2 linhas
--
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'membros' AND policyname = 'membros_self_read_by_email';
-- → deve retornar 1 linha
--
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('completar_perfil_membro', 'atualizar_perfil_membro');
-- → deve retornar 2 linhas
--
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table IN ('escala_membros','ocorrencias_membros')
-- ORDER BY trigger_name;
-- → notify_escala_membro, notify_ocorrencia_membro, notify_ocorrencia_respondida
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Membro recém-ativado consegue ler comunidades da paróquia
--   ✓ Membro recém-ativado consegue ler atuações da paróquia
--   ✓ Notificações de ocorrências NÃO aparecem no portal do membro
--   ✓ Resposta da coordenação aparece para o membro correto
--   ✓ completar_perfil_membro() salva motivo_disponibilidade
--   ✓ atualizar_perfil_membro() atualiza nome visível no admin portal
-- ─────────────────────────────────────────────────────────────────────────────
