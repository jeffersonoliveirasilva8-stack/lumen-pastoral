-- Migration 203 — Sprint B Fix: Privilégios das RPCs
--
-- Revoga EXECUTE de PUBLIC (herança padrão do PostgreSQL) e de anon,
-- concede apenas a authenticated. Sem este patch, qualquer role que herde
-- PUBLIC pode chamar as funções mesmo sem estar autenticado.
--
-- Também substitui a policy just_insert_membro por WITH CHECK (false)
-- para bloquear INSERTs diretos em participacao_justificativas via cliente.
-- Funções SECURITY DEFINER bypassam RLS e continuam funcionando normalmente.

-- convocar_pastoral_solene
REVOKE EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) TO authenticated;

-- registrar_comparecimento_solene
REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_comparecimento_solene(UUID, JSONB) TO authenticated;

-- avaliar_justificativa
REVOKE EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.avaliar_justificativa(UUID, TEXT, TEXT) TO authenticated;

-- solicitar_justificativa
REVOKE EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.solicitar_justificativa(UUID, TEXT, TEXT) TO authenticated;

-- Bloqueia INSERT direto em participacao_justificativas
-- (a RPC solicitar_justificativa é SECURITY DEFINER e bypassa RLS)
DROP POLICY IF EXISTS "just_insert_membro" ON public.participacao_justificativas;
CREATE POLICY "just_insert_membro" ON public.participacao_justificativas
  FOR INSERT WITH CHECK (false);
