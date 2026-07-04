-- Migration 087 — Adiciona política INSERT para coordenadores em escala_membros
--
-- PROBLEMA:
--   A migration 040 criou apenas "escala_membros_admin" (FOR ALL) para admins e
--   "em_coord_read" / "em_coord_update" para coordenadores.
--   Coordenadores NÃO possuem política de INSERT → tentativas de adicionar membros
--   manualmente em escalas publicadas falham com violação de RLS, silenciosamente
--   ou com mensagem técnica, sem salvar o membro.
--
-- FIX:
--   Cria "em_coord_insert" e "em_coord_delete" para que coordenadores possam
--   adicionar e remover membros de escalas da sua paróquia.
--
-- IDEMPOTENTE: sim (DROP IF EXISTS / CREATE)

-- INSERT: coordenador pode atribuir membro a escala da sua paróquia
DROP POLICY IF EXISTS "em_coord_insert" ON public.escala_membros;
CREATE POLICY "em_coord_insert" ON public.escala_membros
  FOR INSERT TO authenticated
  WITH CHECK (
    public._portal_is_coord(public._portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = public.current_paroquia_id()
    )
  );

-- DELETE: coordenador pode remover membro de escala da sua paróquia
DROP POLICY IF EXISTS "em_coord_delete" ON public.escala_membros;
CREATE POLICY "em_coord_delete" ON public.escala_membros
  FOR DELETE TO authenticated
  USING (
    public._portal_is_coord(public._portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = public.current_paroquia_id()
    )
  );

NOTIFY pgrst, 'reload schema';
