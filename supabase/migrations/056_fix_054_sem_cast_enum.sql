-- migration 056 — Neutralizada: user_roles.role é enum app_role no banco real.
-- Os valores 'coordenador' e 'auxiliar' não existem no enum, então a sincronização
-- tipo_acesso → user_roles é inviável. O app usa membros.tipo_acesso diretamente.
-- O trigger criado em 053 foi dropado em 054; não será recriado.

DROP TRIGGER  IF EXISTS sync_tipo_acesso_user_roles       ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

SELECT 1;
