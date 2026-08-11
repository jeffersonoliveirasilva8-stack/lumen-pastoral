-- Migration 137 — Fix paroquia_not_found para super_admin
--
-- Causa raiz: funções usavam LIMIT 1 sem ORDER BY em user_roles,
-- fazendo o super_admin (paroquia_id=NULL) ser selecionado primeiro.
-- Fix: derivar paróquia dos dados da escala (mais confiável) + checar
-- permissão por EXISTS em vez de comparar paroquia_id do caller.
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. registrar_substituto_retroativo
--    Deriva paróquia do escala_membro, não do perfil do caller.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_substituto_retroativo(
  p_escala_membro_id UUID,
  p_substituto_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id      UUID := auth.uid();
  v_em           public.escala_membros%ROWTYPE;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_tipo_evento  TEXT;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Verifica permissão: deve ter role adequado em qualquer paróquia (ou super_admin)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_auth_id
      AND ur.role::TEXT IN ('coordenador','admin_paroquial','super_admin','lider')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Busca escala_membro
  SELECT * INTO v_em FROM public.escala_membros WHERE id = p_escala_membro_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_membro_not_found');
  END IF;

  -- Deriva paróquia diretamente da escala (confiável, sem depender do perfil do caller)
  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
    INTO v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM public.escalas e WHERE e.id = v_em.escala_id;

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_not_found');
  END IF;

  -- Verifica que o caller tem permissão nesta paróquia específica
  -- (super_admin tem paroquia_id=NULL → acesso irrestrito)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_auth_id
      AND ur.role::TEXT IN ('coordenador','admin_paroquial','super_admin','lider')
      AND (ur.paroquia_id = v_paroquia_id OR ur.paroquia_id IS NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.membros
    WHERE id = p_substituto_id AND paroquia_id = v_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituto_not_found');
  END IF;

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  -- Membro original: 'justificou' (não é falta — providenciou substituto)
  UPDATE public.escala_membros
     SET status = 'justificou'
   WHERE id = p_escala_membro_id;

  -- Garante 0 pontos para o original
  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id, tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, v_em.membro_id, v_em.escala_id, v_em.ministerio_id,
     v_tipo_evento, 'escala', 'justificou', v_escala_data, 0)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala', 'solene', 'bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE SET presenca = 'justificou', pontos = 0;

  -- Recalcula score do original
  UPDATE public.membros
     SET score = (
       SELECT COALESCE(SUM(hp.pontos), 0)
       FROM public.historico_participacoes hp
       WHERE hp.membro_id = v_em.membro_id
     )
   WHERE id = v_em.membro_id;

  -- Substituto: 'presente'
  INSERT INTO public.escala_membros
    (escala_id, membro_id, ministerio_id, status, ativo, removido_em, origem)
  VALUES
    (v_em.escala_id, p_substituto_id, v_em.ministerio_id, 'presente', true, NULL, 'manual')
  ON CONFLICT (escala_id, membro_id, ministerio_id) DO UPDATE
    SET status      = 'presente',
        ativo       = true,
        removido_em = NULL,
        origem      = 'manual';

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_substituto_retroativo(UUID, UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. expirar_substituicoes_vencidas
--    ORDER BY paroquia_id NULLS LAST para não pegar linha NULL do super_admin.
--    Se p_paroquia_id não for passado e caller for super_admin sem paróquia,
--    retorna erro instruindo a passar o argumento.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expirar_substituicoes_vencidas(
  p_paroquia_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_paroquia   UUID;
  v_role       TEXT;
  v_expiradas  INT := 0;
  v_faltas     INT := 0;
BEGIN
  SELECT ur.role::TEXT, ur.paroquia_id INTO v_role, v_paroquia
  FROM public.user_roles ur
  WHERE ur.user_id = v_auth_id
    AND ur.role::TEXT IN ('coordenador','admin_paroquial','super_admin','lider')
  ORDER BY ur.paroquia_id NULLS LAST
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- p_paroquia_id tem precedência (super_admin passa a paróquia alvo)
  IF p_paroquia_id IS NOT NULL THEN
    v_paroquia := p_paroquia_id;
  END IF;

  IF v_paroquia IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_id_required');
  END IF;

  UPDATE public.substituicoes s
     SET status = 'cancelada'
    FROM public.escalas e
   WHERE s.escala_id = e.id
     AND s.paroquia_id = v_paroquia
     AND s.status IN ('solicitada', 'com_voluntario')
     AND e.data < CURRENT_DATE;

  GET DIAGNOSTICS v_expiradas = ROW_COUNT;

  UPDATE public.escala_membros em
     SET status = 'faltou'
    FROM public.escalas e
   WHERE em.escala_id = e.id
     AND e.paroquia_id = v_paroquia
     AND e.data < CURRENT_DATE
     AND e.status = 'publicada'
     AND em.status NOT IN ('presente', 'faltou', 'atrasado', 'justificou', 'ausente', 'confirmado')
     AND (em.ativo IS NULL OR em.ativo = true);

  GET DIAGNOSTICS v_faltas = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',    true,
    'expiradas',  v_expiradas,
    'faltas',     v_faltas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expirar_substituicoes_vencidas(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
