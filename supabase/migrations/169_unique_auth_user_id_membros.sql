-- Migration 169: UNIQUE(auth_user_id) em public.membros
-- Pré-requisito: ausência de duplicatas confirmada em 2026-10-19 (rows=[]).
-- Garante que cada usuário autenticado só pode estar vinculado a um membro ativo,
-- o que é invariante necessário para SELECT INTO STRICT na RPC atualizar_consentimento_whatsapp
-- e em qualquer futura RPC que busque membro por auth_user_id.

ALTER TABLE public.membros
  ADD CONSTRAINT membros_auth_user_id_key UNIQUE (auth_user_id);
