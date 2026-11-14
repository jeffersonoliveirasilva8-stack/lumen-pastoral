-- Migration 227 — RPC verificar_pendentes_arquivamento
--
-- Retorna membros ativos de uma escala que ainda estão em status não-final
-- (pendente, confirmado) antes de arquivá-la. Usada pelo frontend para exibir
-- modal de alerta antes de concluir o arquivamento manual.
--
-- Status considerados "não-finais": pendente, confirmado
-- Status considerados "finais": presente, faltou, ausente, atrasado, justificou, recusado

CREATE OR REPLACE FUNCTION public.verificar_pendentes_arquivamento(
  p_escala_id UUID
)
RETURNS TABLE (
  membro_id      UUID,
  membro_nome    TEXT,
  ministerio_id  UUID,
  ministerio_nome TEXT,
  status_atual   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  STATUS_FINAIS CONSTANT TEXT[] := ARRAY[
    'presente','faltou','ausente','atrasado','justificou','recusado'
  ];
BEGIN
  SELECT e.paroquia_id INTO v_paroquia_id
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Verifica permissão: admin da paróquia OU coordenador da mesma paróquia
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR (
      public._portal_is_coord(public._portal_membro_id())
      AND public._portal_membro_paroquia(public._portal_membro_id()) = v_paroquia_id
    )
  ) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;

  RETURN QUERY
  SELECT
    em.membro_id,
    m.nome          AS membro_nome,
    em.ministerio_id,
    min.nome        AS ministerio_nome,
    em.status       AS status_atual
  FROM   public.escala_membros em
  JOIN   public.membros      m   ON m.id   = em.membro_id
  JOIN   public.ministerios  min ON min.id = em.ministerio_id
  WHERE  em.escala_id = p_escala_id
    AND  em.ativo     = true
    AND  NOT (em.status = ANY(STATUS_FINAIS));
END;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_pendentes_arquivamento(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.verificar_pendentes_arquivamento(UUID) FROM anon;

COMMENT ON FUNCTION public.verificar_pendentes_arquivamento(UUID)
  IS 'Retorna membros ativos com status não-final de uma escala. Usado para alerta antes de arquivar.';
