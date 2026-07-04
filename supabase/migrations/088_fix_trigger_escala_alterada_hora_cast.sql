-- Migration 088 — Corrige _trigger_escala_alterada: left() em coluna time
--
-- PROBLEMA: migration 021 usa left(NEW.hora_inicio, 5) mas hora_inicio é
-- do tipo time without time zone. left() só aceita text, causando erro:
--   "function left(time without time zone, integer) does not exist" (42883)
-- Dispara ao salvar/atualizar qualquer escala já publicada.
--
-- FIX: substitui left(NEW.hora_inicio, 5) por to_char(NEW.hora_inicio, 'HH24:MI')
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE)

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
    v_mudancas := v_mudancas || 'Horário: ' || COALESCE(to_char(NEW.hora_inicio, 'HH24:MI'), '—') || '. ';
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

NOTIFY pgrst, 'reload schema';
