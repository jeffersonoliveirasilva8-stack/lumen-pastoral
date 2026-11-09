-- ============================================================
-- Migration 186 — Triggers WhatsApp v2: net.http_post → Outbox
--
-- Substitui as funções trigger das migrations 171, 172 e 177 por
-- versões que fazem INSERT em whatsapp_outbox ao invés de chamadas
-- diretas via net.http_post.
--
-- Triggers afetados:
--   trg_whatsapp_escala_publicada   (escalas    — migration 171)
--   trg_whatsapp_substituicoes      (substituicoes — migration 172)
--   trg_whatsapp_inclusao_posterior (escala_membros — migration 177)
--
-- Decisões fixadas (D1/D2 preservadas):
--   D1: eventId sem membro_id (comportamento atual mantido)
--   D2: republicação não re-notifica (dedup por evento_id bloqueia)
--
-- Guards preservados integralmente das versões anteriores.
-- Nenhuma trigger é dropada/recriada — apenas CREATE OR REPLACE
-- nas funções; os triggers existentes reutilizam as novas funções.
--
-- Dedup no outbox:
--   whatsapp_outbox.evento_id = UNIQUE — protege contra duplo INSERT
--   no mesmo evento por diferentes caminhos (ex: rollback + retry).
--
--   evento_id calculado deterministicamente:
--     escala_publicada / inclusao_posterior / funcao_alterada:
--       md5(membro_id || evento_tipo || evento_ref_id)::uuid
--     substituicoes (3 eventos, 2 membros distintos):
--       md5(membro_id || evento_tipo || substituicao.id)::uuid
--
-- search_path = '' em todas as funções.
-- ============================================================


-- ── Helper: _outbox_evento_id ─────────────────────────────────────────────────
-- UUID determinístico para dedup de outbox.
-- Inclui membro_id para garantir unicidade por destinatário.

CREATE OR REPLACE FUNCTION public._outbox_evento_id(
  p_membro_id    uuid,
  p_evento_tipo  text,
  p_evento_ref_id uuid
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    substring(md5(p_membro_id::text || p_evento_tipo || p_evento_ref_id::text) FROM  1 FOR 8) || '-' ||
    substring(md5(p_membro_id::text || p_evento_tipo || p_evento_ref_id::text) FROM  9 FOR 4) || '-' ||
    substring(md5(p_membro_id::text || p_evento_tipo || p_evento_ref_id::text) FROM 13 FOR 4) || '-' ||
    substring(md5(p_membro_id::text || p_evento_tipo || p_evento_ref_id::text) FROM 17 FOR 4) || '-' ||
    substring(md5(p_membro_id::text || p_evento_tipo || p_evento_ref_id::text) FROM 21 FOR 12)
  )::uuid
$$;

