-- Migration 243: segmentação de Comunicados por função e atuação pastoral.
ALTER TABLE public.comunicacao_pastoral_mensagens
  ADD COLUMN IF NOT EXISTS destinatario_funcao_id uuid REFERENCES public.ministerios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destinatario_atuacao_id uuid REFERENCES public.atuacoes_pastorais(id) ON DELETE SET NULL;

ALTER TABLE public.comunicacao_pastoral_mensagens DROP CONSTRAINT IF EXISTS chk_apenas_um_segmento;
ALTER TABLE public.comunicacao_pastoral_mensagens
  ADD CONSTRAINT chk_apenas_um_segmento CHECK (
    ((destinatario_membro_id IS NOT NULL)::int +
     (destinatario_ministerio_id IS NOT NULL)::int +
     (destinatario_escala_id IS NOT NULL)::int +
     (destinatario_funcao_id IS NOT NULL)::int +
     (destinatario_atuacao_id IS NOT NULL)::int) <= 1
  );

CREATE OR REPLACE FUNCTION coord_enviar_aviso_pastoral(
  p_paroquia_id                uuid,
  p_mensagem                   text,
  p_destinatario_membro_id     uuid DEFAULT NULL,
  p_destinatario_ministerio_id uuid DEFAULT NULL,
  p_destinatario_escala_id     uuid DEFAULT NULL,
  p_destinatario_funcao_id    uuid DEFAULT NULL,
  p_destinatario_atuacao_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_remetente_id   uuid;
  v_remetente_nome text;
  v_paroquia_nome  text;
  v_mensagem_id    uuid;
  v_wa_secret      text;
  v_url            text;
  v_membro         record;
  v_payload        jsonb;
  v_total          int := 0;
  v_disparos_hora  int;
  v_link           text := 'https://lumenpastoral.com.br/portal-membro/home';
  c_max_dest       constant int := 200;
  c_max_hora       constant int := 3;
BEGIN
  SELECT m.id, m.nome INTO v_remetente_id, v_remetente_nome
  FROM   membros m
  WHERE  m.auth_user_id = auth.uid()
    AND  m.paroquia_id  = p_paroquia_id
    AND  m.tipo_acesso  IN ('auxiliar','vice','coordenador','administrador')
    AND  m.ativo        = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para enviar avisos pastorais');
  END IF;

  IF (
    (p_destinatario_membro_id IS NOT NULL)::int +
    (p_destinatario_ministerio_id IS NOT NULL)::int +
    (p_destinatario_escala_id IS NOT NULL)::int +
    (p_destinatario_funcao_id IS NOT NULL)::int +
    (p_destinatario_atuacao_id IS NOT NULL)::int
  ) > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Selecione apenas um tipo de destinatário por envio.');
  END IF;

  IF p_destinatario_funcao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ministerios WHERE id = p_destinatario_funcao_id
      AND paroquia_id = p_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Função inválida ou pertencente a outra paróquia.');
  END IF;

  IF p_destinatario_atuacao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM atuacoes_pastorais WHERE id = p_destinatario_atuacao_id
      AND paroquia_id = p_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Atuação inválida ou pertencente a outra paróquia.');
  END IF;

  DELETE FROM comunicacao_pastoral_rate_limit
  WHERE  remetente_id = v_remetente_id
    AND  paroquia_id  = p_paroquia_id
    AND  criado_em    < now() - interval '1 hour';

  SELECT COUNT(*) INTO v_disparos_hora
  FROM   comunicacao_pastoral_rate_limit
  WHERE  remetente_id = v_remetente_id
    AND  paroquia_id  = p_paroquia_id;

  IF v_disparos_hora >= c_max_hora THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('Limite de %s disparos por hora atingido. Aguarde antes de enviar novamente.', c_max_hora)
    );
  END IF;

  SELECT nome INTO v_paroquia_nome FROM paroquias WHERE id = p_paroquia_id;

  SELECT val INTO v_wa_secret FROM _push_config WHERE key = 'internal_wa_secret';
  IF v_wa_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WhatsApp não configurado');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM   membros m
  WHERE  m.paroquia_id       = p_paroquia_id
    AND  m.ativo             = true
    AND  m.conta_ativada     = true
    AND  m.whatsapp_opt_in   = true
    AND  m.whatsapp_telefone IS NOT NULL
    AND CASE
      WHEN p_destinatario_membro_id IS NOT NULL     THEN m.id = p_destinatario_membro_id
      WHEN p_destinatario_ministerio_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_ministerios mm
        WHERE  mm.membro_id     = m.id
          AND  mm.ministerio_id = p_destinatario_ministerio_id
          AND  mm.ativo         = true
      )
      WHEN p_destinatario_escala_id IS NOT NULL     THEN EXISTS (
        SELECT 1 FROM escala_membros em2
        WHERE  em2.membro_id = m.id
          AND  em2.escala_id = p_destinatario_escala_id
          AND  em2.ativo IS NOT FALSE
      )
            WHEN p_destinatario_funcao_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_ministerios mm
        WHERE mm.membro_id = m.id AND mm.ministerio_id = p_destinatario_funcao_id
          AND mm.ativo = true
      )
      WHEN p_destinatario_atuacao_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_atuacoes ma
        JOIN atuacoes_pastorais ap ON ap.id = ma.atuacao_id
        WHERE ma.membro_id = m.id AND ma.atuacao_id = p_destinatario_atuacao_id
          AND ap.paroquia_id = p_paroquia_id AND ap.ativo = true
      )
