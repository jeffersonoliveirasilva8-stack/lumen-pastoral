-- ============================================================
-- Migration 021: Corrige link_referencia ausente em 3 triggers
--               e tightens política de delete de broadcasts
-- Data: 2026-06-13
--
-- PROBLEMAS CORRIGIDOS:
--
--   1. on_escala_publicada_membros — link_referencia = NULL
--      Membro recebe notificação mas toque não abre nenhuma tela.
--      Fix: adicionar link_referencia = '/portal-membro/escalas'
--           e apenas_admin = false explícito.
--
--   2. on_escala_alterada — link_referencia = NULL
--      Mesmo problema: toque na notificação não navega.
--      Fix: adicionar link_referencia = '/portal-membro/escalas'.
--
--   3. on_evento_criado (via _notify_all_membros) — link_referencia = NULL
--      Broadcast de evento não leva o membro para a agenda.
--      Fix: recria _notify_all_membros com link_referencia opcional
--           e atualiza _trigger_evento_criado para passar o link.
--
--   4. notif_membro_delete permite deletar broadcasts (destinatario_id IS NULL)
--      Um membro poderia remover notificações globais pelo banco diretamente.
--      Fix: restringir a apenas notificações com destinatario_id = próprio id.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE + DROP/CREATE POLICY)
-- REQUER: migrations 020, PATCH_P já aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. RECRIA _notify_all_membros — aceita link_referencia opcional
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_all_membros(
  p_paroquia_id   uuid,
  p_titulo        text,
  p_mensagem      text,
  p_tipo          text DEFAULT 'aviso',
  p_link          text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, link_referencia)
  VALUES
    (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false, false, p_link);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. RECRIA _trigger_evento_criado — passa link para Agenda
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_evento_criado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tipo_label text;
BEGIN
  v_tipo_label := CASE NEW.tipo
    WHEN 'retiro'         THEN 'Retiro'
    WHEN 'formacao'       THEN 'Formação'
    WHEN 'encontro'       THEN 'Encontro'
    WHEN 'missa_especial' THEN 'Missa especial'
    ELSE 'Evento'
  END;

  IF NEW.ativo = true THEN
    PERFORM public._notify_all_membros(
      NEW.paroquia_id,
      v_tipo_label || ': ' || left(NEW.titulo, 60),
      format(
        '"%s" está programado para %s. Confirme sua presença na Agenda do portal.',
        NEW.titulo,
        to_char(NEW.data_inicio::timestamptz, 'DD/MM/YYYY HH24:MI')
      ),
      'aviso',
      '/portal-membro/eventos'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 3. RECRIA on_escala_publicada_membros — adiciona link + flag
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rec record;
BEGIN
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;
  IF OLD.status = 'publicada'  THEN RETURN NEW; END IF;

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

-- ══════════════════════════════════════════════════════════════
-- 4. RECRIA _trigger_escala_alterada — adiciona link
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trigger_escala_alterada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rec       record;
  v_mudancas text := '';
BEGIN
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;

  IF NEW.data        IS DISTINCT FROM OLD.data        THEN
    v_mudancas := v_mudancas || 'Data: ' || to_char(NEW.data::date, 'DD/MM/YYYY') || '. ';
  END IF;
  IF NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio THEN
    v_mudancas := v_mudancas || 'Horário: ' || COALESCE(left(NEW.hora_inicio, 5), '—') || '. ';
  END IF;
  IF NEW.local       IS DISTINCT FROM OLD.local       THEN
    v_mudancas := v_mudancas || 'Local: '   || COALESCE(NEW.local, '—') || '. ';
  END IF;

  IF v_mudancas = '' THEN RETURN NEW; END IF;

  FOR rec IN
    SELECT membro_id FROM public.escala_membros WHERE escala_id = NEW.id
  LOOP
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Escala atualizada: ' || left(NEW.titulo, 60),
      format(
        'A escala "%s" foi alterada. %sVerifique os detalhes no portal.',
        NEW.titulo,
        v_mudancas
      ),
      'alerta',
      false,
      false,
      rec.membro_id,
      '/portal-membro/escalas'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 5. TIGHTENS notif_membro_delete — somente notificações pessoais
-- ══════════════════════════════════════════════════════════════
-- Antes: membro podia excluir broadcasts (destinatario_id IS NULL).
-- Depois: somente notificações direcionadas ao próprio membro.
-- Admin ainda pode excluir qualquer notificação via notif_admin_manage.

DROP POLICY IF EXISTS "notif_membro_delete" ON public.notificacoes;

CREATE POLICY "notif_membro_delete" ON public.notificacoes
  FOR DELETE TO authenticated
  USING (
    -- Admin pode deletar qualquer notificação da paróquia (coberto por notif_admin_manage)
    -- Membro: apenas notificações pessoais (destinatario_id = seu id)
    apenas_admin = false
    AND destinatario_id IN (
      SELECT id FROM public.membros WHERE auth_user_id = auth.uid() AND ativo = true
      UNION
      SELECT id FROM public.membros
      WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(COALESCE(auth.email(),'')))
        AND ativo = true
    )
  );

-- ══════════════════════════════════════════════════════════════
-- 6. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Tap em "Sua escala foi publicada" → abre /portal-membro/escalas
--   ✓ Tap em "Escala atualizada" → abre /portal-membro/escalas
--   ✓ Tap em notificação de evento → abre /portal-membro/eventos
--   ✓ Membro NÃO consegue excluir broadcast via DELETE direto no banco
--   ✓ Admin ainda consegue excluir qualquer notificação da paróquia
-- ─────────────────────────────────────────────────────────────
