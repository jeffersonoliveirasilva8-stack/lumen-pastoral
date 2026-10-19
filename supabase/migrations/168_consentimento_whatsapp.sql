-- Migration 168: Consentimento WhatsApp (M2 v5)
-- Adiciona 3 colunas de consentimento a public.membros, trigger guardião e RPC.
-- Aplicado em ambiente controlado em 2026-10-19. Testes T1–T4 confirmados.

-- ── 1. Colunas de consentimento ──────────────────────────────────────────────

ALTER TABLE public.membros
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_telefone  TEXT;

COMMENT ON COLUMN public.membros.whatsapp_opt_in IS
  'Consentimento ativo para notificações WhatsApp. true=aceitou; false=não aceitou ou revogou.';
COMMENT ON COLUMN public.membros.whatsapp_opt_in_at IS
  'Timestamp da última alteração. NULL=nunca interagiu. NOT NULL+false=revogou.';
COMMENT ON COLUMN public.membros.whatsapp_telefone IS
  'Número E.164 somente dígitos (8–15 chars, inclui DDI e DDD). Preservado após revogação.';


-- ── 2. Trigger guardião ───────────────────────────────────────────────────────
-- NOT SECURITY DEFINER: current_user no trigger = quem disparou o UPDATE.
-- authenticated → bloqueado se tentar alterar consent cols diretamente.
-- postgres / service_role / supabase_admin → permitidos (passam pelo guard).
-- Funções SECURITY DEFINER owner=postgres também passam pelo guard por design.

DROP TRIGGER IF EXISTS trg_guard_consent_columns_membros ON public.membros;

CREATE OR REPLACE FUNCTION public._guard_consent_columns_membros()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF (NEW.whatsapp_opt_in    IS DISTINCT FROM OLD.whatsapp_opt_in    OR
        NEW.whatsapp_opt_in_at IS DISTINCT FROM OLD.whatsapp_opt_in_at OR
        NEW.whatsapp_telefone  IS DISTINCT FROM OLD.whatsapp_telefone) THEN
      RAISE EXCEPTION
        'permission denied: use a RPC atualizar_consentimento_whatsapp'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_consent_columns_membros
  BEFORE UPDATE ON public.membros
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_consent_columns_membros();


-- ── 3. RPC de consentimento ──────────────────────────────────────────────────
-- SECURITY DEFINER: faz current_user='postgres' → trigger permite o UPDATE.
-- SELECT INTO STRICT: levanta NO_DATA_FOUND ou TOO_MANY_ROWS em vez de LIMIT 1.

CREATE OR REPLACE FUNCTION public.atualizar_consentimento_whatsapp(
  p_opt_in   BOOLEAN,
  p_telefone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_membro_id UUID;
  v_tel_clean TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_opt_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'opt_in_obrigatorio');
  END IF;

  IF p_opt_in = true THEN
    IF p_telefone IS NULL OR trim(p_telefone) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'telefone_obrigatorio');
    END IF;
    v_tel_clean := regexp_replace(trim(p_telefone), '[^0-9]', '', 'g');
    IF length(v_tel_clean) < 8 OR length(v_tel_clean) > 15 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'telefone_invalido',
        'detalhe', 'O número deve ter entre 8 e 15 dígitos incluindo DDI e DDD'
      );
    END IF;
  END IF;

  BEGIN
    SELECT id INTO STRICT v_membro_id
    FROM public.membros
    WHERE auth_user_id = v_uid
      AND ativo = true;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
    WHEN TOO_MANY_ROWS THEN
      RETURN jsonb_build_object('success', false, 'error', 'multiplos_membros_encontrados');
  END;

  IF p_opt_in = true THEN
    UPDATE public.membros
    SET whatsapp_opt_in    = true,
        whatsapp_opt_in_at = now(),
        whatsapp_telefone  = v_tel_clean
    WHERE id = v_membro_id;
  ELSE
    UPDATE public.membros
    SET whatsapp_opt_in    = false,
        whatsapp_opt_in_at = now()
    WHERE id = v_membro_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'opt_in', p_opt_in);
END;
$$;


-- ── 4. Permissões da RPC ─────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.atualizar_consentimento_whatsapp(BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atualizar_consentimento_whatsapp(BOOLEAN, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atualizar_consentimento_whatsapp(BOOLEAN, TEXT) FROM service_role;
GRANT  EXECUTE ON FUNCTION public.atualizar_consentimento_whatsapp(BOOLEAN, TEXT) TO authenticated;


-- ── 5. Reload schema cache ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
