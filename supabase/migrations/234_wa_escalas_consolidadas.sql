-- Migration 234 — RPCs de prévia e disparo consolidado de escalas WhatsApp
--
-- Cria duas funções SECURITY DEFINER acessíveis a authenticated (admin):
--
--   wa_preview_escalas_consolidadas(p_paroquia_id, p_operacao_id)
--     Retorna uma prévia de quem receberia mensagens e o conteúdo de cada uma.
--     Não enfileira nada — read-only.
--
--   wa_disparar_escalas_consolidadas(p_paroquia_id, p_operacao_id)
--     Enfileira uma mensagem consolidada por membro elegível no outbox.
--     Idempotente: a mesma operacao_id nunca cria duplicatas.
--
-- Autorização (backend — aplicada nas duas RPCs):
--   auth.uid() deve ter um registro em user_roles com:
--     role IN ('admin_paroquial', 'coordenador', 'super_admin')
--     E paroquia_id = p_paroquia_id  (super_admin dispensado da restrição)
--   Qualquer outra chamada recebe SQLSTATE 42501 (insufficient_privilege).
--
-- Elegibilidade:
--   - whatsapp_opt_in = true
--   - whatsapp_telefone NOT NULL
--   - membro da paroquia_id
--   - tem pelo menos uma escala futura publicada (data >= CURRENT_DATE)
--
-- Dedup por item de outbox:
--   evento_id = _outbox_evento_id(membro_id, 'escalas_consolidadas', p_operacao_id)
--   → uma mensagem por (membro, operação). Redespachar a mesma operação é seguro.
--
-- ATENÇÃO: a Edge Function send-whatsapp precisa de redeploy para aceitar
-- evento_tipo = 'escalas_consolidadas' (adicionado em whatsapp-contracts.ts).
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.

