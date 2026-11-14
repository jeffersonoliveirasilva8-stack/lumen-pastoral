-- Migration 228 — RPC verificar_membro_ja_escalado
--
-- Verifica se um membro já está escalado em outra escala da mesma paróquia e data,
-- quando permitir_duplicidade=false na configuração da paróquia.
--
-- Parâmetros:
--   p_membro_id    — membro a verificar
--   p_escala_id    — escala alvo (excluída da verificação, para não bloquear edição própria)
--   p_paroquia_id  — paróquia
--
-- Retorna:
--   ja_escalado    BOOLEAN — true se membro já está em outra escala ativa no mesmo dia
--   escala_titulo  TEXT    — título da escala conflitante (null se não há conflito)
--   ministerio_nome TEXT   — função conflitante

CREATE OR REPLACE FUNCTION public.verificar_membro_ja_escalado(
  p_membro_id    UUID,
  p_escala_id    UUID,
  p_paroquia_id  UUID
)
RETURNS TABLE (
  ja_escalado     BOOLEAN,
  escala_titulo   TEXT,
  ministerio_nome TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data              DATE;
  v_permitir_dup      BOOLEAN;
BEGIN
  -- Carrega a data da escala alvo
  SELECT e.data INTO v_data
  FROM   public.escalas e
  WHERE  e.id         = p_escala_id
    AND  e.paroquia_id = p_paroquia_id;

  IF NOT FOUND THEN
    -- Escala não encontrada ou de outra paróquia — não bloqueia
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Lê configuração de duplicidade da paróquia
  SELECT COALESCE(
    (regras_escala->>'permitir_duplicidade')::BOOLEAN,
    false
  )
  INTO v_permitir_dup
  FROM public.paroquias
  WHERE id = p_paroquia_id;

  -- Se duplicidade permitida, não verifica
  IF v_permitir_dup THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Verifica conflito: outro escala_membros ativo no mesmo dia, escala ativa (não cancelada)
  RETURN QUERY
  SELECT
    true                AS ja_escalado,
    e.titulo            AS escala_titulo,
    min.nome            AS ministerio_nome
  FROM   public.escala_membros em
  JOIN   public.escalas        e   ON e.id   = em.escala_id
  JOIN   public.ministerios    min ON min.id = em.ministerio_id
  WHERE  em.membro_id    = p_membro_id
    AND  e.paroquia_id   = p_paroquia_id
    AND  e.data          = v_data
    AND  e.status        NOT IN ('cancelada')
    AND  e.id            <> p_escala_id      -- exclui a própria escala
    AND  em.ativo        = true
    AND  em.status       NOT IN ('recusado')
  LIMIT 1;

  -- Se nenhuma linha retornada, retorna false
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_membro_ja_escalado(UUID, UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.verificar_membro_ja_escalado(UUID, UUID, UUID) FROM anon;

COMMENT ON FUNCTION public.verificar_membro_ja_escalado(UUID, UUID, UUID)
  IS 'Verifica se membro já está em outra escala do mesmo dia quando permitir_duplicidade=false.';
