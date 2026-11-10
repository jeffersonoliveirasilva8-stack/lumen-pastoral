-- Migration 212 — Sprint B Fix: cardinality() em convocar_pastoral_solene v3
--
-- v2: corrigiu array_length → cardinality()
-- v3: autorização verificada antes de revelar detalhes da escala e ministérios,
--     evitando que usuários sem permissão obtenham informações via respostas de erro.

CREATE OR REPLACE FUNCTION public.convocar_pastoral_solene(
  p_escala_id      UUID,
  p_ministerio_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id       UUID := auth.uid();
  v_caller_membro UUID;
  v_paroquia_id   UUID;
  v_solene        BOOLEAN;
  v_status_escala TEXT;
  v_escala_data   DATE;
  v_inseridos     INTEGER := 0;
  v_ignorados     INTEGER := 0;
BEGIN
  -- 1. Autenticação (antes de qualquer leitura)
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- 2. Validação de input (antes de tocar o banco)
  -- cardinality() retorna 0 para array vazio; array_length retornaria NULL
  IF p_ministerio_ids IS NULL OR cardinality(p_ministerio_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ministerio_ids_obrigatorio');
  END IF;

  -- 3. Lê apenas paróquia_id — mínimo necessário para verificar autorização
  SELECT e.paroquia_id INTO v_paroquia_id
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_encontrada');
  END IF;

  -- 4. Autorização verificada antes de revelar tipo, status ou dados da escala
  v_caller_membro := public._portal_membro_id();

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public._portal_is_coord(v_caller_membro)
    OR EXISTS (
      SELECT 1 FROM public.membros
      WHERE id          = v_caller_membro
        AND paroquia_id = v_paroquia_id
        AND ativo       = true
        AND tipo_acesso IN ('vice','coordenador')
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- 5. Agora que o usuário está autorizado, lê os demais detalhes da escala
  SELECT e.solene, e.status, e.data
  INTO   v_solene, v_status_escala, v_escala_data
  FROM   public.escalas e
  WHERE  e.id = p_escala_id;

  IF NOT v_solene THEN
    RETURN jsonb_build_object('success', false, 'error', 'apenas_missas_solenes');
  END IF;

  IF v_status_escala NOT IN ('rascunho','publicada') THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_nao_editavel',
                              'status', v_status_escala);
  END IF;

  -- 6. Valida ministérios (após autorização confirmada)
  IF EXISTS (
    SELECT 1 FROM unnest(p_ministerio_ids) AS mid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ministerios
      WHERE id = mid.id AND paroquia_id = v_paroquia_id AND ativo = true
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ministerio_invalido_ou_de_outra_paroquia');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_escala_id::text || '_convocar'));

  WITH membros_a_convocar AS (
    SELECT DISTINCT m.id AS membro_id
    FROM   public.membros m
    JOIN   public.membro_ministerios mm ON mm.membro_id = m.id
    WHERE  m.paroquia_id    = v_paroquia_id
      AND  m.ativo          = true
      AND  mm.ministerio_id = ANY(p_ministerio_ids)
      AND  mm.ativo         = true
  ),
  resultado AS (
    INSERT INTO public.escala_convocacoes
      (escala_id, membro_id, paroquia_id, convocado_por)
    SELECT p_escala_id, mac.membro_id, v_paroquia_id, v_auth_id
    FROM   membros_a_convocar mac
    ON CONFLICT (escala_id, membro_id) DO NOTHING
    RETURNING membro_id
  ),
  notif AS (
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida,
       apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    SELECT
      v_paroquia_id,
      'Convocação: Missa Solene',
      format('Você foi convocado para a celebração de %s.',
             to_char(v_escala_data, 'DD/MM/YYYY')),
      'aviso', false, false, false,
      r.membro_id,
      '/portal-membro/escalas'
    FROM resultado r
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inseridos FROM resultado;

  SELECT COUNT(DISTINCT mm.membro_id) - v_inseridos INTO v_ignorados
  FROM   public.membro_ministerios mm
  JOIN   public.membros m ON m.id = mm.membro_id
  WHERE  mm.ministerio_id = ANY(p_ministerio_ids)
    AND  mm.ativo         = true
    AND  m.paroquia_id    = v_paroquia_id
    AND  m.ativo          = true;

  IF v_ignorados < 0 THEN v_ignorados := 0; END IF;

  UPDATE public.escalas
  SET tem_convocacao_geral = true
  WHERE id = p_escala_id;

  RETURN jsonb_build_object(
    'success',    true,
    'inseridos',  v_inseridos,
    'ignorados',  v_ignorados,
    'total',      v_inseridos + v_ignorados
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.convocar_pastoral_solene(UUID, UUID[]) TO authenticated;