REVOKE ALL ON FUNCTION public._outbox_evento_id(uuid, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._outbox_evento_id(uuid, text, uuid) TO service_role;


-- ── Helper: _outbox_insert_safe ───────────────────────────────────────────────
-- INSERT com ON CONFLICT DO NOTHING — idempotente por evento_id.
-- Retorna true se inseriu, false se era duplicata.

CREATE OR REPLACE FUNCTION public._outbox_insert_safe(
  p_evento_id    uuid,
  p_evento_ref_id uuid,
  p_evento_tipo  text,
  p_membro_id    uuid,
  p_paroquia_id  uuid,
  p_payload      jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  INSERT INTO public.whatsapp_outbox (
    evento_id,
    evento_ref_id,
    evento_tipo,
    membro_id,
    paroquia_id,
    payload,
    status,
    next_attempt_at
  ) VALUES (
    p_evento_id,
    p_evento_ref_id,
    p_evento_tipo,
    p_membro_id,
    p_paroquia_id,
    p_payload,
    'pending',
    now()
  )
  ON CONFLICT (evento_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public._outbox_insert_safe(uuid, uuid, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._outbox_insert_safe(uuid, uuid, text, uuid, uuid, jsonb) TO service_role;


-- ── 1. _trigger_whatsapp_escala_publicada (migration 171) ────────────────────
-- Substitui net.http_post por INSERT em whatsapp_outbox.
-- Guards preservados: transição → publicada, whatsapp_opt_in, conta_ativada.

CREATE OR REPLACE FUNCTION public._trigger_whatsapp_escala_publicada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec           record;
  v_paroquia_nm text;
  v_data_fmt    text;
BEGIN
  -- Guard: só na transição para 'publicada'
  IF NEW.status <> 'publicada' OR OLD.status = 'publicada' THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO v_paroquia_nm
  FROM   public.paroquias WHERE id = NEW.paroquia_id;

  v_data_fmt := to_char(NEW.data::date, 'DD/MM/YYYY');

  FOR rec IN
    SELECT
      em.membro_id,
      COALESCE(min.nome, 'Servidor') AS ministerio_nome,
      m.nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    JOIN     public.membros       m  ON m.id  = em.membro_id
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
      AND  m.ativo           = true
      AND  m.conta_ativada   = true
      AND  m.whatsapp_opt_in = true
      AND  m.whatsapp_telefone IS NOT NULL
  LOOP
    BEGIN
      PERFORM public._outbox_insert_safe(
        public._outbox_evento_id(rec.membro_id, 'escala_publicada', NEW.id),
        NEW.id,
        'escala_publicada',
        rec.membro_id,
        NEW.paroquia_id,
        jsonb_build_object(
          'nome_membro',   rec.nome,
          'data_escala',   v_data_fmt,
          'ministerio',    rec.ministerio_nome,
          'paroquia_nome', COALESCE(v_paroquia_nm, '')
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_trigger_whatsapp_escala_publicada: outbox INSERT falhou membro %: %',
        rec.membro_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;


-- ── 2. _trigger_whatsapp_substituicoes (migration 172) ───────────────────────
-- Substitui net.http_post por INSERT em whatsapp_outbox.
-- Guards preservados: mudança de status, whatsapp_opt_in, conta_ativada.
-- evento_ref_id = substituicao.id (UUID válido); tipo discrimina solicitante/substituto.

CREATE OR REPLACE FUNCTION public._trigger_whatsapp_substituicoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escala_data     date;
  v_ministerio_nome text;
  v_paroquia_nm     text;
  v_data_fmt        text;

  v_sol_nome        text;
  v_sol_paroquia_id uuid;
  v_sol_opt_in      boolean;

  v_sub_nome        text;
  v_sub_paroquia_id uuid;
  v_sub_opt_in      boolean;
BEGIN
  -- Guard: só em mudanças de status relevantes
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('aprovada', 'rejeitada') THEN RETURN NEW; END IF;

  -- Dados comuns da escala/ministério/paróquia
  SELECT e.data, min.nome, p.nome
  INTO   v_escala_data, v_ministerio_nome, v_paroquia_nm
  FROM   public.escala_membros em
  JOIN   public.escalas     e   ON e.id   = em.escala_id
  JOIN   public.ministerios min ON min.id = em.ministerio_id
  JOIN   public.paroquias   p   ON p.id   = e.paroquia_id
  WHERE  em.id = NEW.escala_membro_id;

  v_data_fmt := to_char(v_escala_data, 'DD/MM/YYYY');

  -- Dados do solicitante
  SELECT m.nome,
         m.paroquia_id,
         (m.whatsapp_opt_in = true
          AND m.whatsapp_telefone IS NOT NULL
          AND m.ativo = true
          AND m.conta_ativada = true)
  INTO   v_sol_nome, v_sol_paroquia_id, v_sol_opt_in
  FROM   public.membros m WHERE m.id = NEW.solicitante_id;

  -- ── aprovada ──────────────────────────────────────────────────────────────
  IF NEW.status = 'aprovada' THEN

    -- Solicitante: substituicao_aprovada
    IF v_sol_opt_in THEN
      BEGIN
        PERFORM public._outbox_insert_safe(
          public._outbox_evento_id(NEW.solicitante_id, 'substituicao_aprovada', NEW.id),
          NEW.id,
          'substituicao_aprovada',
          NEW.solicitante_id,
          COALESCE(v_sol_paroquia_id, NEW.paroquia_id),
          jsonb_build_object(
            'nome_membro',   COALESCE(v_sol_nome, '—'),
            'data_escala',   v_data_fmt,
            'ministerio',    COALESCE(v_ministerio_nome, '—'),
            'paroquia_nome', COALESCE(v_paroquia_nm, '')
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_whatsapp_substituicoes: outbox falhou solicitante %: %',
          NEW.solicitante_id, SQLERRM;
      END;
    END IF;

    -- Substituto: substituicao_confirmada_substituto
    IF NEW.substituto_id IS NOT NULL THEN
      SELECT m.nome,
             m.paroquia_id,
             (m.whatsapp_opt_in = true
              AND m.whatsapp_telefone IS NOT NULL
              AND m.ativo = true
              AND m.conta_ativada = true)
      INTO   v_sub_nome, v_sub_paroquia_id, v_sub_opt_in
      FROM   public.membros m WHERE m.id = NEW.substituto_id;

      IF v_sub_opt_in THEN
        BEGIN
          PERFORM public._outbox_insert_safe(
            public._outbox_evento_id(NEW.substituto_id, 'substituicao_confirmada_substituto', NEW.id),
            NEW.id,
            'substituicao_confirmada_substituto',
            NEW.substituto_id,
            COALESCE(v_sub_paroquia_id, NEW.paroquia_id),
            jsonb_build_object(
              'nome_membro',      COALESCE(v_sub_nome, '—'),
              'data_escala',      v_data_fmt,
              'ministerio',       COALESCE(v_ministerio_nome, '—'),
              'paroquia_nome',    COALESCE(v_paroquia_nm, ''),
              'nome_solicitante', v_sol_nome
            )
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '_trigger_whatsapp_substituicoes: outbox falhou substituto %: %',
            NEW.substituto_id, SQLERRM;
        END;
      END IF;
    END IF;

  -- ── rejeitada ─────────────────────────────────────────────────────────────
  ELSIF NEW.status = 'rejeitada' THEN

    IF v_sol_opt_in THEN
      BEGIN
        PERFORM public._outbox_insert_safe(
          public._outbox_evento_id(NEW.solicitante_id, 'substituicao_recusada', NEW.id),
          NEW.id,
          'substituicao_recusada',
          NEW.solicitante_id,
          COALESCE(v_sol_paroquia_id, NEW.paroquia_id),
          jsonb_build_object(
            'nome_membro', COALESCE(v_sol_nome, '—'),
            'data_escala', v_data_fmt,
            'ministerio',  COALESCE(v_ministerio_nome, '—'),
            'motivo',      NEW.motivo_rejeicao
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '_trigger_whatsapp_substituicoes: outbox falhou rejeição solicitante %: %',
          NEW.solicitante_id, SQLERRM;
      END;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;


-- ── 3. _trg_fn_whatsapp_inclusao_posterior (migration 177) ───────────────────
-- Substitui net.http_post por INSERT em whatsapp_outbox.
-- Guards e lógica de evento_ref_id preservados da migration 177.

CREATE OR REPLACE FUNCTION public._trg_fn_whatsapp_inclusao_posterior()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escala        record;
  v_membro        record;
  v_min_nome      text;
  v_paroquia_nm   text;
  v_evento_tipo   text;
  v_evento_ref_id uuid;
  v_reativacao    boolean;
  v_min_changed   boolean;
  v_hash          text;
BEGIN
  -- ── Guard 1: INSERT com ativo=false ───────────────────────────────────────
  IF TG_OP = 'INSERT' AND NEW.ativo IS FALSE THEN
    RETURN NEW;
  END IF;

  -- ── Guard 2: UPDATE sem evento relevante ──────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    v_reativacao  := (OLD.ativo IS FALSE AND NEW.ativo IS NOT FALSE);
    v_min_changed := (OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id);
    IF NOT v_reativacao AND NOT v_min_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ── Determina tipo e ref_id (lógica idêntica à migration 177) ────────────
  IF TG_OP = 'INSERT' THEN
    v_evento_tipo   := 'escala_publicada';
    v_evento_ref_id := NEW.id;

  ELSIF TG_OP = 'UPDATE' AND v_reativacao IS TRUE THEN
    v_hash := md5(NEW.id::text || 'reativacao' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD'));
    v_evento_ref_id := (
      substring(v_hash FROM  1 FOR 8) || '-' ||
      substring(v_hash FROM  9 FOR 4) || '-' ||
      substring(v_hash FROM 13 FOR 4) || '-' ||
      substring(v_hash FROM 17 FOR 4) || '-' ||
      substring(v_hash FROM 21 FOR 12)
    )::uuid;
    v_evento_tipo := 'escala_publicada';

  ELSE
    v_hash := md5(NEW.id::text || OLD.ministerio_id::text || NEW.ministerio_id::text
                  || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD'));
    v_evento_ref_id := (
      substring(v_hash FROM  1 FOR 8) || '-' ||
      substring(v_hash FROM  9 FOR 4) || '-' ||
      substring(v_hash FROM 13 FOR 4) || '-' ||
      substring(v_hash FROM 17 FOR 4) || '-' ||
      substring(v_hash FROM 21 FOR 12)
    )::uuid;
    v_evento_tipo := 'escala_funcao_alterada';
  END IF;

  -- ── Guard 3: escala deve estar publicada ──────────────────────────────────
  SELECT id, paroquia_id, data, hora_inicio, local
    INTO v_escala
    FROM public.escalas
   WHERE id = NEW.escala_id AND status = 'publicada';

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- ── Guard 4: elegibilidade do membro ──────────────────────────────────────
  SELECT m.id, m.nome, m.whatsapp_opt_in, m.whatsapp_telefone
    INTO v_membro
    FROM public.membros m
   WHERE m.id            = NEW.membro_id
     AND m.ativo         = true
     AND m.conta_ativada = true;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_membro.whatsapp_opt_in IS NOT TRUE
     OR v_membro.whatsapp_telefone IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── Busca ministério e paróquia ───────────────────────────────────────────
  SELECT nome INTO v_min_nome    FROM public.ministerios WHERE id = NEW.ministerio_id;
  SELECT nome INTO v_paroquia_nm FROM public.paroquias   WHERE id = v_escala.paroquia_id;

  -- ── INSERT no outbox ──────────────────────────────────────────────────────
  BEGIN
    IF v_evento_tipo = 'escala_publicada' THEN
      PERFORM public._outbox_insert_safe(
        public._outbox_evento_id(NEW.membro_id, v_evento_tipo, v_evento_ref_id),
        v_evento_ref_id,
        v_evento_tipo,
        NEW.membro_id,
        v_escala.paroquia_id,
        jsonb_build_object(
          'nome_membro',   v_membro.nome,
          'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
          'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                                THEN left(v_escala.hora_inicio::text, 5) END,
          'ministerio',    COALESCE(v_min_nome, ''),
          'local',         v_escala.local,
          'paroquia_nome', COALESCE(v_paroquia_nm, ''),
          'link_escala',   'https://lumenpastoral.com.br/portal-membro/escalas'
        )
      );
    ELSE
      -- escala_funcao_alterada: inclui escala_id no payload para guard na EF
      PERFORM public._outbox_insert_safe(
        public._outbox_evento_id(NEW.membro_id, v_evento_tipo, v_evento_ref_id),
        v_evento_ref_id,
        v_evento_tipo,
        NEW.membro_id,
        v_escala.paroquia_id,
        jsonb_build_object(
          'nome_membro',   v_membro.nome,
          'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
          'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                                THEN left(v_escala.hora_inicio::text, 5) END,
          'ministerio',    COALESCE(v_min_nome, ''),
          'local',         v_escala.local,
          'paroquia_nome', COALESCE(v_paroquia_nm, ''),
          'link_escala',   'https://lumenpastoral.com.br/portal-membro/escalas',
          'escala_id',     v_escala.id::text
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_fn_whatsapp_inclusao_posterior: outbox INSERT falhou membro %: %',
      NEW.membro_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;


-- ── Reload schema cache ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
