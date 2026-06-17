-- migration 049 — Corrige autorização do RPC reenviar_notificacoes_escala
--
-- Bug: a função verificava apenas is_coordenador_da_paroquia() que consulta
-- a tabela membros. Admins (admin_paroquial / super_admin) que não possuem
-- registro em membros recebiam 'not_authorized'.
-- Fix: aceita também _portal_is_admin(paroquia_id) como critério de acesso.

CREATE OR REPLACE FUNCTION public.reenviar_notificacoes_escala(p_escala_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paroquia_id uuid;
  v_status      text;
BEGIN
  SELECT paroquia_id, status INTO v_paroquia_id, v_status
  FROM public.escalas WHERE id = p_escala_id;

  IF v_paroquia_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'escala_not_found');
  END IF;

  -- Aceita admin da paróquia OU coordenador/auxiliar via membros
  IF NOT (
    public._portal_is_admin(v_paroquia_id)
    OR public.is_coordenador_da_paroquia(v_paroquia_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_status <> 'publicada' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'escala_not_published');
  END IF;

  -- Reinsere notificações in-app para todos os membros escalados
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin, destinatario_id, link_referencia)
  SELECT
    v_paroquia_id,
    'Sua escala foi publicada: ' || left(e.titulo, 60),
    format(
      'A escala "%s" em %s foi publicada. Você está como %s. Confirme sua participação.',
      e.titulo,
      to_char(e.data::date, 'DD/MM/YYYY'),
      COALESCE(min.nome, 'servidor')
    ),
    'aviso',
    false,
    false,
    em.membro_id,
    '/portal-membro/escalas'
  FROM public.escala_membros em
  JOIN public.escalas e ON e.id = em.escala_id
  LEFT JOIN public.ministerios min ON min.id = em.ministerio_id
  WHERE em.escala_id = p_escala_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reenviar_notificacoes_escala(uuid) TO authenticated;
