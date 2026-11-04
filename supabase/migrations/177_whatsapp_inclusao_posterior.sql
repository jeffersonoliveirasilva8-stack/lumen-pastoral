-- ============================================================
-- Migration 177 — Inclusão posterior à publicação (WhatsApp)
--
-- Substitui os 3 triggers escala_completa (migrations 173/176)
-- por 1 trigger de escopo reduzido que cobre:
--
--   • INSERT ativo=true : novo membro adicionado a escala publicada
--   • UPDATE reativação : ativo false→true em escala publicada
--   • UPDATE ministerio_id: mudança de função → escala_funcao_alterada
--
-- Dedup (janela diária para retry safety):
--   escala_publicada INSERT  → evento_ref_id = escala_membros.id
--                              (único por row; retry na mesma transação bloqueado)
--   escala_publicada REATIV  → evento_ref_id = md5(em.id||'reativacao'||YYYYMMDD)::uuid
--                              (≠ INSERT; retry no mesmo dia bloqueado; novo dia = nova notif)
--   escala_funcao_alterada   → evento_ref_id = md5(em.id||old_min||new_min||YYYYMMDD)::uuid
--                              (único por direção+dia; A→B e B→A têm UUIDs distintos;
--                               A→B no mesmo dia bloqueado; A→B dias diferentes = nova notif)
--
-- search_path = '' (vazio) com referências totalmente qualificadas (public.*).
-- Guard da Edge Function: context.escala_id obrigatório em escala_funcao_alterada.
--
-- Preserva: _escala_esta_completa(), push, e-mail, substituições, lembretes.
-- ============================================================

-- ── 1. Drop triggers (antes das funções) ──────────────────────────────────────

DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_membros    ON public.escala_membros;
DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_publicacao ON public.escalas;
DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_funcoes    ON public.escala_funcoes;

-- ── 2. Drop funções ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public._trg_fn_whatsapp_escala_completa_membros();
DROP FUNCTION IF EXISTS public._trg_fn_whatsapp_escala_completa_publicacao();
DROP FUNCTION IF EXISTS public._trg_fn_whatsapp_escala_completa_funcoes();

-- ── 3. Nova função unificada ──────────────────────────────────────────────────
--
-- Cobre INSERT e UPDATE (ativo, ministerio_id).
-- SECURITY DEFINER SET search_path = public para evitar injeção de schema.

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
  v_wa_secret     text;
  v_url           text;
  v_payload       jsonb;
  v_evento_tipo   text;
  v_evento_ref_id uuid;
  v_reativacao    boolean;
  v_min_changed   boolean;
  v_hash          text;
BEGIN
  -- ── Guard 1: INSERT com ativo=false → membro inativo desde início, ignorar ──
  IF TG_OP = 'INSERT' AND NEW.ativo IS FALSE THEN
    RETURN NEW;
  END IF;

  -- ── Guard 2: UPDATE sem evento relevante ──────────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    v_reativacao  := (OLD.ativo IS FALSE AND NEW.ativo IS NOT FALSE);
    v_min_changed := (OLD.ministerio_id IS DISTINCT FROM NEW.ministerio_id);
    IF NOT v_reativacao AND NOT v_min_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ── Determina tipo e ref_id do evento ────────────────────────────────────────
  -- Reativação tem prioridade sobre mudança de ministerio_id simultânea.
  IF TG_OP = 'INSERT' THEN
    -- INSERT ativo=true: escala_publicada com evento_ref_id = escala_membros.id
    -- (único por linha; retries na mesma transação bloqueados pelo índice dedup)
    v_evento_tipo   := 'escala_publicada';
    v_evento_ref_id := NEW.id;

  ELSIF TG_OP = 'UPDATE' AND v_reativacao IS TRUE THEN
    -- Reativação: usa UUID derivado de md5 com componente de data
    -- → diferente do INSERT UUID (escala_membros.id) → dedup não bloqueia reativação legítima
    -- → estável no mesmo dia → retry no mesmo dia bloqueado
    -- → nova reativação num dia diferente gera UUID diferente → notificação permitida
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
    -- UPDATE ministerio_id sem reativação: escala_funcao_alterada
    -- UUID por direção + dia: A→B ≠ B→A; mesmo A→B em dias diferentes ≠ → notificações distintas
    -- → retry A→B no mesmo dia bloqueado; A→B dias depois permitido
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

  -- ── Guard 3: escala deve estar publicada ─────────────────────────────────────
  SELECT id, paroquia_id, data, hora_inicio, local
    INTO v_escala
    FROM public.escalas
   WHERE id = NEW.escala_id AND status = 'publicada';

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- ── Guard 4: elegibilidade do membro (consistente com trigger 171) ───────────
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

  -- ── Guard 5: segredo interno configurado ─────────────────────────────────────
  SELECT val INTO v_wa_secret
    FROM public._push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN RETURN NEW; END IF;

  -- ── Busca ministério e paróquia ──────────────────────────────────────────────
  SELECT nome INTO v_min_nome    FROM public.ministerios WHERE id = NEW.ministerio_id;
  SELECT nome INTO v_paroquia_nm FROM public.paroquias   WHERE id = v_escala.paroquia_id;

  v_url := public._cfg_supabase_url() || '/functions/v1/send-whatsapp';

  -- ── Monta payload ─────────────────────────────────────────────────────────────
  IF v_evento_tipo = 'escala_publicada' THEN
    v_payload := jsonb_build_object(
      'membro_id',     NEW.membro_id::text,
      'paroquia_id',   v_escala.paroquia_id::text,
      'evento_tipo',   v_evento_tipo,
      'evento_ref_id', v_evento_ref_id::text,
      'context', jsonb_build_object(
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
    -- escala_funcao_alterada: inclui escala_id para guard na Edge Function
    -- (evento_ref_id é UUID derivado de md5, não referencia nenhuma tabela)
    v_payload := jsonb_build_object(
      'membro_id',     NEW.membro_id::text,
      'paroquia_id',   v_escala.paroquia_id::text,
      'evento_tipo',   v_evento_tipo,
      'evento_ref_id', v_evento_ref_id::text,
      'context', jsonb_build_object(
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

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || public._cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_fn_whatsapp_inclusao_posterior: pg_net falhou membro %: %',
      NEW.membro_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._trg_fn_whatsapp_inclusao_posterior()
  IS 'Notifica membro via WhatsApp ao ser inserido (ativo=true) ou reativado em '
     'escala publicada (escala_publicada), e ao ter ministerio_id alterado '
     '(escala_funcao_alterada). Dedup por janela diária (UTC): INSERT usa em.id; '
     'reativação usa md5(em.id+reativacao+YYYYMMDD); mudança de função usa '
     'md5(em.id+old_min+new_min+YYYYMMDD). SET search_path = vazio; referências '
     'totalmente qualificadas. Substitui 3 triggers escala_completa (173/176). '
     'Migration 177.';

-- ── 4. Novo trigger ───────────────────────────────────────────────────────────

CREATE TRIGGER trg_whatsapp_inclusao_posterior
  AFTER INSERT OR UPDATE OF ativo, ministerio_id
  ON public.escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_fn_whatsapp_inclusao_posterior();
