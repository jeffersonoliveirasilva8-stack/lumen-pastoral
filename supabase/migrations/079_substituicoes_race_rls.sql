-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 079 — Substituições: lock atômico + alinhamento RLS
--
-- Correção B1 (Alto): portal_voluntariar_substituicao usava SELECT sem FOR UPDATE.
--   Dois voluntários simultâneos passavam na verificação status='solicitada' e o
--   segundo sobrescrevia o substituto_id do primeiro silenciosamente.
--   Fix: adicionar FOR UPDATE ao SELECT de leitura-modificação-escrita.
--
-- Correção B3 (Baixo): subst_membro_read usava apenas auth_user_id para localizar
--   o membro. As RPCs fazem fallback por email (auth.email()), mas a RLS não.
--   Se a sincronização auth_user_id falhar, o membro vê [] silenciosamente.
--   Fix: adicionar OR fallback de email, espelhando is_coordenador_da_paroquia.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B1: portal_voluntariar_substituicao com FOR UPDATE ───────────────────────

DROP FUNCTION IF EXISTS public.portal_voluntariar_substituicao(UUID);

CREATE OR REPLACE FUNCTION public.portal_voluntariar_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id     UUID := auth.uid();
  v_membro_id   UUID;
  v_paroquia_id UUID;
  v_subst_ativa BOOLEAN;
  v_subst       public.substituicoes%ROWTYPE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, paroquia_id INTO v_membro_id, v_paroquia_id
  FROM public.membros
  WHERE (auth_user_id = v_auth_id
         OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), ''))))
    AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  SELECT COALESCE(substituicao_ativa, false)
    INTO v_subst_ativa
  FROM public.paroquia_config_escalas
  WHERE paroquia_id = v_paroquia_id;

  IF NOT v_subst_ativa THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_desativada');
  END IF;

  -- FOR UPDATE: trava a linha antes de ler o status.
  -- Elimina a janela de corrida: se dois voluntários chegarem ao mesmo tempo,
  -- o segundo fica bloqueado até o primeiro confirmar o UPDATE + commit.
  -- O segundo então lê status='com_voluntario' e retorna erro limpo.
  SELECT * INTO v_subst
  FROM public.substituicoes
  WHERE id = p_substituicao_id AND paroquia_id = v_paroquia_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_not_found');
  END IF;

  IF v_subst.status <> 'solicitada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituicao_nao_disponivel', 'status', v_subst.status);
  END IF;

  IF v_subst.solicitante_id = v_membro_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'proprio_solicitante');
  END IF;

  UPDATE public.substituicoes
  SET status = 'com_voluntario', substituto_id = v_membro_id, updated_at = now()
  WHERE id = p_substituicao_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_voluntariar_substituicao(UUID) TO authenticated;

-- ── B3: subst_membro_read com fallback de email ──────────────────────────────
-- Espelha o padrão de is_coordenador_da_paroquia (auth_user_id OR email).
-- Protege contra dessincronização de auth_user_id após reset de senha ou
-- recriação de usuário auth sem re-vincular ao membro existente.

DROP POLICY IF EXISTS "subst_membro_read" ON public.substituicoes;

CREATE POLICY "subst_membro_read" ON public.substituicoes
  FOR SELECT TO authenticated
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE (auth_user_id = auth.uid()
             OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), ''))))
        AND ativo = true
    )
    AND (
      solicitante_id IN (
        SELECT id FROM public.membros
        WHERE (auth_user_id = auth.uid()
               OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), ''))))
          AND ativo = true
      )
      OR substituto_id IN (
        SELECT id FROM public.membros
        WHERE (auth_user_id = auth.uid()
               OR LOWER(TRIM(COALESCE(auth.email(), ''))) = LOWER(TRIM(COALESCE(email, ''))))
          AND ativo = true
      )
      OR public.is_coordenador_da_paroquia(paroquia_id)
    )
  );
