-- Migration 139 — MFA ignora rate limit por conta (autenticação crítica)
--
-- Causa raiz: coordenadores que publicam escalas e enviam notificações em massa
-- consomem a cota de 200 e-mails/hora da conta. Quando tentam fazer login em
-- seguida, o código MFA é bloqueado pelo mesmo limite global, impedindo acesso.
--
-- Fix: check_email_rate_limit retorna imediatamente para 'mfa_admin_code' após
-- verificar apenas os limites por destinatário e o limite específico de MFA (3
-- por 10 min). Os limites de conta (c_user_per_min / c_user_per_hour) não se
-- aplicam a MFA — autenticação deve sempre funcionar.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.check_email_rate_limit(
  p_destinatario    TEXT,
  p_tipo            TEXT,
  p_requester_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_dest_1m   INT;
  v_count_dest_1h   INT;
  v_count_user_1m   INT;
  v_count_user_1h   INT;
  v_count_mfa_10m   INT;

  c_dest_per_min    INT := 5;
  c_dest_per_hour   INT := 20;
  c_user_per_min    INT := 60;
  c_user_per_hour   INT := 200;
  c_mfa_per_10min   INT := 3;
BEGIN
  -- Limite por destinatário: minuto
  SELECT COUNT(*) INTO v_count_dest_1m
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 minute';

  IF v_count_dest_1m >= c_dest_per_min THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_min || ' e-mails por minuto para este destinatário');
  END IF;

  -- Limite por destinatário: hora
  SELECT COUNT(*) INTO v_count_dest_1h
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count_dest_1h >= c_dest_per_hour THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_hour || ' e-mails por hora para este destinatário');
  END IF;

  -- Limite específico de MFA por destinatário (3 por 10 min)
  IF p_tipo = 'mfa_admin_code' THEN
    SELECT COUNT(*) INTO v_count_mfa_10m
    FROM public.email_logs
    WHERE tipo = 'mfa_admin_code'
      AND destinatario = lower(trim(p_destinatario))
      AND status = 'enviado'
      AND created_at > now() - INTERVAL '10 minutes';

    IF v_count_mfa_10m >= c_mfa_per_10min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_mfa_per_10min || ' códigos MFA por 10 minutos');
    END IF;

    -- MFA passa: não aplica limites por conta — autenticação é crítica
    RETURN jsonb_build_object('allowed', true, 'reason', null);
  END IF;

  -- Para demais templates: verifica limites por conta (requester)
  IF p_requester_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_user_1m
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 minute';

    IF v_count_user_1m >= c_user_per_min THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_min || ' e-mails por minuto por conta');
    END IF;

    SELECT COUNT(*) INTO v_count_user_1h
    FROM public.email_logs
    WHERE requester_user_id = p_requester_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_count_user_1h >= c_user_per_hour THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Rate limit: máximo de ' || c_user_per_hour || ' e-mails por hora por conta');
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', null);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[rate_limit] Erro ao verificar rate limit: %', SQLERRM;
  RETURN jsonb_build_object('allowed', true, 'reason', null);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.check_email_rate_limit(TEXT, TEXT, UUID) FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
