-- Migration 147 — Correção abrangente do sistema de escalas
--
-- A. Adiciona guarda de data futura no trigger _trigger_pontuar_participacao
-- B. Remove historico_participacoes indevidos de missas futuras + recalcula scores
-- C. Adiciona aberta_para_membros em substituicoes
-- D. Cria RPC coord_liberar_vaga_substituicao
-- E. Corrige portal_recusar_escala para solenidades:
--    - NÃO notifica membros imediatamente em solenidades
--    - Chama notificar-whatsapp + notificar-substituicao (recusa_coord) para coordenação
--    - Mantém comportamento original para missas comuns

-- ══════════════════════════════════════════════════════════════
-- A. Guarda de data futura no trigger de pontuação
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_pontuar_participacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id  UUID;
  v_escala_data  DATE;
  v_solene       BOOLEAN;
  v_tem_bispo    BOOLEAN;
  v_config       public.paroquia_config_escalas%ROWTYPE;
  v_pontos       INTEGER;
  v_tipo_evento  TEXT;
  -- Somente statuses registrados pelo secretário/coordenação
  -- 'confirmado' (auto-confirmação do membro) NÃO gera pontos
  v_status_final CONSTANT TEXT[] := ARRAY[
    'presente','faltou','ausente','atrasado','justificou'
  ];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(v_status_final)) THEN RETURN NEW; END IF;

  SELECT e.paroquia_id, e.data, e.solene, e.tem_bispo
  INTO   v_paroquia_id, v_escala_data, v_solene, v_tem_bispo
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  IF v_paroquia_id IS NULL THEN RETURN NEW; END IF;

  -- GUARDA CRÍTICA: missas futuras NUNCA geram pontos
  IF v_escala_data > CURRENT_DATE THEN RETURN NEW; END IF;

  SELECT * INTO v_config
  FROM   public.paroquia_config_escalas
  WHERE  paroquia_id = v_paroquia_id;

  IF NOT FOUND OR NOT v_config.auto_pontuar THEN RETURN NEW; END IF;

  v_pontos := public._get_pontos_status(v_paroquia_id, NEW.status, v_solene, v_tem_bispo);

  v_tipo_evento := CASE
    WHEN v_tem_bispo THEN 'bispo'
    WHEN v_solene    THEN 'solene'
    ELSE                  'escala'
  END;

  INSERT INTO public.historico_participacoes
    (paroquia_id, membro_id, escala_id, ministerio_id,
     tipo_evento, origem, presenca, data, pontos)
  VALUES
    (v_paroquia_id, NEW.membro_id, NEW.escala_id, NEW.ministerio_id,
     v_tipo_evento, 'escala', NEW.status, v_escala_data, v_pontos)
  ON CONFLICT (membro_id, escala_id, ministerio_id)
    WHERE tipo_evento IN ('escala', 'solene', 'bispo')
      AND escala_id    IS NOT NULL
      AND ministerio_id IS NOT NULL
  DO UPDATE
    SET presenca    = EXCLUDED.presenca,
        tipo_evento = EXCLUDED.tipo_evento,
        pontos      = EXCLUDED.pontos;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_membro_status_final ON public.escala_membros;

CREATE TRIGGER on_escala_membro_status_final
  AFTER UPDATE OF status
  ON    public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_pontuar_participacao();

-- ══════════════════════════════════════════════════════════════
-- B. Remove pontos indevidos de missas futuras + recalcula scores
-- ══════════════════════════════════════════════════════════════

-- B1. Diagnóstico antes (log para auditoria)
DO $$
DECLARE
  v_count INTEGER;
  v_pts   INTEGER;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(hp.pontos), 0)
  INTO   v_count, v_pts
  FROM   public.historico_participacoes hp
  JOIN   public.escalas e ON e.id = hp.escala_id
  WHERE  e.data > CURRENT_DATE
    AND  hp.pontos <> 0;

  RAISE NOTICE '[147-B] Pontos indevidos de missas futuras: % registros, % pontos', v_count, v_pts;
END;
$$;

-- B2. Remove historico indevido de missas futuras
DELETE FROM public.historico_participacoes hp
WHERE  hp.escala_id IS NOT NULL
  AND  EXISTS (
    SELECT 1 FROM public.escalas e
    WHERE  e.id   = hp.escala_id
      AND  e.data > CURRENT_DATE
  );

-- B3. Remove historico de presencas pendentes (status que não deveria pontuar)
DELETE FROM public.historico_participacoes hp
WHERE  hp.presenca = 'pendente';

