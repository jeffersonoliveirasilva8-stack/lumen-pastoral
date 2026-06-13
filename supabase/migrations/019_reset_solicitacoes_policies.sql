-- Migration 019: Reset completo das policies de solicitacoes_paroquia
-- Remove TODAS as policies existentes (incluindo quaisquer pré-existentes
-- que não foram capturadas pelas migrations 016/018) e recria do zero.

DO $$
DECLARE
  pol_name TEXT;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'solicitacoes_paroquia'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.solicitacoes_paroquia', pol_name);
  END LOOP;
END;
$$;

ALTER TABLE public.solicitacoes_paroquia ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (inclusive anônima) pode enviar solicitação de nova paróquia
CREATE POLICY "anon_insert_solicitacao"
  ON public.solicitacoes_paroquia
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Qualquer pessoa autenticada pode ver a própria solicitação pelo e-mail
-- (necessário para o .select("id") no retorno do insert via Supabase JS)
CREATE POLICY "anon_select_own_solicitacao"
  ON public.solicitacoes_paroquia
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Somente super_admin pode atualizar / excluir
CREATE POLICY "super_admin_manage_solicitacoes"
  ON public.solicitacoes_paroquia
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

GRANT USAGE  ON SCHEMA public                 TO anon;
GRANT INSERT ON public.solicitacoes_paroquia  TO anon;
GRANT SELECT ON public.solicitacoes_paroquia  TO anon;
GRANT INSERT, SELECT, UPDATE ON public.solicitacoes_paroquia TO authenticated;
GRANT ALL    ON public.solicitacoes_paroquia  TO service_role;
