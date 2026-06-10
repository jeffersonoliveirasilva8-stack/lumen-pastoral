-- ============================================================
-- LUMEN PASTORAL — PATCH F (2026-06-09)
-- Execute no SQL Editor do Supabase (projeto cusuoggmlhtvrclrzvfr)
-- Idempotente.
--
-- Problema: ocorrencias_membros permanece vazio para admin mesmo
--   após PATCH_D e PATCH_E — o RLS via user_roles pode ter
--   paroquia_id divergente do perfil do admin.
--
-- Solução: SECURITY DEFINER RPC que verifica internamente se o
--   chamador tem acesso e retorna os dados diretamente, sem
--   depender do RLS para SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ocorrencias_paroquia(
  p_paroquia_id uuid,
  p_status      text DEFAULT 'todas'
)
RETURNS TABLE (
  id             uuid,
  paroquia_id    uuid,
  membro_id      uuid,
  tipo           text,
  titulo         text,
  descricao      text,
  status         text,
  resposta       text,
  respondido_por uuid,
  created_at     timestamptz,
  updated_at     timestamptz,
  membro_nome    text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verifica acesso: admin_paroquial, super_admin, lider ou coordenador
  -- Aceita paroquia_id específica OU NULL (super_admin sem paróquia)
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
      AND (ur.paroquia_id = p_paroquia_id OR ur.paroquia_id IS NULL)
  ) THEN
    -- Sem permissão: retorna vazio (não lança erro para não vazar info)
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    om.id,
    om.paroquia_id,
    om.membro_id,
    om.tipo,
    om.titulo,
    om.descricao,
    om.status,
    om.resposta,
    om.respondido_por,
    om.created_at,
    om.updated_at,
    m.nome AS membro_nome
  FROM ocorrencias_membros om
  LEFT JOIN membros m ON m.id = om.membro_id
  WHERE om.paroquia_id = p_paroquia_id
    AND (p_status = 'todas' OR om.status = p_status)
  ORDER BY om.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ocorrencias_paroquia(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Validação ─────────────────────────────────────────────────
SELECT
  'PATCH F aplicado' AS status,
  (SELECT count(*) FROM information_schema.routines
   WHERE routine_name = 'get_ocorrencias_paroquia') AS fn_existe,
  (SELECT count(*) FROM ocorrencias_membros)        AS total_ocorrencias;
