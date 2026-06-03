-- ============================================================
-- NOTIFICAÇÕES AUTOMÁTICAS — Triggers para todas as ações
--
-- Execute INTEIRO no SQL Editor do Supabase
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FUNÇÕES AUXILIARES
-- ─────────────────────────────────────────────────────────────

-- Notifica TODOS os membros ativos de uma paróquia
CREATE OR REPLACE FUNCTION public._notify_all_membros(
  p_paroquia_id uuid,
  p_titulo      text,
  p_mensagem    text,
  p_tipo        text DEFAULT 'aviso'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida)
  VALUES (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false);
END;
$$;

-- Notifica apenas administradores/coordenação de uma paróquia
-- (admins = perfis com role admin_paroquial, super_admin ou coordenador)
CREATE OR REPLACE FUNCTION public._notify_coordenacao(
  p_paroquia_id uuid,
  p_titulo      text,
  p_mensagem    text,
  p_tipo        text DEFAULT 'alerta'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Insere sem destinatario_id específico — será filtrada pela coordenação
  -- na tela de notificações do admin
  INSERT INTO public.notificacoes (paroquia_id, titulo, mensagem, tipo, lida)
  VALUES (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 1: Escala publicada → avisar todos os membros
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_escala_publicada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Dispara apenas quando status muda para 'publicada'
  IF NEW.status = 'publicada' AND (OLD.status IS NULL OR OLD.status <> 'publicada') THEN
    PERFORM _notify_all_membros(
      NEW.paroquia_id,
      'Nova escala publicada: ' || NEW.titulo,
      format(
        'A escala "%s" foi publicada para %s. Acesse o portal para verificar se você está escalado.',
        NEW.titulo,
        to_char(NEW.data::date, 'DD/MM/YYYY')
      ),
      'aviso'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_escala_publicada ON public.escalas;
CREATE TRIGGER on_escala_publicada
  AFTER UPDATE ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public._trigger_escala_publicada();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 2: Evento/Formação criado → avisar todos os membros
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_evento_criado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tipo_label text;
BEGIN
  v_tipo_label := CASE NEW.tipo
    WHEN 'retiro'    THEN 'Retiro'
    WHEN 'formacao'  THEN 'Formação'
    WHEN 'encontro'  THEN 'Encontro'
    WHEN 'missa_especial' THEN 'Missa especial'
    ELSE 'Evento'
  END;

  IF NEW.ativo = true THEN
    PERFORM _notify_all_membros(
      NEW.paroquia_id,
      v_tipo_label || ': ' || NEW.titulo,
      format(
        '%s "%s" foi programado para %s. Confirme sua presença no portal.',
        v_tipo_label,
        NEW.titulo,
        to_char(NEW.data_inicio::timestamptz, 'DD/MM/YYYY HH24:MI')
      ),
      'aviso'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_evento_criado ON public.formacoes_eventos;
CREATE TRIGGER on_evento_criado
  AFTER INSERT ON public.formacoes_eventos
  FOR EACH ROW EXECUTE FUNCTION public._trigger_evento_criado();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 3: Indisponibilidade registrada → avisar coordenação
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_indisponibilidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_membro_nome text;
BEGIN
  SELECT nome INTO v_membro_nome FROM public.membros WHERE id = NEW.membro_id;

  PERFORM _notify_coordenacao(
    NEW.paroquia_id,
    'Indisponibilidade: ' || COALESCE(v_membro_nome, 'Membro'),
    format(
      '%s registrou indisponibilidade para %s. Motivo: %s',
      COALESCE(v_membro_nome, 'Membro'),
      to_char(NEW.data::date, 'DD/MM/YYYY'),
      COALESCE(NEW.motivo, 'não informado')
    ),
    'alerta'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_indisponibilidade ON public.indisponibilidades;
CREATE TRIGGER on_indisponibilidade
  AFTER INSERT ON public.indisponibilidades
  FOR EACH ROW EXECUTE FUNCTION public._trigger_indisponibilidade();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 4: Falta ou atraso registrado → avisar coordenação
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_falta_registrada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_membro_nome  text;
  v_escala_titulo text;
  v_paroquia_id  uuid;
  v_status_label text;
BEGIN
  -- Só dispara quando status muda para faltou, ausente ou atrasado
  IF NEW.status NOT IN ('faltou', 'ausente', 'atrasado') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT m.nome, e.titulo, e.paroquia_id
    INTO v_membro_nome, v_escala_titulo, v_paroquia_id
    FROM public.membros m
    JOIN public.escalas e ON e.id = NEW.escala_id
    WHERE m.id = NEW.membro_id;

  v_status_label := CASE NEW.status
    WHEN 'faltou'   THEN 'Falta'
    WHEN 'ausente'  THEN 'Ausência'
    WHEN 'atrasado' THEN 'Atraso'
    ELSE NEW.status
  END;

  PERFORM _notify_coordenacao(
    v_paroquia_id,
    v_status_label || ': ' || COALESCE(v_membro_nome, 'Membro'),
    format(
      '%s foi registrado para %s na escala "%s".',
      v_status_label,
      COALESCE(v_membro_nome, 'membro'),
      COALESCE(v_escala_titulo, 'escala')
    ),
    'alerta'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_falta_registrada ON public.escala_membros;
CREATE TRIGGER on_falta_registrada
  AFTER UPDATE ON public.escala_membros
  FOR EACH ROW EXECUTE FUNCTION public._trigger_falta_registrada();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 5: Ocorrência de escala → avisar coordenação
-- (escala_ocorrencias — registro pelo coordenador/admin)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_ocorrencia_escala()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_registrado_nome text;
  v_escala_titulo   text;
  v_paroquia_id     uuid;
  v_tipo_label      text;
BEGIN
  SELECT m.nome, e.titulo, e.paroquia_id
    INTO v_registrado_nome, v_escala_titulo, v_paroquia_id
    FROM public.membros m
    JOIN public.escalas e ON e.id = NEW.escala_id
    WHERE m.id = NEW.registrado_por;

  v_tipo_label := CASE NEW.tipo
    WHEN 'atraso'               THEN 'Atraso'
    WHEN 'ausencia'             THEN 'Ausência'
    WHEN 'comportamento'        THEN 'Comportamento inadequado'
    WHEN 'troca_funcao'         THEN 'Troca de função'
    WHEN 'problema_liturgico'   THEN 'Problema litúrgico'
    WHEN 'observacao_pastoral'  THEN 'Observação pastoral'
    ELSE NEW.tipo
  END;

  IF v_paroquia_id IS NOT NULL THEN
    PERFORM _notify_coordenacao(
      v_paroquia_id,
      'Ocorrência: ' || v_tipo_label,
      format(
        'Registrado por %s na escala "%s": %s',
        COALESCE(v_registrado_nome, 'membro'),
        COALESCE(v_escala_titulo, 'escala'),
        left(NEW.descricao, 150)
      ),
      'alerta'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_ocorrencia_escala ON public.escala_ocorrencias;
CREATE TRIGGER on_ocorrencia_escala
  AFTER INSERT ON public.escala_ocorrencias
  FOR EACH ROW EXECUTE FUNCTION public._trigger_ocorrencia_escala();

-- ─────────────────────────────────────────────────────────────
-- Recarregar schema
-- ─────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
