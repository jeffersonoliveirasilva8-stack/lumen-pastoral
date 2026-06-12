-- ============================================================
-- 013_primeiro_acesso.sql
-- Unifica fluxo de primeiro acesso via token
-- Data: 2026-06-12
--
-- ADICIONA: RPC portal_get_membro_por_token(UUID)
--   Acessível sem autenticação (anon) para a rota
--   /membro/primeiro-acesso?token=UUID validar o convite
--   antes de o membro estar logado.
--   Retorna info básica com email mascarado (privacidade).
--
-- IDEMPOTENTE: CREATE OR REPLACE
-- ============================================================

CREATE OR REPLACE FUNCTION public.portal_get_membro_por_token(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membro_id     UUID;
  v_nome          TEXT;
  v_email         TEXT;
  v_conta_ativada BOOLEAN;
  v_paroquia_nome TEXT;
BEGIN
  SELECT m.id, m.nome, m.email, m.conta_ativada, p.nome
  INTO   v_membro_id, v_nome, v_email, v_conta_ativada, v_paroquia_nome
  FROM   membros m
  JOIN   paroquias p ON p.id = m.paroquia_id
  WHERE  m.token_acesso = p_token
    AND  m.ativo = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_not_found');
  END IF;

  -- Mascara email: a***@domain.com (nunca expõe endereço completo para anon)
  RETURN jsonb_build_object(
    'valid',         true,
    'membro_id',     v_membro_id,
    'nome',          v_nome,
    'email_masked',  regexp_replace(v_email, '^(.)(.*)(@.*)$', '\1***\3'),
    'conta_ativada', v_conta_ativada,
    'paroquia_nome', v_paroquia_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_membro_por_token(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_get_membro_por_token(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
