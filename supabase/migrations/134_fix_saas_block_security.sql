-- P0: saas_block_paroquia sem verificação de super_admin
-- Recriar com guard igual ao saas_suspend_paroquia

CREATE OR REPLACE FUNCTION public.saas_block_paroquia(
  p_paroquia_id UUID,
  p_reason TEXT DEFAULT 'Bloqueio administrativo'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super_admin pode bloquear paróquias';
  END IF;

  UPDATE public.paroquias
  SET status = 'blocked', blocked_at = now(), suspension_reason = p_reason
  WHERE id = p_paroquia_id;

  UPDATE public.subscriptions
  SET status = 'blocked'
  WHERE paroquia_id = p_paroquia_id;

  INSERT INTO public.platform_audit_logs (actor_id, actor_email, action, target_type, target_id, new_value)
  SELECT
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'paroquia.blocked',
    'paroquia',
    p_paroquia_id,
    jsonb_build_object('reason', p_reason)
  ;
END;
$$;
