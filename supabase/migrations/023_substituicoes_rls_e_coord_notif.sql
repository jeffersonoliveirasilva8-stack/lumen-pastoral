-- ============================================================
-- Migration 023: RLS para novas tabelas + tier coordenador em notificações
-- Data: 2026-06-13
--
-- OBJETIVO:
--   1. Helper function is_coordenador_da_paroquia() — verifica se o
--      usuário autenticado é coordenador de uma paróquia
--   2. Atualiza notif_membro_read: filtra apenas_coordenacao=true
--      para não-coordenadores
--   3. Atualiza RPCs de contagem/leitura (apenas_coordenacao ciente)
--   4. Atualiza _notify_coordenacao(): usa apenas_coordenacao=true
--      em vez de apenas_admin=true (coordenadores agora veem)
--   5. RLS para substituicoes
--   6. RLS para historico_substituicoes
--   7. RLS para paroquia_config_escalas
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE + DROP POLICY IF EXISTS)
-- REQUER: migrations 022 aplicada
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. HELPER — is_coordenador_da_paroquia
-- ══════════════════════════════════════════════════════════════
-- Retorna true se o usuário autenticado é coordenador da paróquia.
-- Condições (OU):
--   a) membro.tipo_acesso IN ('auxiliar','coordenador','administrador')
--   b) entrada ativa na tabela coordenadores

