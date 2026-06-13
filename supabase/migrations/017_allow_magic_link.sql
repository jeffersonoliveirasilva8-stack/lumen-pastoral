-- Migration 017: Login por link mágico configurável por paróquia
-- Padrão: desabilitado (false). Somente admins da paróquia podem habilitar.

ALTER TABLE public.paroquias ADD COLUMN IF NOT EXISTS allow_magic_link BOOLEAN NOT NULL DEFAULT FALSE;

-- Função SECURITY DEFINER para que a tela de login (anon) possa verificar
-- se o magic link está habilitado para um e-mail, sem expor dados sensíveis.
CREATE OR REPLACE FUNCTION public.check_magic_link_allowed(p_email TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(par.allow_magic_link, false)
  FROM membros m
  JOIN paroquias par ON par.id = m.paroquia_id
  WHERE LOWER(TRIM(m.email)) = LOWER(TRIM(p_email)) AND m.ativo = true
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.check_magic_link_allowed(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_magic_link_allowed(TEXT) TO authenticated;