ELSE true
    END;

  IF v_total > c_max_dest THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('O disparo atingiria %s destinatários, acima do limite de %s. Use segmentação por ministério ou escala.', v_total, c_max_dest)
    );
  END IF;

  INSERT INTO comunicacao_pastoral_rate_limit (remetente_id, paroquia_id)
  VALUES (v_remetente_id, p_paroquia_id);

  INSERT INTO comunicacao_pastoral_mensagens (
    paroquia_id, remetente_id, mensagem,
    destinatario_membro_id, destinatario_ministerio_id, destinatario_escala_id,
    destinatario_funcao_id, destinatario_atuacao_id
  ) VALUES (
    p_paroquia_id, v_remetente_id, p_mensagem,
    p_destinatario_membro_id, p_destinatario_ministerio_id, p_destinatario_escala_id,
    p_destinatario_funcao_id, p_destinatario_atuacao_id
  )
  RETURNING id INTO v_mensagem_id;

  v_url   := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_total := 0;

  FOR v_membro IN
    SELECT m.id, m.nome
    FROM   membros m
    WHERE  m.paroquia_id       = p_paroquia_id
      AND  m.ativo             = true
      AND  m.conta_ativada     = true
      AND  m.whatsapp_opt_in   = true
      AND  m.whatsapp_telefone IS NOT NULL
      AND CASE
        WHEN p_destinatario_membro_id IS NOT NULL     THEN m.id = p_destinatario_membro_id
        WHEN p_destinatario_ministerio_id IS NOT NULL THEN EXISTS (
          SELECT 1 FROM membro_ministerios mm
          WHERE  mm.membro_id     = m.id
            AND  mm.ministerio_id = p_destinatario_ministerio_id
            AND  mm.ativo         = true
        )
        WHEN p_destinatario_escala_id IS NOT NULL     THEN EXISTS (
          SELECT 1 FROM escala_membros em2
          WHERE  em2.membro_id = m.id
            AND  em2.escala_id = p_destinatario_escala_id
            AND  em2.ativo IS NOT FALSE
        )
              WHEN p_destinatario_funcao_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_ministerios mm
        WHERE mm.membro_id = m.id AND mm.ministerio_id = p_destinatario_funcao_id
          AND mm.ativo = true
      )
      WHEN p_destinatario_atuacao_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_atuacoes ma
        JOIN atuacoes_pastorais ap ON ap.id = ma.atuacao_id
        WHERE ma.membro_id = m.id AND ma.atuacao_id = p_destinatario_atuacao_id
          AND ap.paroquia_id = p_paroquia_id AND ap.ativo = true
      )
ELSE true
      END
  LOOP
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro.id)
    ON CONFLICT (mensagem_id, membro_id) DO NOTHING;

    v_payload := jsonb_build_object(
      'membro_id',     v_membro.id,
      'paroquia_id',   p_paroquia_id,
      'evento_tipo',   'aviso_pastoral',
      'evento_ref_id', v_mensagem_id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome,
        'paroquia_nome', v_paroquia_nome,
        'mensagem',      p_mensagem,
        'remetente',     v_remetente_nome
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || _cfg_anon_key(),
        'X-Wa-Secret',   v_wa_secret
      ),
      body    := v_payload          -- fix: era v_payload::text
    );

    v_total := v_total + 1;
  END LOOP;

  UPDATE comunicacao_pastoral_mensagens
  SET    total_destinatarios = v_total
  WHERE  id = v_mensagem_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'mensagem_id', v_mensagem_id,
    'total',       v_total
  );
END;
$$;


GRANT EXECUTE ON FUNCTION public.coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid, uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
