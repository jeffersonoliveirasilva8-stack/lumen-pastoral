-- migration 050 — Ajusta rate limit de e-mail para suportar publicações em massa
--
-- Problema: c_user_per_min = 10 bloqueia publicação de escalas com >10 membros.
-- Uma paróquia com 30+ servidores escalados tem envio legítimo de ~30 e-mails
-- por publicação. O rate limit por destinatário (5/min) já protege contra spam
-- individual — o limite por conta pode ser mais permissivo.
--
-- Novos limites:
--   c_user_per_min  : 10 → 60   (uma publicação de escala cheia)
--   c_user_per_hour : 50 → 200  (múltiplas publicações em sequência)
--   c_dest_per_min  : 5  → 5    (mantido — protege destinatários)
--   c_dest_per_hour : 20 → 20   (mantido)

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
  c_user_per_min    INT := 60;   -- era 10; aumentado para suportar publicações em massa
  c_user_per_hour   INT := 200;  -- era 50
  c_mfa_per_10min   INT := 3;
BEGIN
  SELECT COUNT(*) INTO v_count_dest_1m
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 minute';

  IF v_count_dest_1m >= c_dest_per_min THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_min || ' e-mails por minuto para este destinatário');
  END IF;

  SELECT COUNT(*) INTO v_count_dest_1h
  FROM public.email_logs
  WHERE destinatario = lower(trim(p_destinatario))
    AND created_at > now() - INTERVAL '1 hour';

  IF v_count_dest_1h >= c_dest_per_hour THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Rate limit: máximo de ' || c_dest_per_hour || ' e-mails por hora para este destinatário');
  END IF;

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
  END IF;

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
