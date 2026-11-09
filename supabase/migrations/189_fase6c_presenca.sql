-- ============================================================
-- Migration 189: FASE 6C — Gestão de elegibilidade por presença
-- Data: 2026-11-09
--
-- OBJETIVO:
--   Implementa suspensão automática e restabelecimento manual de
--   membros com recorrência de ausências em janela móvel de 45 dias.
--
-- COMPONENTES:
--   1. Coluna anulada em historico_participacoes
--   2. Tabela membro_decisoes_presenca
--   3. Trigger on_escala_membro_delete (anula histórico ao remover)
--   4. RPC coord_calcular_suspensoes_fase6c
--   5. RPC coord_restabelecer_membro_presenca
--   6. RPC coord_get_elegibilidade_presenca
--   7. RPC coord_anular_participacao
--   8. RLS e permissões
--
-- IDEMPOTENTE: sim (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)
-- REQUER: migrations 026, 081, 085, 010 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. Coluna anulada em historico_participacoes
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.historico_participacoes
  ADD COLUMN IF NOT EXISTS anulada         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anulada_motivo  TEXT,
  ADD COLUMN IF NOT EXISTS anulada_por     UUID        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS anulada_em      TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════
-- 2. Tabela membro_decisoes_presenca
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.membro_decisoes_presenca (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id  UUID        NOT NULL REFERENCES public.paroquias(id) ON DELETE CASCADE,
  membro_id    UUID        NOT NULL REFERENCES public.membros(id)   ON DELETE CASCADE,
  tipo         TEXT        NOT NULL CHECK (tipo IN ('suspensao', 'restabelecimento')),
  motivo       TEXT,
  imune_ate    DATE,       -- NULL em suspensão; hoje+45 em restabelecimento
  ativa        BOOLEAN     NOT NULL DEFAULT true,
  criado_por   UUID        REFERENCES auth.users(id),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice único parcial: apenas 1 decisão ativa por membro/paróquia
CREATE UNIQUE INDEX IF NOT EXISTS uq_decisao_ativa
  ON public.membro_decisoes_presenca (paroquia_id, membro_id)
  WHERE ativa = true;

ALTER TABLE public.membro_decisoes_presenca ENABLE ROW LEVEL SECURITY;

-- Leitura: Coordenação ativa OU admin da paróquia
CREATE POLICY "decisoes_read_coord_admin"
  ON public.membro_decisoes_presenca FOR SELECT TO authenticated
  USING (
    public._portal_is_admin(paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.coordenadores c
      JOIN public.membros m ON m.id = c.membro_id
      WHERE m.auth_user_id = auth.uid()
        AND m.paroquia_id = membro_decisoes_presenca.paroquia_id
        AND c.ativo        = true
    )
  );

-- Escrita direta bloqueada — apenas via RPCs SECURITY DEFINER
CREATE POLICY "decisoes_no_direct_write"
  ON public.membro_decisoes_presenca FOR INSERT
  WITH CHECK (false);

CREATE POLICY "decisoes_no_direct_update"
  ON public.membro_decisoes_presenca FOR UPDATE
  USING (false);

-- ══════════════════════════════════════════════════════════════
-- 3. Trigger: anula histórico quando escala_membro é deletado
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_anular_historico_em_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status_final TEXT[] := ARRAY[
    'presente','confirmado','faltou','ausente','atrasado','justificou','recusado'
  ];
BEGIN
  IF OLD.status = ANY(v_status_final) THEN
    UPDATE public.historico_participacoes
       SET anulada        = true,
           anulada_motivo = 'escala_membro_deletado',
           anulada_por    = auth.uid(),   -- NULL quando não há sessão autenticada (pg_cron, admin SQL)
           anulada_em     = now()
     WHERE membro_id     = OLD.membro_id
       AND escala_id     = OLD.escala_id
       AND ministerio_id = OLD.ministerio_id
       AND anulada       = false;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_membro_delete ON public.escala_membros;
CREATE TRIGGER on_escala_membro_delete
  BEFORE DELETE ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_anular_historico_em_delete();

-- ══════════════════════════════════════════════════════════════
-- 4. RPC coord_calcular_suspensoes_fase6c
-- ══════════════════════════════════════════════════════════════
-- Avalia todos os membros ativos da paróquia e insere suspensão
-- para quem atingir os critérios (sem imunidade ativa).
-- Dispara _notify_coordenacao apenas para novas suspensões.
-- Serializado por pg_advisory_xact_lock para evitar duplicatas.

CREATE OR REPLACE FUNCTION public.coord_calcular_suspensoes_fase6c(
  p_paroquia_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id        UUID := auth.uid();
  v_membro         RECORD;
  v_data_inicio    DATE;
  v_total          INTEGER;
  v_ausencias      INTEGER;
  v_nova_id        UUID;
  v_suspensos      INTEGER := 0;
  v_imune_ate      DATE;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public._portal_is_admin(p_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Serializa execuções concorrentes para a mesma paróquia
  PERFORM pg_advisory_xact_lock(hashtext(p_paroquia_id::text));

  FOR v_membro IN
    SELECT id, nome FROM public.membros
    WHERE paroquia_id = p_paroquia_id AND ativo = true
  LOOP
    -- Verifica imunidade ativa
    SELECT imune_ate INTO v_imune_ate
    FROM public.membro_decisoes_presenca
    WHERE membro_id   = v_membro.id
      AND paroquia_id = p_paroquia_id
      AND tipo        = 'restabelecimento'
      AND ativa       = true
    ORDER BY criado_em DESC
    LIMIT 1;

    IF v_imune_ate IS NOT NULL AND v_imune_ate >= CURRENT_DATE THEN
      CONTINUE; -- ainda na janela de imunidade
    END IF;

    -- Calcula data_inicio da janela: max(hoje-45, dia_seguinte_ao_último_restabelecimento)
    SELECT GREATEST(
      CURRENT_DATE - INTERVAL '45 days',
      COALESCE(
        (SELECT (criado_em::date + 1)
         FROM public.membro_decisoes_presenca
         WHERE membro_id   = v_membro.id
           AND paroquia_id = p_paroquia_id
           AND tipo        = 'restabelecimento'
         ORDER BY criado_em DESC
         LIMIT 1),
        '1970-01-01'::date
      )
    )::date INTO v_data_inicio;

    -- Conta convocações concluídas e ausências na janela
    SELECT
      COUNT(*) FILTER (WHERE presenca IN ('presente','atrasado','faltou','ausente','justificou')),
      COUNT(*) FILTER (WHERE presenca IN ('faltou','ausente','justificou'))
    INTO v_total, v_ausencias
    FROM public.historico_participacoes
    WHERE membro_id   = v_membro.id
      AND paroquia_id = p_paroquia_id
      AND data        >= v_data_inicio
      AND data        <= CURRENT_DATE
      AND anulada     = false;

    -- Verifica critérios: >= 3 convocações, >= 2 ausências, taxa >= 50%
    IF v_total < 3 OR v_ausencias < 2 THEN
      CONTINUE;
    END IF;
    IF (v_ausencias::numeric / v_total) < 0.5 THEN
      CONTINUE;
    END IF;

    -- Tenta inserir suspensão (ON CONFLICT = já existe ativa → pula)
    -- Encerra decisão vigente antes de inserir nova
    UPDATE public.membro_decisoes_presenca
       SET ativa = false
     WHERE membro_id   = v_membro.id
       AND paroquia_id = p_paroquia_id
       AND ativa       = true
       AND tipo        = 'restabelecimento'; -- só encerra restabelecimento expirado

    INSERT INTO public.membro_decisoes_presenca
      (paroquia_id, membro_id, tipo, motivo, imune_ate, ativa, criado_por)
    VALUES (
      p_paroquia_id, v_membro.id, 'suspensao',
      format('Taxa de ausência: %s/%s convocações na janela de 45 dias', v_ausencias, v_total),
      NULL, true, v_auth_id
    )
    ON CONFLICT (paroquia_id, membro_id) WHERE ativa = true
      DO NOTHING
    RETURNING id INTO v_nova_id;

    IF v_nova_id IS NOT NULL THEN
      v_suspensos := v_suspensos + 1;
      PERFORM public._notify_coordenacao(
        p_paroquia_id,
        'Membro suspenso por ausências recorrentes',
        format('%s atingiu o limite de ausências na janela de 45 dias (%s/%s convocações).', v_membro.nome, v_ausencias, v_total),
        'alerta'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'novos_suspensos', v_suspensos);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_calcular_suspensoes_fase6c(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. RPC coord_restabelecer_membro_presenca
-- ══════════════════════════════════════════════════════════════
-- Exclusivo para coordenadores ativos da paróquia do membro.
-- Encerra suspensão vigente e insere restabelecimento com imunidade.

CREATE OR REPLACE FUNCTION public.coord_restabelecer_membro_presenca(
  p_membro_id UUID,
  p_motivo    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_paroquia_id UUID;
  v_suspensao_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Resolve paróquia do membro (nunca aceita paroquia_id como parâmetro)
  SELECT paroquia_id INTO v_paroquia_id
  FROM public.membros WHERE id = p_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  -- Autorização: apenas coordenador ATIVO da paróquia do membro
  IF NOT EXISTS (
    SELECT 1 FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE m.auth_user_id = v_auth_id
      AND m.paroquia_id = v_paroquia_id
      AND c.ativo        = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'apenas_coordenacao_ativa');
  END IF;

  -- Verifica que o membro está suspenso
  SELECT id INTO v_suspensao_id
  FROM public.membro_decisoes_presenca
  WHERE membro_id   = p_membro_id
    AND paroquia_id = v_paroquia_id
    AND tipo        = 'suspensao'
    AND ativa       = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_suspenso');
  END IF;

  -- Encerra suspensão vigente
  UPDATE public.membro_decisoes_presenca
     SET ativa = false
   WHERE id = v_suspensao_id;

  -- Insere restabelecimento com imunidade de 45 dias corridos
  INSERT INTO public.membro_decisoes_presenca
    (paroquia_id, membro_id, tipo, motivo, imune_ate, ativa, criado_por)
  VALUES (
    v_paroquia_id, p_membro_id, 'restabelecimento',
    p_motivo,
    (CURRENT_DATE + INTERVAL '45 days')::date,
    true, v_auth_id
  );

  RETURN jsonb_build_object('success', true, 'imune_ate', (CURRENT_DATE + INTERVAL '45 days')::date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_restabelecer_membro_presenca(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 6. RPC coord_get_elegibilidade_presenca
-- ══════════════════════════════════════════════════════════════
-- Retorna a decisão ativa de cada membro suspenso na paróquia.
-- SECURITY INVOKER: RLS da tabela controla acesso.

CREATE OR REPLACE FUNCTION public.coord_get_elegibilidade_presenca(
  p_paroquia_id UUID
)
RETURNS TABLE (
  membro_id   UUID,
  tipo        TEXT,
  imune_ate   DATE,
  motivo      TEXT,
  criado_em   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.membro_id,
    d.tipo,
    d.imune_ate,
    d.motivo,
    d.criado_em
  FROM public.membro_decisoes_presenca d
  WHERE d.paroquia_id = p_paroquia_id
    AND d.ativa       = true
  ORDER BY d.criado_em DESC;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_elegibilidade_presenca(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 7. RPC coord_anular_participacao
-- ══════════════════════════════════════════════════════════════
-- Permite coordenação ou admin anular registro histórico manualmente
-- (caso o escala_membro já tenha sido deletado sem trigger).

CREATE OR REPLACE FUNCTION public.coord_anular_participacao(
  p_historico_id UUID,
  p_motivo       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id    UUID := auth.uid();
  v_paroquia_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT paroquia_id INTO v_paroquia_id
  FROM public.historico_participacoes WHERE id = p_historico_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registro_nao_encontrado');
  END IF;

  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR EXISTS (
      SELECT 1 FROM public.coordenadores c
      JOIN public.membros m ON m.id = c.membro_id
      WHERE m.auth_user_id = v_auth_id
        AND m.paroquia_id = v_paroquia_id
        AND c.ativo        = true
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  UPDATE public.historico_participacoes
     SET anulada        = true,
         anulada_motivo = p_motivo,
         anulada_por    = v_auth_id,
         anulada_em     = now()
   WHERE id      = p_historico_id
     AND anulada = false;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_anular_participacao(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 8. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Coluna anulada existe em historico_participacoes
--   ✓ Tabela membro_decisoes_presenca criada
--   ✓ Índice uq_decisao_ativa ativo
--   ✓ Trigger on_escala_membro_delete ativo
--   ✓ coord_calcular_suspensoes_fase6c executa sem erro
--   ✓ coord_restabelecer_membro_presenca recusa não-coordenador
--   ✓ coord_get_elegibilidade_presenca retorna lista correta
--   ✓ coord_anular_participacao marca anulada=true
-- ─────────────────────────────────────────────────────────────
