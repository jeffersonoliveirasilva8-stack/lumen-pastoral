-- Migration 100 — Fix is_coordenador_da_paroquia: remover valores inválidos do enum app_role
--
-- Migration 096 recriou is_coordenador_da_paroquia com:
--   AND ur.role IN ('coordenador', 'auxiliar', 'admin_paroquial', 'lider', 'super_admin')
--
-- O enum app_role no banco real é:
--   {super_admin, admin_paroquial, lider, servidor, coordenador}
--
-- 'auxiliar' e 'admin' NÃO existem no enum. Toda chamada à função lançava:
--   "invalid input value for enum app_role: auxiliar"
-- Esta função é chamada via RLS ao fazer UPDATE em membros, por isso o erro
-- aparecia em operações de edição de membros.
--
-- Fix: remover 'auxiliar' e 'admin' do IN clause.
-- A verificação de acesso por tipo_acesso em membros (texto) já cobre auxiliar/vice.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION public.is_coordenador_da_paroquia(p_paroquia_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.membros m
    WHERE (m.auth_user_id = auth.uid()
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.paroquia_id = p_paroquia_id
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'vice', 'coordenador', 'administrador')
    UNION ALL
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.paroquia_id = p_paroquia_id
      AND ur.role IN ('coordenador', 'admin_paroquial', 'lider', 'super_admin')
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_coordenador_da_paroquia(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