-- B4. Recalcula todos os scores
UPDATE public.membros m
SET    score = (
  SELECT COALESCE(SUM(hp.pontos), 0)
  FROM   public.historico_participacoes hp
  WHERE  hp.membro_id = m.id
)
WHERE  m.ativo = true;

-- B5. Zera score de membros inativos (não devem ter score sujo)
UPDATE public.membros
SET    score = 0
WHERE  ativo = false AND score <> 0;

-- ══════════════════════════════════════════════════════════════
-- C. aberta_para_membros em substituicoes
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.substituicoes
  ADD COLUMN IF NOT EXISTS aberta_para_membros BOOLEAN NOT NULL DEFAULT false;

-- Retroativamente: substituições existentes de escalas NÃO solenes = abertas
-- (mantém comportamento anterior para missas comuns)
UPDATE public.substituicoes s
SET    aberta_para_membros = true
FROM   public.escala_membros em
JOIN   public.escalas e ON e.id = em.escala_id
WHERE  em.id = s.escala_membro_id
  AND  (e.solene = false OR e.solene IS NULL)
  AND  s.status NOT IN ('cancelada', 'rejeitada');

-- ══════════════════════════════════════════════════════════════
-- D. RPC coord_liberar_vaga_substituicao
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.coord_liberar_vaga_substituicao(
  p_substituicao_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paroquia_id UUID;
  v_escala_id   UUID;
  v_escala_data DATE;
  v_min_id      UUID;
  v_escala_titulo TEXT;
  v_membro_id   UUID;
  v_min_nome    TEXT;
  v_elegivel    RECORD;
  v_token       UUID;
BEGIN
  -- Verifica permissão de coordenação
  SELECT s.paroquia_id, em.escala_id, e.data, em.ministerio_id, e.titulo
  INTO   v_paroquia_id, v_escala_id, v_escala_data, v_min_id, v_escala_titulo
  FROM   public.substituicoes s
  JOIN   public.escala_membros em ON em.id = s.escala_membro_id
  JOIN   public.escalas e ON e.id = em.escala_id
  WHERE  s.id = p_substituicao_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'nao_encontrada');
  END IF;

  IF NOT public._portal_is_admin(v_paroquia_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  -- Marca como aberta para membros
  UPDATE public.substituicoes
  SET    aberta_para_membros = true
  WHERE  id = p_substituicao_id
    AND  status NOT IN ('cancelada', 'rejeitada', 'aprovada');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_min_id;

  -- Cria notificações in-app para membros elegíveis
  FOR v_elegivel IN
    SELECT mm.membro_id
    FROM   public.membro_ministerios mm
    JOIN   public.membros m ON m.id = mm.membro_id
    WHERE  mm.ministerio_id = v_min_id
      AND  m.paroquia_id    = v_paroquia_id
      AND  m.ativo          = true
      AND  NOT EXISTS (
        SELECT 1 FROM public.escala_membros em2
        WHERE  em2.escala_id     = v_escala_id
          AND  em2.membro_id     = mm.membro_id
          AND  em2.ministerio_id = v_min_id
          AND  em2.status NOT IN ('recusado', 'faltou')
      )
      AND  NOT EXISTS (
        SELECT 1 FROM public.escala_membros em3
        JOIN   public.escalas e2 ON e2.id = em3.escala_id
        WHERE  em3.membro_id  = mm.membro_id
          AND  e2.data        = v_escala_data
          AND  e2.paroquia_id = v_paroquia_id
          AND  em3.status IN ('pendente', 'confirmado', 'presente')
      )
      AND  NOT EXISTS (
        SELECT 1 FROM public.indisponibilidades i
        WHERE  i.membro_id = mm.membro_id
          AND  i.data      = v_escala_data
          AND  i.cancelada = false
      )
  LOOP
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      v_paroquia_id,
      'Vaga disponível: ' || COALESCE(v_min_nome, 'Ministério'),
      format('Uma vaga em %s ficou disponível na escala "%s". Candidate-se no portal!',
        COALESCE(v_min_nome, 'Ministério'), v_escala_titulo),
      'aviso', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Dispara e-mail broadcast via notificar-substituicao
  INSERT INTO public.notificacao_tokens (substituicao_id)
  VALUES (p_substituicao_id)
  RETURNING token INTO v_token;

  BEGIN
    PERFORM net.http_post(
      url     := public._edge_fn_url('notificar-substituicao'),
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'Authorization',    'Bearer ' || public._cfg_anon_key(),
        'X-One-Time-Token', v_token::TEXT
      ),
      body := jsonb_build_object('substituicao_id', p_substituicao_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_liberar_vaga_substituicao(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- E. Corrige portal_recusar_escala para solenidades
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_recusar_escala(
  p_escala_membro_id UUID,
  p_motivo           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_membro_id     UUID;
  v_paroquia_id   UUID;
  v_escala_id     UUID;
  v_escala_data   DATE;
  v_subst_id      UUID;
  v_escala_titulo TEXT;
  v_membro_nome   TEXT;
  v_ministerio_id UUID;
  v_min_nome      TEXT;
  v_solene        BOOLEAN;
  v_elegivel      RECORD;
  v_token         UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'motivo_obrigatorio');
  END IF;

  SELECT m.id, m.nome INTO v_membro_id, v_membro_nome
  FROM public.membros m
  WHERE (m.auth_user_id = auth.uid()
         OR lower(trim(coalesce(m.email,''))) = lower(trim(coalesce(auth.email(),''))))
    AND m.ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_nao_encontrado');
  END IF;

  SELECT em.escala_id, e.paroquia_id, e.data, e.titulo, em.ministerio_id, COALESCE(e.solene, false)
    INTO v_escala_id, v_paroquia_id, v_escala_data, v_escala_titulo, v_ministerio_id, v_solene
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_permissao');
  END IF;

  IF v_escala_data < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'escala_passada');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.escala_membros
    WHERE id = p_escala_membro_id AND status IN ('pendente', 'confirmado')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_invalido');
  END IF;

  UPDATE public.escala_membros
  SET status = 'recusado', justificativa = trim(p_motivo)
  WHERE id = p_escala_membro_id;

  -- Abre substituição (se ainda não existe)
  IF NOT EXISTS (
    SELECT 1 FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
  ) THEN
    INSERT INTO public.substituicoes
      (paroquia_id, escala_id, escala_membro_id, solicitante_id, motivo_solicitacao, status, aberta_para_membros)
    VALUES
      (v_paroquia_id, v_escala_id, p_escala_membro_id, v_membro_id,
       COALESCE(NULLIF(trim(p_motivo), ''), 'Membro recusou a escala'),
       'solicitada',
       -- Solenidades: vaga NÃO é aberta automaticamente para membros
       NOT v_solene)
    RETURNING id INTO v_subst_id;
  ELSE
    SELECT id INTO v_subst_id
    FROM public.substituicoes
    WHERE escala_membro_id = p_escala_membro_id
      AND status NOT IN ('cancelada', 'rejeitada')
    LIMIT 1;
  END IF;

  -- Notificação in-app para coordenação (sempre)
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES (
    v_paroquia_id,
    CASE WHEN v_solene
      THEN 'Recusa em solenidade — substituição aguardando coordenação'
      ELSE 'Recusa de escala — substituição aberta'
    END,
    format('%s recusou a escala "%s". Motivo: %s.%s',
      v_membro_nome, v_escala_titulo, trim(p_motivo),
      CASE WHEN v_solene
        THEN ' Esta é uma solenidade — a vaga aguarda liberação pela coordenação.'
        ELSE ' Uma vaga foi aberta para substituição.'
      END),
    'alerta', false, true, '/substituicoes'
  );

  SELECT nome INTO v_min_nome FROM public.ministerios WHERE id = v_ministerio_id;

  -- Para missas COMUNS: notifica membros elegíveis imediatamente (comportamento original)
  -- Para SOLENIDADES: coordenação decide quando liberar
  IF NOT v_solene AND v_subst_id IS NOT NULL AND v_ministerio_id IS NOT NULL THEN
    FOR v_elegivel IN
      SELECT mm.membro_id
      FROM public.membro_ministerios mm
      JOIN public.membros m ON m.id = mm.membro_id
      WHERE mm.ministerio_id = v_ministerio_id
        AND m.paroquia_id    = v_paroquia_id
        AND m.ativo          = true
        AND mm.membro_id    <> v_membro_id
        AND NOT EXISTS (
          SELECT 1 FROM public.escala_membros em2
          WHERE em2.escala_id     = v_escala_id
            AND em2.membro_id     = mm.membro_id
            AND em2.ministerio_id = v_ministerio_id
            AND em2.status NOT IN ('recusado', 'faltou')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.escala_membros em3
          JOIN public.escalas e2 ON e2.id = em3.escala_id
          WHERE em3.membro_id  = mm.membro_id
            AND e2.data        = v_escala_data
            AND e2.paroquia_id = v_paroquia_id
            AND em3.status IN ('pendente', 'confirmado', 'presente')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.indisponibilidades i
          WHERE i.membro_id = mm.membro_id
            AND i.data      = v_escala_data
            AND i.cancelada = false
        )
    LOOP
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
      VALUES (
        v_paroquia_id,
        'Vaga disponível: ' || coalesce(v_min_nome, 'Ministério'),
        format('Uma vaga em %s ficou disponível na escala "%s". Candidate-se no portal!',
          coalesce(v_min_nome, 'Ministério'), v_escala_titulo),
        'aviso', false, false, v_elegivel.membro_id, '/portal-membro/substituicoes'
      );
    END LOOP;

    INSERT INTO public.notificacao_tokens (substituicao_id)
    VALUES (v_subst_id)
    RETURNING token INTO v_token;

    BEGIN
      PERFORM net.http_post(
        url     := public._edge_fn_url('notificar-substituicao'),
        headers := jsonb_build_object(
          'Content-Type',     'application/json',
          'Authorization',    'Bearer ' || public._cfg_anon_key(),
          'X-One-Time-Token', v_token::TEXT
        ),
        body := jsonb_build_object('substituicao_id', v_subst_id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Nota: para solenidades, o frontend (portal-membro/escalas.tsx) é responsável por
  -- chamar notificar-substituicao (recusa_coord) e notificar-whatsapp após a RPC retornar
  -- { success: true, solene: true, substituicao_id: <id> }.

  RETURN jsonb_build_object('success', true, 'substituicao_id', v_subst_id, 'solene', v_solene);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_recusar_escala(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- G. Adiciona aberta_para_membros + solene ao coord_get_substituicoes
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.coord_get_substituicoes(TEXT);

CREATE OR REPLACE FUNCTION public.coord_get_substituicoes(
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                  UUID,
  status              TEXT,
  motivo_solicitacao  TEXT,
  motivo_rejeicao     TEXT,
  aprovado_em         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  escala_id           UUID,
  escala_titulo       TEXT,
  escala_data         DATE,
  ministerio_id       UUID,
  ministerio_nome     TEXT,
  ministerio_cor      TEXT,
  solicitante_nome    TEXT,
  substituto_nome     TEXT,
  aprovador_nome      TEXT,
  aberta_para_membros BOOLEAN,
  solene              BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_paroquia_id UUID;
  v_is_allowed  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT ur.paroquia_id INTO v_paroquia_id
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.role IN ('super_admin', 'admin_paroquial', 'lider', 'coordenador')
  LIMIT 1;

  IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT m.paroquia_id INTO v_paroquia_id
    FROM public.membros m
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'coordenador', 'administrador')
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  IF v_paroquia_id IS NULL THEN
    SELECT c.paroquia_id INTO v_paroquia_id
    FROM public.coordenadores c
    JOIN public.membros m ON m.id = c.membro_id
    WHERE (m.auth_user_id = v_uid
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND c.ativo = true
    LIMIT 1;

    IF v_paroquia_id IS NOT NULL THEN v_is_allowed := true; END IF;
  END IF;

  IF NOT v_is_allowed OR v_paroquia_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id, s.status, s.motivo_solicitacao, s.motivo_rejeicao,
    s.aprovado_em, s.created_at,
    em.escala_id,
    e.titulo   AS escala_titulo,
    e.data     AS escala_data,
    em.ministerio_id,
    min.nome   AS ministerio_nome,
    min.cor    AS ministerio_cor,
    ms.nome    AS solicitante_nome,
    mv.nome    AS substituto_nome,
    ma.nome    AS aprovador_nome,
    COALESCE(s.aberta_para_membros, false) AS aberta_para_membros,
    COALESCE(e.solene, false) AS solene
  FROM public.substituicoes s
  JOIN public.escala_membros em   ON em.id  = s.escala_membro_id
  JOIN public.escalas         e   ON e.id   = em.escala_id
  JOIN public.ministerios     min ON min.id = em.ministerio_id
  JOIN public.membros         ms  ON ms.id  = s.solicitante_id
  LEFT JOIN public.membros    mv  ON mv.id  = s.substituto_id
  LEFT JOIN public.membros    ma  ON ma.id  = s.aprovado_por
  WHERE s.paroquia_id = v_paroquia_id
    AND (p_status IS NULL OR s.status = p_status)
    AND NOT (
      s.status IN ('solicitada', 'com_voluntario')
      AND e.data < CURRENT_DATE
    )
  ORDER BY
    CASE s.status
      WHEN 'com_voluntario' THEN 1
      WHEN 'solicitada'     THEN 2
      WHEN 'aprovada'       THEN 3
      WHEN 'rejeitada'      THEN 4
      WHEN 'cancelada'      THEN 5
    END,
    e.data ASC,
    s.created_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coord_get_substituicoes(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
