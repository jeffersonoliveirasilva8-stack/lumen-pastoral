-- Migration 099 — Garantia: remover trigger sync_tipo_acesso_user_roles
--
-- O trigger _sync_tipo_acesso_to_user_roles tenta gravar valores como
-- 'auxiliar'/'coordenador'/'vice' em user_roles.role, que é enum app_role
-- no banco real e não aceita esses valores.
--
-- Migrações 054, 056 e 097 já tentaram dropar, mas o erro persiste.
-- Esta migration dropa novamente de forma incondicional.

DROP TRIGGER  IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

NOTIFY pgrst, 'reload schema';
