-- migration 054 — Neutralizada: a sincronização correta é feita na migration 056
-- (054 original tentava usar app_role enum com valores inválidos — 'coordenador'/'auxiliar'
--  não existem no enum; 056 resolve com role como TEXT)

-- Remove trigger criado em 053 (será recriado corretamente em 056)
DROP TRIGGER IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

SELECT 1; -- backfill retroativo delegado à migration 056
