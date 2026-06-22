-- Migration 090 — Fix tipos_prioridade_write: restringir escrita a admins/coordenadores
--
-- Problema: a policy write de tipos_prioridade (migration 037) usa apenas
-- paroquia_id = current_paroquia_id(), permitindo que qualquer membro autenticado
-- da paróquia crie, edite ou delete tipos de prioridade. Apenas coordenadores/admins
-- devem ter esse acesso.
--
-- IDEMPOTENTE: sim (DROP IF EXISTS + CREATE)

DROP POLICY IF EXISTS "tipos_prioridade_write" ON public.tipos_prioridade;

CREATE POLICY "tipos_prioridade_write" ON public.tipos_prioridade
  FOR ALL
  USING  (_portal_is_admin(paroquia_id))
  WITH CHECK (_portal_is_admin(paroquia_id));

NOTIFY pgrst, 'reload schema';
