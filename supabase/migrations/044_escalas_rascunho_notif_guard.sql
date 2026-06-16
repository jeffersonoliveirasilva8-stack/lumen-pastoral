-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 044 — Bloqueia notificações de escalas em RASCUNHO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Causa raiz: _notify_escala_membro() disparava no INSERT em escala_membros
-- sem verificar o status da escala. Quando "Gerar Semana" cria escalas em
-- RASCUNHO e já atribui membros, o trigger notificava todos os membros.
--
-- Correções:
--   1. _notify_escala_membro()           → só notifica se status = 'publicada'
--   2. _trigger_escala_publicada_membros → idempotência via publicada_at
--   3. publicada_at na tabela escalas    → controla se email/notif já foi enviado
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Coluna publicada_at — marca o momento da primeira publicação (idempotência)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS publicada_at timestamptz DEFAULT NULL;

-- Preenche retroativamente escalas já publicadas (sem sobrescrever se já tiver)
UPDATE public.escalas
SET publicada_at = COALESCE(publicada_at, updated_at, created_at)
WHERE status = 'publicada' AND publicada_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. _notify_escala_membro — verifica status ANTES de inserir notificação
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_escala_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_titulo   text;
  v_data     date;
  v_paroquia uuid;
  v_status   text;
BEGIN
  SELECT e.titulo, e.data, e.paroquia_id, e.status
  INTO   v_titulo, v_data, v_paroquia, v_status
  FROM   public.escalas e
  WHERE  e.id = NEW.escala_id;

  -- Só notifica se a escala estiver publicada
  IF v_paroquia IS NULL THEN RETURN NEW; END IF;
  IF v_status <> 'publicada' THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes
    (paroquia_id, destinatario_id, titulo, mensagem, tipo, link_referencia, apenas_admin)
  VALUES (
    v_paroquia,
    NEW.membro_id,
    'Você foi escalado(a): ' || COALESCE(v_titulo, 'nova escala'),
    'Data: ' || to_char(COALESCE(v_data, CURRENT_DATE), 'DD/MM/YYYY') ||
      '. Acesse o portal para confirmar sua participação.',
    'aviso',
    '/portal-membro/escalas',
    false
  );
  RETURN NEW;
END;
$$;

-- Recria o trigger (DROP + CREATE para garantir versão limpa)
DROP TRIGGER IF EXISTS notify_escala_membro ON public.escala_membros;
CREATE TRIGGER notify_escala_membro
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._notify_escala_membro();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. _trigger_escala_publicada_membros — idempotência + set publicada_at
--    Dispara quando status muda → 'publicada'.
--    Envia notificação a cada membro JÁ atribuído na escala.
--    publicada_at garante que reenvio manual seja possível apenas se zerado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rec record;
BEGIN
  -- Só dispara na transição rascunho/arquivada → publicada
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;
  IF OLD.status = 'publicada'  THEN RETURN NEW; END IF;

  -- Marca o momento da publicação (idempotência: email do frontend usa isso)
  UPDATE public.escalas
  SET publicada_at = NOW()
  WHERE id = NEW.id AND publicada_at IS NULL;

  -- Notifica cada membro já atribuído
  FOR rec IN
    SELECT em.membro_id, COALESCE(min.nome, 'servidor') AS ministerio_nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    WHERE  em.escala_id = NEW.id
  LOOP
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Sua escala foi publicada: ' || left(NEW.titulo, 60),
      format(
        'A escala "%s" em %s foi publicada. Você está como %s. Confirme sua participação.',
        NEW.titulo,
        to_char(NEW.data::date, 'DD/MM/YYYY'),
        rec.ministerio_nome
      ),
      'aviso',
      false,
      false,
      rec.membro_id,
      '/portal-membro/escalas'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_publicada_membros ON public.escalas;
CREATE TRIGGER on_escala_publicada_membros
  AFTER UPDATE ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public._trigger_escala_publicada_membros();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. _trigger_escala_alterada — já verifica status, só reforça segurança
-- ─────────────────────────────────────────────────────────────────────────────
-- Já correto desde migration 021: IF NEW.status <> 'publicada' THEN RETURN NEW.
-- Nenhuma alteração necessária.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: reenviar_notificacoes_escala — permite reenvio manual pelo coordenador
--    Zera publicada_at para que o frontend possa reenviar emails ao re-publicar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reenviar_notificacoes_escala(p_escala_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id uuid;
  v_status      text;
  v_is_coord    boolean;
BEGIN
  SELECT paroquia_id, status INTO v_paroquia_id, v_status
  FROM public.escalas WHERE id = p_escala_id;

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'escala_not_found');
  END IF;

  v_is_coord := public.is_coordenador_da_paroquia(v_paroquia_id);
  IF NOT v_is_coord THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_status <> 'publicada' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'escala_not_published');
  END IF;

  -- Zera publicada_at para que o frontend reenvie emails no próximo UPDATE
  UPDATE public.escalas SET publicada_at = NULL WHERE id = p_escala_id;

  -- Força atualização no status (mesmo valor) para o trigger disparar
  UPDATE public.escalas SET status = 'publicada' WHERE id = p_escala_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reenviar_notificacoes_escala(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Limpar notificações de rascunho que já foram enviadas indevidamente
--    (escalas que ainda estão em rascunho mas geraram notificações)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.notificacoes_leituras
WHERE notificacao_id IN (
  SELECT n.id
  FROM public.notificacoes n
  JOIN public.escalas e ON e.titulo = substring(n.titulo FROM 'Você foi escalado\(a\): (.*)')
    OR n.mensagem ILIKE '%Acesse o portal para confirmar%'
  WHERE e.status = 'rascunho'
    AND n.tipo = 'aviso'
    AND n.apenas_admin = false
);

DELETE FROM public.notificacoes n
WHERE n.titulo ILIKE 'Você foi escalado(a):%'
  AND n.tipo = 'aviso'
  AND n.apenas_admin = false
  AND EXISTS (
    SELECT 1 FROM public.escala_membros em
    JOIN public.escalas e ON e.id = em.escala_id
    WHERE em.membro_id = n.destinatario_id
      AND e.status = 'rascunho'
      AND n.created_at > e.created_at - interval '1 second'
  );
