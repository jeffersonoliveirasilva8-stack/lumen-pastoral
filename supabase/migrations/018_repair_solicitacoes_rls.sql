-- Migration 018: Repair RLS for solicitacoes_paroquia
-- Migration 016 applied with NOTICE "relation already exists"; this ensures
-- the anon INSERT policy and grants are definitely in place.

ALTER TABLE public.solicitacoes_paroquia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public insert solicitacao paroquia" ON public.solicitacoes_paroquia;
CREATE POLICY "public insert solicitacao paroquia"
  ON public.solicitacoes_paroquia
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon;
GRANT INSERT ON public.solicitacoes_paroquia TO anon;
GRANT INSERT ON public.solicitacoes_paroquia TO authenticated;
GRANT ALL    ON public.solicitacoes_paroquia TO service_role;
