-- Migration 015: Leitura de notificações por membro
-- Substitui o campo `lida` global (compartilhado entre membros) por rastreamento per-usuário.

CREATE TABLE IF NOT EXISTS public.notificacoes_leituras (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id  UUID        NOT NULL REFERENCES public.notificacoes(id)  ON DELETE CASCADE,
  membro_id       UUID        NOT NULL REFERENCES public.membros(id)        ON DELETE CASCADE,
  lida_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notificacao_id, membro_id)
);

ALTER TABLE public.notificacoes_leituras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membro_own_leituras" ON public.notificacoes_leituras;
CREATE POLICY "membro_own_leituras" ON public.notificacoes_leituras
  FOR ALL TO authenticated
  USING (
    membro_id IN (
      SELECT id FROM membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
  )
  WITH CHECK (
    membro_id IN (
      SELECT id FROM membros
      WHERE auth_user_id = auth.uid() AND ativo = true
    )
  );

-- Migra estado existente: notificações já globalmente marcadas como lidas
-- são registradas para todos os membros elegíveis da paróquia
INSERT INTO notificacoes_leituras (notificacao_id, membro_id)
SELECT n.id, m.id
FROM   notificacoes n
JOIN   membros      m ON m.paroquia_id = n.paroquia_id AND m.ativo = true
WHERE  n.lida = true
  AND  (n.destinatario_id IS NULL OR n.destinatario_id = m.id)
ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

-- ── portal_marcar_notificacao_lida ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_marcar_notificacao_lida(p_notif_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_membro_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  INSERT INTO notificacoes_leituras (notificacao_id, membro_id)
  VALUES (p_notif_id, v_membro_id)
  ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

  -- Mantém `lida=true` na tabela original para compatibilidade com queries do painel admin
  UPDATE notificacoes SET lida = true WHERE id = p_notif_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── portal_marcar_todas_notificacoes_lidas ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_marcar_todas_notificacoes_lidas()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
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

  INSERT INTO notificacoes_leituras (notificacao_id, membro_id)
  SELECT n.id, v_membro_id FROM notificacoes n
  WHERE  n.paroquia_id  = v_paroquia_id
    AND  n.apenas_admin = false
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
  ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

  UPDATE notificacoes SET lida = true
  WHERE  paroquia_id  = v_paroquia_id
    AND  apenas_admin = false
    AND  (destinatario_id IS NULL OR destinatario_id = v_membro_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── portal_count_notif_nao_lidas ──────────────────────────────────────────────
-- Retorna a contagem de notificações não lidas pelo membro atual.
CREATE OR REPLACE FUNCTION public.portal_count_notif_nao_lidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_count       INTEGER;
BEGIN
  IF v_auth_id IS NULL THEN RETURN 0; END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id FROM membros
  WHERE (auth_user_id = v_auth_id OR LOWER(TRIM(email)) = LOWER(TRIM(auth.email())))
    AND ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_count FROM notificacoes n
  WHERE  n.paroquia_id  = v_paroquia_id
    AND  n.apenas_admin = false
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         );

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ── portal_get_notif_urgentes_nao_lidas ──────────────────────────────────────
-- Retorna as notificações urgentes não lidas pelo membro atual (máx. 5).
CREATE OR REPLACE FUNCTION public.portal_get_notif_urgentes_nao_lidas()
RETURNS TABLE(id UUID, titulo TEXT, mensagem TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN RETURN; END IF;

  SELECT m.id, m.paroquia_id INTO v_membro_id, v_paroquia_id FROM membros m
  WHERE (m.auth_user_id = v_auth_id OR LOWER(TRIM(m.email)) = LOWER(TRIM(auth.email())))
    AND m.ativo = true LIMIT 1;

  IF v_membro_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT n.id, n.titulo, n.mensagem FROM notificacoes n
  WHERE  n.paroquia_id  = v_paroquia_id
    AND  n.tipo         = 'urgente'
    AND  n.apenas_admin = false
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         )
  ORDER BY n.created_at DESC
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_marcar_notificacao_lida          TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_marcar_todas_notificacoes_lidas  TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_count_notif_nao_lidas            TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_notif_urgentes_nao_lidas     TO authenticated;
