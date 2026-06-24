-- Migration 097 — Corrige 096: remove trigger inválido
--
-- Migration 096 recriou _sync_tipo_acesso_to_user_roles, mas user_roles.role
-- é enum app_role no banco real e não aceita 'auxiliar'/'coordenador'/'vice'.
-- Migration 056 já havia dropado esse trigger por esse mesmo motivo.
-- O sistema usa membros.tipo_acesso diretamente nas funções SQL (is_coordenador_da_paroquia).
--
-- Esta migration:
--   1. Dropa o trigger e a função recriados em 096
--   2. Mantém apenas o CHECK constraint e a atualização de is_coordenador_da_paroquia

DROP TRIGGER  IF EXISTS sync_tipo_acesso_user_roles     ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

-- is_coordenador_da_paroquia já foi atualizada em 096 para incluir 'vice'.
-- Nenhuma ação adicional necessária.

NOTIFY pgrst, 'reload schema';
