-- migration 055 — Melhora título e texto da notificação in-app quando escala é publicada
-- Recria o trigger de 044 com mensagens mais claras e amigáveis

CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_data_fmt TEXT;
  v_hora_fmt TEXT;
BEGIN
  -- Só dispara quando status muda para 'publicada'
  IF NEW.status <> 'publicada' OR OLD.status = 'publicada' THEN
    RETURN NEW;
  END IF;

  -- Marca momento da publicação (idempotente)
  UPDATE public.escalas
  SET publicada_at = NOW()
  WHERE id = NEW.id AND publicada_at IS NULL;

  -- Formata data e hora
  v_data_fmt := to_char(NEW.data::date, 'DD/MM/YYYY');
  v_hora_fmt := CASE
    WHEN NEW.hora_inicio IS NOT NULL
      THEN ' às ' || to_char(NEW.hora_inicio, 'HH24:MI')
    ELSE ''
  END;

  -- Notifica cada membro atribuído
  FOR rec IN
    SELECT em.membro_id, COALESCE(min.nome, 'Servidor') AS ministerio_nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    WHERE  em.escala_id = NEW.id
  LOOP
    INSERT INTO public.notificacoes
      (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
    VALUES (
      NEW.paroquia_id,
      '📅 Nova escala publicada — ' || left(NEW.titulo, 50),
      format(
        'Você está escalado(a) como %s em "%s" no dia %s%s. Confirme sua presença no portal.',
        rec.ministerio_nome,
        NEW.titulo,
        v_data_fmt,
        v_hora_fmt
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

-- Recria o trigger (drop pelo nome usado em 044)
DROP TRIGGER IF EXISTS _trigger_escala_publicada_membros ON public.escalas;
DROP TRIGGER IF EXISTS trg_escala_publicada_membros      ON public.escalas;

CREATE TRIGGER trg_escala_publicada_membros
  AFTER UPDATE OF status ON public.escalas
  FOR EACH ROW EXECUTE FUNCTION public._trigger_escala_publicada_membros();
