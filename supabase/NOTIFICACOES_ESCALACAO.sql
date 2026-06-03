-- ============================================================
-- NOTIFICAÇÕES DE ESCALAÇÃO
-- Triggers para notificar membros individuais quando:
--   1. São adicionados a uma escala publicada
--   2. Uma escala em que estão já foi publicada (publicação tardia)
--   3. Dados de uma escala em que estão mudam (data/hora/local)
--
-- Execute no SQL Editor do Supabase APÓS NOTIFICACOES_AUTOMATICAS.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 1: Membro adicionado a uma escala publicada
--   → Notifica APENAS o membro escalado
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_membro_escalado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_paroquia_id   uuid;
  v_escala_titulo text;
  v_escala_data   date;
  v_escala_status text;
  v_ministerio    text;
BEGIN
  -- Busca escala e verifica se está publicada
  SELECT e.paroquia_id, e.titulo, e.data, e.status
    INTO v_paroquia_id, v_escala_titulo, v_escala_data, v_escala_status
    FROM public.escalas e
    WHERE e.id = NEW.escala_id;

  -- Só notifica se escala já estiver publicada
  IF v_escala_status <> 'publicada' THEN
    RETURN NEW;
  END IF;

  -- Nome do ministério/função
  SELECT nome INTO v_ministerio
    FROM public.ministerios WHERE id = NEW.ministerio_id;

  -- Insere notificação direcionada ao membro
  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida, destinatario_id)
  VALUES (
    v_paroquia_id,
    'Você foi escalado: ' || COALESCE(v_escala_titulo, 'escala'),
    format(
      'Você foi adicionado à escala "%s" em %s como %s. Acesse o portal para confirmar sua participação.',
      COALESCE(v_escala_titulo, 'escala'),
      to_char(v_escala_data, 'DD/MM/YYYY'),
      COALESCE(v_ministerio, 'servidor')
    ),
    'aviso',
    false,
    NEW.membro_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_membro_escalado ON public.escala_membros;
CREATE TRIGGER on_membro_escalado
  AFTER INSERT ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_membro_escalado();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 2: Escala já existente é publicada com membros
--   → Notifica cada membro já atribuído
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec record;
BEGIN
  -- Só dispara quando status muda PARA publicada
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;
  IF OLD.status = 'publicada' THEN RETURN NEW; END IF;

  -- Notifica cada membro já na escala individualmente
  FOR rec IN
    SELECT em.membro_id, COALESCE(min.nome, 'servidor') AS ministerio_nome
    FROM public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    WHERE em.escala_id = NEW.id
  LOOP
    INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida, destinatario_id)
    VALUES (
      NEW.paroquia_id,
      'Sua escala foi publicada: ' || NEW.titulo,
      format(
        'A escala "%s" em %s foi publicada. Você está escalado como %s. Confirme sua participação no portal.',
        NEW.titulo,
        to_char(NEW.data::date, 'DD/MM/YYYY'),
        rec.ministerio_nome
      ),
      'aviso',
      false,
      rec.membro_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_publicada_membros ON public.escalas;
CREATE TRIGGER on_escala_publicada_membros
  AFTER UPDATE OF status ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public._trigger_escala_publicada_membros();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 3: Dados de escala publicada mudam (data/hora/local)
--   → Notifica membros já atribuídos sobre a alteração
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_escala_alterada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec record;
  v_mudancas text := '';
BEGIN
  -- Só processa escalas publicadas com mudanças reais
  IF NEW.status <> 'publicada' THEN RETURN NEW; END IF;

  IF NEW.data IS DISTINCT FROM OLD.data THEN
    v_mudancas := v_mudancas || 'Data: ' || to_char(NEW.data::date, 'DD/MM/YYYY') || '. ';
  END IF;
  IF NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio THEN
    v_mudancas := v_mudancas || 'Horário: ' || COALESCE(left(NEW.hora_inicio, 5), 'não definido') || '. ';
  END IF;
  IF NEW.local IS DISTINCT FROM OLD.local THEN
    v_mudancas := v_mudancas || 'Local: ' || COALESCE(NEW.local, 'não definido') || '. ';
  END IF;

  -- Se não houve mudanças relevantes, não notifica
  IF v_mudancas = '' THEN RETURN NEW; END IF;

  FOR rec IN
    SELECT membro_id FROM public.escala_membros WHERE escala_id = NEW.id
  LOOP
    INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida, destinatario_id)
    VALUES (
      NEW.paroquia_id,
      'Escala alterada: ' || NEW.titulo,
      format(
        'A escala "%s" foi atualizada. %sVerifique os novos detalhes no portal.',
        NEW.titulo,
        v_mudancas
      ),
      'alerta',
      false,
      rec.membro_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_alterada ON public.escalas;
CREATE TRIGGER on_escala_alterada
  AFTER UPDATE OF data, hora_inicio, local ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public._trigger_escala_alterada();

-- ─────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ─────────────────────────────────────────────────────────────
SELECT 'Triggers criados:' AS resultado;
SELECT tgname, tgrelid::regclass AS tabela
FROM pg_trigger
WHERE tgname IN (
  'on_membro_escalado',
  'on_escala_publicada_membros',
  'on_escala_alterada'
)
ORDER BY tgname;
