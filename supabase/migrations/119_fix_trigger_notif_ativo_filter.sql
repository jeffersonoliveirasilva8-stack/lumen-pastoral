-- Migration 119 — Fix _trigger_escala_publicada_membros: filtra ativo=true
--
-- Problema: o trigger criava notificações de "você está escalado" para membros
-- com ativo=false (soft-deletados da escala antes da publicação).
-- Esses membros recebiam pedido de confirmação de presença no portal mesmo
-- não estando mais na escala.
--
-- Também limpa notificações já criadas para membros removidos.

-- ── 1. Atualiza função do trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trigger_escala_publicada_membros()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec        RECORD;
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

  -- Notifica apenas membros ativos na escala (exclui soft-deletados)
  FOR rec IN
    SELECT em.membro_id, COALESCE(min.nome, 'Servidor') AS ministerio_nome
    FROM   public.escala_membros em
    LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
    WHERE  em.escala_id = NEW.id
      AND  (em.ativo IS NULL OR em.ativo = true)
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

-- ── 2. Remove notificações de "escalado" criadas para membros já removidos ──
-- Deleta notificações não-lidas de "Nova escala publicada" onde o membro
-- não tem mais linha ativa na escala correspondente.

DELETE FROM public.notificacoes n
WHERE n.lida = false
  AND n.link_referencia = '/portal-membro/escalas'
  AND n.titulo ILIKE '%Nova escala publicada%'
  AND n.destinatario_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.escala_membros em
    JOIN public.escalas e ON e.id = em.escala_id
    WHERE em.membro_id = n.destinatario_id
      AND (em.ativo IS NULL OR em.ativo = true)
      AND e.status = 'publicada'
      AND e.data >= CURRENT_DATE
  );

NOTIFY pgrst, 'reload schema';
