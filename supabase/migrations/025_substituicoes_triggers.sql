-- ============================================================
-- Migration 025: Triggers de notificação para o módulo de substituições
-- Data: 2026-06-13
--
-- TRIGGERS CRIADOS:
--   on_substituicao_insert → notifica coordenação (nova solicitação)
--   on_substituicao_update → notifica coordenação (voluntário registrado)
--                          → notifica solicitante + substituto (aprovada)
--                          → notifica solicitante (rejeitada)
--
-- NOTA: Usa apenas_coordenacao=true para coordenação (tier 023).
-- IDEMPOTENTE: sim (CREATE OR REPLACE)
-- REQUER: migrations 022–024 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. _trigger_substituicao_insert — nova solicitação
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_substituicao_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
BEGIN
  -- Carrega dados para a mensagem
  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT e.titulo, e.data, min.nome
  INTO v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = NEW.escala_membro_id;

  -- Notifica coordenação (tier: apenas_coordenacao=true)
  PERFORM public._notify_coordenacao(
    NEW.paroquia_id,
    'Substituição solicitada — ' || to_char(v_escala_data, 'DD/MM'),
    format(
      '%s solicitou substituição em "%s" (%s) para %s. Aguardando aprovação.',
      COALESCE(v_solicitante_nome, 'Membro'),
      COALESCE(v_escala_titulo, '—'),
      COALESCE(v_ministerio_nome, '—'),
      to_char(v_escala_data, 'DD/MM/YYYY')
    ),
    'alerta',
    '/substituicoes'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_substituicao_insert ON public.substituicoes;
CREATE TRIGGER on_substituicao_insert
  AFTER INSERT ON public.substituicoes
  FOR EACH ROW EXECUTE FUNCTION public._trigger_substituicao_insert();

-- ══════════════════════════════════════════════════════════════
-- 2. _trigger_substituicao_update — mudanças de status
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trigger_substituicao_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_solicitante_nome TEXT;
  v_substituto_nome  TEXT;
  v_escala_titulo    TEXT;
  v_escala_data      DATE;
  v_ministerio_nome  TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Carrega dados comuns
  SELECT m.nome INTO v_solicitante_nome
  FROM public.membros m WHERE m.id = NEW.solicitante_id;

  SELECT mv.nome INTO v_substituto_nome
  FROM public.membros mv WHERE mv.id = NEW.substituto_id;

  SELECT e.titulo, e.data, min.nome
  INTO v_escala_titulo, v_escala_data, v_ministerio_nome
  FROM public.escala_membros em
  JOIN public.escalas     e   ON e.id   = em.escala_id
  JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.id = NEW.escala_membro_id;

  -- com_voluntario: notifica coordenação que há voluntário aguardando aprovação
  IF NEW.status = 'com_voluntario' THEN
    PERFORM public._notify_coordenacao(
      NEW.paroquia_id,
      'Voluntário disponível — ' || to_char(v_escala_data, 'DD/MM'),
      format(
        '%s se voluntariou para substituir %s em "%s" (%s). Aguarda aprovação.',
        COALESCE(v_substituto_nome, 'Membro'),
        COALESCE(v_solicitante_nome, '—'),
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY')
      ),
      'urgente',
      '/substituicoes'
    );
  END IF;

  -- aprovada: notifica solicitante + substituto individualmente
  IF NEW.status = 'aprovada' THEN
    -- Notifica solicitante
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição aprovada ✓',
      format(
        'Sua substituição em "%s" (%s) foi aprovada. %s irá no seu lugar.',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        COALESCE(v_substituto_nome, 'O voluntário')
      ),
      'aviso', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );

    -- Notifica substituto
    IF NEW.substituto_id IS NOT NULL THEN
      INSERT INTO public.notificacoes
        (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
      VALUES (
        NEW.paroquia_id,
        'Você foi confirmado como substituto',
        format(
          'Você substituirá %s em "%s" (%s). Confirme sua presença na escala.',
          COALESCE(v_solicitante_nome, '—'),
          COALESCE(v_escala_titulo, '—'),
          to_char(v_escala_data, 'DD/MM/YYYY')
        ),
        'aviso', false, false, false,
        NEW.substituto_id,
        '/portal-membro/escalas'
      );
    END IF;
  END IF;

  -- rejeitada: notifica solicitante
  IF NEW.status = 'rejeitada' THEN
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, apenas_coordenacao, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      'Substituição não aprovada',
      format(
        'Sua solicitação de substituição em "%s" (%s) não foi aprovada.%s',
        COALESCE(v_escala_titulo, '—'),
        to_char(v_escala_data, 'DD/MM/YYYY'),
        CASE WHEN NEW.motivo_rejeicao IS NOT NULL THEN ' Motivo: ' || NEW.motivo_rejeicao ELSE '' END
      ),
      'alerta', false, false, false,
      NEW.solicitante_id,
      '/portal-membro/substituicoes'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_substituicao_update ON public.substituicoes;
CREATE TRIGGER on_substituicao_update
  AFTER UPDATE ON public.substituicoes
  FOR EACH ROW EXECUTE FUNCTION public._trigger_substituicao_update();

-- ══════════════════════════════════════════════════════════════
-- 3. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- FLUXO DE NOTIFICAÇÕES DO MÓDULO DE SUBSTITUIÇÕES:
--
-- INSERT substituicoes:
--   → Coordenação (apenas_coordenacao=true): "Substituição solicitada"
--
-- UPDATE status=com_voluntario:
--   → Coordenação (apenas_coordenacao=true): "Voluntário disponível" (urgente)
--
-- UPDATE status=aprovada:
--   → Solicitante (destinatario_id): "Substituição aprovada ✓"
--   → Substituto  (destinatario_id): "Você foi confirmado como substituto"
--
-- UPDATE status=rejeitada:
--   → Solicitante (destinatario_id): "Substituição não aprovada"
-- ─────────────────────────────────────────────────────────────
