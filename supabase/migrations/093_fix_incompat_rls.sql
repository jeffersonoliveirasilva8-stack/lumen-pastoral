-- Migration 093 — Fix RLS em membro_incompatibilidades: permitir leitura a coordenadores
--
-- Problema: a policy "lider_coordenador_rw" usa _portal_is_admin(), que só verifica
-- a tabela user_roles (super_admin, admin_paroquial, lider). Coordenadores que existem
-- apenas via membros.tipo_acesso='coordenador' não estão em user_roles → SELECT retorna
-- [] → incompatMap fica vazio → motor não bloqueia nenhuma alocação.
--
-- Solução: separar a policy FOR ALL em:
--   • SELECT: qualquer membro autenticado da paróquia pode ler (dado não-sensível;
--             necessário para o motor gerar escalas corretamente)
--   • INSERT/UPDATE/DELETE: mantido apenas para admins/_portal_is_admin()
--
-- IDEMPOTENTE: sim (DROP IF EXISTS + CREATE)

DROP POLICY IF EXISTS "lider_coordenador_rw"   ON public.membro_incompatibilidades;
DROP POLICY IF EXISTS "incompat_select"         ON public.membro_incompatibilidades;
DROP POLICY IF EXISTS "incompat_write"          ON public.membro_incompatibilidades;

-- Leitura: qualquer usuário autenticado que pertença à paróquia
CREATE POLICY "incompat_select" ON public.membro_incompatibilidades
  FOR SELECT
  USING (
    paroquia_id IN (
      SELECT paroquia_id FROM public.membros
      WHERE id = auth.uid() AND ativo = true
      UNION
      SELECT paroquia_id FROM public.profiles
      WHERE id = auth.uid()
    )
  );

-- Escrita: somente admins/líderes (mantém restrição original)
CREATE POLICY "incompat_write" ON public.membro_incompatibilidades
  FOR ALL
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

NOTIFY pgrst, 'reload schema';