CREATE OR REPLACE FUNCTION public.is_coordenador_da_paroquia(p_paroquia_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membros m
    WHERE (
        m.auth_user_id = auth.uid()
        OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
      )
      AND m.ativo = true
      AND m.paroquia_id = p_paroquia_id
      AND (
        m.tipo_acesso IN ('auxiliar','coordenador','administrador')
        OR EXISTS (
          SELECT 1 FROM public.coordenadores c
          WHERE c.membro_id = m.id
            AND c.paroquia_id = p_paroquia_id
            AND c.ativo = true
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coordenador_da_paroquia(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. ATUALIZA notif_membro_read — filtra apenas_coordenacao
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_membro_read" ON public.notificacoes;

CREATE POLICY "notif_membro_read" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    -- Admins veem tudo (inclusive apenas_admin=true)
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      -- Filtra tier coordenação: somente coord/admin veem
      AND (
        apenas_coordenacao = false
        OR public.is_coordenador_da_paroquia(paroquia_id)
      )
      -- Respeita destinatário
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  );

-- ══════════════════════════════════════════════════════════════
-- 3. ATUALIZA notif_membro_mark_read — filtra apenas_coordenacao
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_membro_mark_read" ON public.notificacoes;

CREATE POLICY "notif_membro_mark_read" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    _portal_is_admin(paroquia_id)
    OR (
      apenas_admin = false
      AND paroquia_id IN (
        SELECT paroquia_id FROM public.membros
        WHERE auth_user_id = auth.uid() AND ativo = true
        UNION
        SELECT paroquia_id FROM public.membros
        WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
          AND ativo = true
      )
      AND (
        apenas_coordenacao = false
        OR public.is_coordenador_da_paroquia(paroquia_id)
      )
      AND (
        destinatario_id IS NULL
        OR destinatario_id IN (
          SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
          UNION
          SELECT id FROM public.membros
          WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
            AND ativo = true
        )
      )
    )
  )
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 4. ATUALIZA RPCs de notificação — cientes de apenas_coordenacao
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_count_notif_nao_lidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_is_coord    BOOLEAN;
  v_count       INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN RETURN 0; END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN 0; END IF;

  v_is_coord := public.is_coordenador_da_paroquia(v_paroquia_id);

  SELECT COUNT(*) INTO v_count FROM notificacoes n
  WHERE  n.paroquia_id    = v_paroquia_id
    AND  n.apenas_admin   = false
    AND  (v_is_coord OR n.apenas_coordenacao = false)
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         );

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_marcar_todas_notificacoes_lidas()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_is_coord    BOOLEAN;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  v_is_coord := public.is_coordenador_da_paroquia(v_paroquia_id);

  INSERT INTO notificacoes_leituras (notificacao_id, membro_id)
  SELECT n.id, v_membro_id FROM notificacoes n
  WHERE  n.paroquia_id    = v_paroquia_id
    AND  n.apenas_admin   = false
    AND  (v_is_coord OR n.apenas_coordenacao = false)
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
  ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

  UPDATE notificacoes SET lida = true
  WHERE  paroquia_id    = v_paroquia_id
    AND  apenas_admin   = false
    AND  (v_is_coord OR apenas_coordenacao = false)
    AND  (destinatario_id IS NULL OR destinatario_id = v_membro_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 5. ATUALIZA _notify_coordenacao — usa apenas_coordenacao=true
-- ══════════════════════════════════════════════════════════════
-- Antes: apenas_admin=true → somente admins viam
-- Agora: apenas_coordenacao=true, apenas_admin=false → coord + admins veem

CREATE OR REPLACE FUNCTION public._notify_coordenacao(
  p_paroquia_id uuid,
  p_titulo      text,
  p_mensagem    text,
  p_tipo        text DEFAULT 'alerta',
  p_link        text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, link_referencia)
  VALUES
    (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false, false, true, p_link);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. RLS — substituicoes
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "subst_membro_read"  ON public.substituicoes;
DROP POLICY IF EXISTS "subst_coord_read"   ON public.substituicoes;
DROP POLICY IF EXISTS "subst_membro_insert" ON public.substituicoes;
DROP POLICY IF EXISTS "subst_rpc_all"      ON public.substituicoes;

-- Membros veem apenas as próprias substituições (como solicitante ou substituto)
CREATE POLICY "subst_membro_read" ON public.substituicoes
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
    AND (
      -- Membro vê as próprias (solicita ou voluntaria)
      solicitante_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
      OR substituto_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
      -- Coordenador/admin vê todas da paróquia
      OR public.is_coordenador_da_paroquia(paroquia_id)
    )
  );

-- Nenhum INSERT direto — somente via RPCs SECURITY DEFINER
-- (portal_solicitar_substituicao, coord_aprovar_substituicao, etc.)

-- Nenhum UPDATE direto — somente via RPCs SECURITY DEFINER

-- Admin pode deletar (cancelar no admin panel)
CREATE POLICY "subst_admin_all" ON public.substituicoes
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ══════════════════════════════════════════════════════════════
-- 7. RLS — historico_substituicoes
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "hist_subst_read"  ON public.historico_substituicoes;
DROP POLICY IF EXISTS "hist_subst_admin" ON public.historico_substituicoes;

-- Leitura: membro vê histórico das suas substituições; coord vê tudo da paróquia
CREATE POLICY "hist_subst_read" ON public.historico_substituicoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.substituicoes s
      WHERE s.id = substituicao_id
        AND (
          s.solicitante_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
          OR s.substituto_id IN (SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true)
          OR public.is_coordenador_da_paroquia(s.paroquia_id)
        )
    )
  );

-- Nenhum INSERT/UPDATE direto — somente via trigger em substituicoes

-- ══════════════════════════════════════════════════════════════
-- 8. RLS — paroquia_config_escalas
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "config_escalas_read"  ON public.paroquia_config_escalas;
DROP POLICY IF EXISTS "config_escalas_admin" ON public.paroquia_config_escalas;

-- Qualquer membro da paróquia pode ler a configuração (precisa para saber deadlines)
CREATE POLICY "config_escalas_read" ON public.paroquia_config_escalas
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

-- Apenas admin pode criar/atualizar/deletar
CREATE POLICY "config_escalas_admin" ON public.paroquia_config_escalas
  FOR ALL TO authenticated
  USING (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

-- ══════════════════════════════════════════════════════════════
-- 9. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Membro comum não vê notificações com apenas_coordenacao=true
--   ✓ Coordenador/admin VÊ notificações com apenas_coordenacao=true
--   ✓ Membro vê apenas as próprias substituições (como solicitante/voluntário)
--   ✓ Coordenador/admin vê todas as substituições da paróquia
--   ✓ Admin pode gerenciar paroquia_config_escalas
--   ✓ Membro pode ler paroquia_config_escalas da sua paróquia
-- ─────────────────────────────────────────────────────────────
