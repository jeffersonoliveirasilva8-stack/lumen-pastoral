-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 042 — Privacidade: notificações de coordenação não vazam p/ membros
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Causa raiz: as funções SECURITY DEFINER de 015 filtram `apenas_admin = false`
-- mas não filtram `apenas_coordenacao = false`. Como rodam com permissão elevada,
-- bypassam o RLS e entregam notificações de indisponibilidade a todos os membros.
--
-- Fix: adicionar `AND n.apenas_coordenacao = false` em todas as funções de portal
-- que expõem notificações a membros comuns.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. portal_marcar_todas_notificacoes_lidas — bloqueia apenas_coordenacao
-- ─────────────────────────────────────────────────────────────────────────────
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
  WHERE  n.paroquia_id        = v_paroquia_id
    AND  n.apenas_admin       = false
    AND  n.apenas_coordenacao = false          -- ← FIX: exclui notif de coordenação
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
  ON CONFLICT (notificacao_id, membro_id) DO NOTHING;

  UPDATE notificacoes SET lida = true
  WHERE  paroquia_id        = v_paroquia_id
    AND  apenas_admin       = false
    AND  apenas_coordenacao = false            -- ← FIX
    AND  (destinatario_id IS NULL OR destinatario_id = v_membro_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. portal_count_notif_nao_lidas — bloqueia apenas_coordenacao
-- ─────────────────────────────────────────────────────────────────────────────
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
  WHERE  n.paroquia_id        = v_paroquia_id
    AND  n.apenas_admin       = false
    AND  n.apenas_coordenacao = false          -- ← FIX
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         );

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. portal_get_notif_urgentes_nao_lidas — bloqueia apenas_coordenacao
-- ─────────────────────────────────────────────────────────────────────────────
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
  WHERE  n.paroquia_id        = v_paroquia_id
    AND  n.tipo               = 'urgente'
    AND  n.apenas_admin       = false
    AND  n.apenas_coordenacao = false          -- ← FIX
    AND  (n.destinatario_id IS NULL OR n.destinatario_id = v_membro_id)
    AND  NOT EXISTS (
           SELECT 1 FROM notificacoes_leituras nl
           WHERE  nl.notificacao_id = n.id AND nl.membro_id = v_membro_id
         )
  ORDER BY n.created_at DESC
  LIMIT 5;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Apaga a notificação vazada de indisponibilidade de Jefferson Oliveira da Silva
--    e quaisquer outras notificações de indisponibilidade que tenham chegado
--    a membros indevidamente (apenas_coordenacao = true mas sem destinatario_id)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.notificacoes_leituras
WHERE notificacao_id IN (
  SELECT id FROM public.notificacoes
  WHERE titulo ILIKE '%Indisponibilidade%Jefferson%'
     OR (titulo ILIKE '%Indisponibilidade%' AND apenas_coordenacao = true)
);

DELETE FROM public.notificacoes
WHERE titulo ILIKE '%Indisponibilidade%Jefferson%'
   OR (titulo ILIKE '%Indisponibilidade%' AND apenas_coordenacao = true);
