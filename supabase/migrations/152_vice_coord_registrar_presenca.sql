-- Migration 152: Vice-coordenador pode registrar presenças de escala
--
-- PROBLEMA: salvar_presencas_escala usa _portal_is_coord() que consulta a
-- tabela `coordenadores`. Vice-coordenadores têm tipo_acesso='vice' em
-- `membros` e role='coordenador' em `user_roles`, mas não estão em
-- `coordenadores` — portanto recebem P0001.
--
-- SOLUÇÃO: adicionar verificação de tipo_acesso IN ('vice','coordenador',
-- 'administrador') diretamente na função, idêntica ao padrão de
-- is_coordenador_da_paroquia (migration 096/100).

CREATE OR REPLACE FUNCTION public.salvar_presencas_escala(
  p_escala_id UUID,
  p_updates   JSONB   -- [{"id": "<escala_membro_id>", "status": "<status>"}]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  v_caller_membro UUID;
  v_item JSONB;
  v_status TEXT;
  v_id UUID;
  STATUS_VALIDOS CONSTANT TEXT[] :=
    ARRAY['presente','faltou','atrasado','justificou','ausente','pendente'];
BEGIN
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.escalas WHERE id = p_escala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada';
  END IF;

  v_caller_membro := public._portal_membro_id();

  -- Permite: admin, coordenador ativo (tabela coordenadores),
  -- vice/coord/admin via tipo_acesso em membros, OU membro escalado nesta escala
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = v_caller_membro
        AND paroquia_id = v_paroquia_id
        AND ativo       = true
        AND tipo_acesso IN ('vice', 'coordenador', 'administrador')
    )
    OR EXISTS (
      SELECT 1 FROM public.escala_membros
      WHERE escala_id = p_escala_id
        AND membro_id = v_caller_membro
        AND (ativo IS NULL OR ativo = true)
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores, coordenadores e membros escalados podem registrar presenças . (P0001)';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_id     := (v_item->>'id')::UUID;
    v_status := v_item->>'status';

    IF v_status IS NULL OR NOT (v_status = ANY(STATUS_VALIDOS)) THEN
      RAISE EXCEPTION 'Status inválido: %', v_status;
    END IF;

    UPDATE public.escala_membros
    SET    status                  = v_status,
           presenca_registrada_por = v_caller_membro,
           presenca_registrada_em  = NOW()
    WHERE  id        = v_id
      AND  escala_id = p_escala_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_presencas_escala(UUID, JSONB) FROM anon;

NOTIFY pgrst, 'reload schema';
