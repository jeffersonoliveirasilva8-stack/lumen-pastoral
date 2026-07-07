-- Migration 113 — Expirar substituições vencidas + presença retroativa
--
-- 1. expirar_substituicoes_vencidas(): fecha substituições abertas cujas escalas
--    já ocorreram, marcando o solicitante como "faltou".
-- 2. registrar_substituto_retroativo(): registra retroativamente que outro membro
--    serviu no lugar do escalado original, corrigindo pontos de ambos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. expirar_substituicoes_vencidas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expirar_substituicoes_vencidas(
  p_paroquia_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id  UUID := COALESCE(p_paroquia_id, (
    SELECT paroquia_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
  ));
  v_count        INTEGER := 0;
  rec            RECORD;
BEGIN
  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'paroquia_nao_encontrada');
  END IF;

  -- Substituições ainda abertas (solicitada ou com_voluntario) cujas escalas
  -- já ocorreram (data < hoje)
  FOR rec IN
    SELECT
      s.id                  AS sub_id,
      s.escala_membro_id,
      em.membro_id,
      em.status             AS status_atual
    FROM public.substituicoes s
    JOIN public.escala_membros em ON em.id  = s.escala_membro_id
    JOIN public.escalas        e  ON e.id   = em.escala_id
    WHERE s.status          IN ('solicitada', 'com_voluntario')
      AND e.paroquia_id     = v_paroquia_id
      AND e.data            < CURRENT_DATE
  LOOP
    -- Fecha a substituição
    UPDATE public.substituicoes
       SET status     = 'cancelada',
           updated_at = NOW()
     WHERE id = rec.sub_id;

    -- Marca o membro como faltou (apenas se ainda não tiver status final)
    IF rec.status_atual NOT IN ('presente','faltou','atrasado','justificou','ausente') THEN
      UPDATE public.escala_membros
         SET status = 'faltou'
       WHERE id = rec.escala_membro_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'expiradas', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expirar_substituicoes_vencidas(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. registrar_substituto_retroativo
--    Usado na sacristia quando outro membro serviu no lugar do escalado original
--    mas isso não foi registrado antes da missa.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_substituto_retroativo(
  p_escala_membro_id   UUID,
  p_substituto_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_role         TEXT;
  v_escala_id    UUID;
  v_ministerio_id UUID;
  v_membro_id    UUID;
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_substituto_ja_na_escala BOOLEAN;
BEGIN
  -- Verifica autorização: apenas coordenador/admin/lider
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('lider','coordenador','admin_paroquial','vice_coordenador','super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Carrega dados do escala_membro original
  SELECT
    em.escala_id,
    em.ministerio_id,
    em.membro_id,
    e.paroquia_id,
    e.data
  INTO v_escala_id, v_ministerio_id, v_membro_id, v_paroquia_id, v_escala_data
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  -- Valida que o substituto pertence à mesma paróquia
  IF NOT EXISTS (
    SELECT 1 FROM public.membros
    WHERE id = p_substituto_id AND paroquia_id = v_paroquia_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'substituto_invalido');
  END IF;

  -- Marca original como faltou
  UPDATE public.escala_membros
     SET status = 'faltou'
   WHERE id = p_escala_membro_id;

  -- Verifica se o substituto já tem linha nesta escala + ministério
  SELECT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE escala_id    = v_escala_id
      AND membro_id    = p_substituto_id
      AND ministerio_id = v_ministerio_id
      AND (ativo IS NULL OR ativo = true)
  ) INTO v_substituto_ja_na_escala;

  IF v_substituto_ja_na_escala THEN
    -- Apenas atualiza status para presente
    UPDATE public.escala_membros
       SET status = 'presente'
     WHERE escala_id    = v_escala_id
       AND membro_id    = p_substituto_id
       AND ministerio_id = v_ministerio_id
       AND (ativo IS NULL OR ativo = true);
  ELSE
    -- Insere nova linha para o substituto
    INSERT INTO public.escala_membros (escala_id, membro_id, ministerio_id, status, origem)
    VALUES (v_escala_id, p_substituto_id, v_ministerio_id, 'presente', 'substituto_retroativo');
  END IF;

  RETURN jsonb_build_object(
    'success',       true,
    'original_id',   v_membro_id,
    'substituto_id', p_substituto_id,
    'escala_id',     v_escala_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_substituto_retroativo(UUID, UUID) TO authenticated;