-- ── Prévia ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wa_preview_escalas_consolidadas(
  p_paroquia_id  uuid,
  p_operacao_id  uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_operacao_id       uuid;
  v_paroquia_nome     text;
  v_total_membros     int := 0;
  v_sem_consentimento int := 0;
  v_sem_telefone      int := 0;
  v_elegiveis         int := 0;
  v_mensagens         jsonb := '[]'::jsonb;
  v_rec               record;
  v_escalas           jsonb;
  v_ctx               jsonb;
  v_caller_id         uuid;
  v_tem_acesso        boolean := false;
BEGIN
  -- ── Autorização: auth.uid() com papel admin/coordenador na paróquia ──────────
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'acesso_negado: sessão sem autenticação' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id
      AND ur.role IN ('admin_paroquial', 'coordenador', 'super_admin')
      AND (ur.paroquia_id = p_paroquia_id OR ur.role = 'super_admin')
  ) INTO v_tem_acesso;

  IF NOT v_tem_acesso THEN
    RAISE EXCEPTION 'acesso_negado: papel insuficiente ou paróquia incorreta' USING ERRCODE = '42501';
  END IF;

  -- Gera operacao_id determinístico se não fornecido
  v_operacao_id := COALESCE(p_operacao_id, gen_random_uuid());

  -- Nome da paróquia
  SELECT nome INTO v_paroquia_nome
  FROM public.paroquias
  WHERE id = p_paroquia_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'paroquia_nao_encontrada: %', p_paroquia_id USING ERRCODE = 'P0001';
  END IF;

  -- Contagem de membros sem consentimento
  SELECT count(*) INTO v_sem_consentimento
  FROM public.membros m
  WHERE m.paroquia_id = p_paroquia_id
    AND (m.whatsapp_opt_in IS NOT TRUE OR m.whatsapp_telefone IS NULL);

  -- Iterar sobre membros elegíveis com escalas futuras
  FOR v_rec IN
    SELECT
      m.id               AS membro_id,
      SPLIT_PART(m.nome_completo, ' ', 1) AS primeiro_nome,
      m.nome_completo,
      COUNT(DISTINCT e.id) AS total_escalas
    FROM public.membros m
    JOIN public.escala_membros em ON em.membro_id = m.id AND em.ativo = true
    JOIN public.escalas         e  ON e.id = em.escala_id
    WHERE m.paroquia_id      = p_paroquia_id
      AND m.whatsapp_opt_in  = true
      AND m.whatsapp_telefone IS NOT NULL
      AND e.status           = 'publicada'
      AND e.data             >= CURRENT_DATE
    GROUP BY m.id, m.nome_completo
    ORDER BY m.nome_completo
  LOOP
    v_elegiveis := v_elegiveis + 1;

    -- Buscar escalas do membro em ordem cronológica
    SELECT jsonb_agg(
      jsonb_build_object(
        'data_escala',  to_char(e.data, 'DD/MM/YYYY'),
        'hora_escala',  to_char(e.hora_inicio, 'HH24:MI'),
        'celebracao',   e.titulo,
        'ministerio',   mn.nome,
        'local',        e.local
      ) ORDER BY e.data, e.hora_inicio
    )
    INTO v_escalas
    FROM public.escala_membros em
    JOIN public.escalas    e  ON e.id = em.escala_id
    JOIN public.ministerios mn ON mn.id = em.ministerio_id
    WHERE em.membro_id = v_rec.membro_id
      AND em.ativo     = true
      AND e.status     = 'publicada'
      AND e.data       >= CURRENT_DATE;

    -- Monta prévia do contexto
    v_ctx := jsonb_build_object(
      'nome_membro',   v_rec.primeiro_nome,
      'paroquia_nome', v_paroquia_nome,
      'escalas',       COALESCE(v_escalas, '[]'::jsonb),
      'operacao_id',   v_operacao_id::text
    );

    v_mensagens := v_mensagens || jsonb_build_object(
      'membro_id',      v_rec.membro_id,
      'nome_completo',  v_rec.nome_completo,
      'escalas_count',  v_rec.total_escalas,
      'context',        v_ctx
    );
  END LOOP;

  v_total_membros := v_elegiveis + v_sem_consentimento;

  RETURN jsonb_build_object(
    'operacao_id',         v_operacao_id,
    'paroquia_id',         p_paroquia_id,
    'paroquia_nome',       v_paroquia_nome,
    'total_membros',       v_total_membros,
    'elegiveis',           v_elegiveis,
    'sem_consentimento_ou_telefone', v_sem_consentimento,
    'total_mensagens',     v_elegiveis,
    'mensagens',           v_mensagens
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wa_preview_escalas_consolidadas(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wa_preview_escalas_consolidadas(uuid, uuid) TO authenticated;


-- ── Disparo ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wa_disparar_escalas_consolidadas(
  p_paroquia_id  uuid,
  p_operacao_id  uuid
)
RETURNS TABLE(
  enfileiradas int,
  duplicadas   int,
  ignoradas    int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_paroquia_nome text;
  v_enfileiradas  int := 0;
  v_duplicadas    int := 0;
  v_ignoradas     int := 0;
  v_rec           record;
  v_escalas       jsonb;
  v_payload       jsonb;
  v_evento_id     uuid;
  v_inserido      boolean;
  v_caller_id     uuid;
  v_tem_acesso    boolean := false;
BEGIN
  -- ── Autorização: auth.uid() com papel admin/coordenador na paróquia ──────────
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'acesso_negado: sessão sem autenticação' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id
      AND ur.role IN ('admin_paroquial', 'coordenador', 'super_admin')
      AND (ur.paroquia_id = p_paroquia_id OR ur.role = 'super_admin')
  ) INTO v_tem_acesso;

  IF NOT v_tem_acesso THEN
    RAISE EXCEPTION 'acesso_negado: papel insuficiente ou paróquia incorreta' USING ERRCODE = '42501';
  END IF;

  IF p_operacao_id IS NULL THEN
    RAISE EXCEPTION 'operacao_id_obrigatoria' USING ERRCODE = '22023';
  END IF;

  SELECT nome INTO v_paroquia_nome
  FROM public.paroquias
  WHERE id = p_paroquia_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'paroquia_nao_encontrada: %', p_paroquia_id USING ERRCODE = 'P0001';
  END IF;

  FOR v_rec IN
    SELECT
      m.id      AS membro_id,
      SPLIT_PART(m.nome_completo, ' ', 1) AS primeiro_nome,
      m.paroquia_id,
      COUNT(DISTINCT e.id) AS total_escalas
    FROM public.membros m
    JOIN public.escala_membros em ON em.membro_id = m.id AND em.ativo = true
    JOIN public.escalas         e  ON e.id = em.escala_id
    WHERE m.paroquia_id      = p_paroquia_id
      AND m.whatsapp_opt_in  = true
      AND m.whatsapp_telefone IS NOT NULL
      AND e.status           = 'publicada'
      AND e.data             >= CURRENT_DATE
    GROUP BY m.id, m.nome_completo, m.paroquia_id
  LOOP
    -- Buscar escalas do membro
    SELECT jsonb_agg(
      jsonb_build_object(
        'data_escala', to_char(e.data, 'DD/MM/YYYY'),
        'hora_escala', to_char(e.hora_inicio, 'HH24:MI'),
        'celebracao',  e.titulo,
        'ministerio',  mn.nome,
        'local',       e.local
      ) ORDER BY e.data, e.hora_inicio
    )
    INTO v_escalas
    FROM public.escala_membros em
    JOIN public.escalas    e  ON e.id = em.escala_id
    JOIN public.ministerios mn ON mn.id = em.ministerio_id
    WHERE em.membro_id = v_rec.membro_id
      AND em.ativo     = true
      AND e.status     = 'publicada'
      AND e.data       >= CURRENT_DATE;

    IF v_escalas IS NULL OR jsonb_array_length(v_escalas) = 0 THEN
      v_ignoradas := v_ignoradas + 1;
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'context', jsonb_build_object(
        'nome_membro',   v_rec.primeiro_nome,
        'paroquia_nome', v_paroquia_nome,
        'escalas',       v_escalas,
        'operacao_id',   p_operacao_id::text
      )
    );

    -- evento_id: (membro, 'escalas_consolidadas', operacao_id) — dedup por operação
    v_evento_id := public._outbox_evento_id(
      v_rec.membro_id,
      'escalas_consolidadas',
      p_operacao_id
    );

    v_inserido := public._outbox_insert_safe(
      p_evento_id     := v_evento_id,
      p_evento_ref_id := p_operacao_id,
      p_evento_tipo   := 'escalas_consolidadas',
      p_membro_id     := v_rec.membro_id,
      p_paroquia_id   := v_rec.paroquia_id,
      p_payload       := v_payload
    );

    IF v_inserido THEN
      v_enfileiradas := v_enfileiradas + 1;
    ELSE
      v_duplicadas := v_duplicadas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_enfileiradas, v_duplicadas, v_ignoradas;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_disparar_escalas_consolidadas(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wa_disparar_escalas_consolidadas(uuid, uuid) TO authenticated;
