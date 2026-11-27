-- Migration 245: segmentação de Comunicados por atuação pastoral.
-- (Renumerada de 243 para 245: 243 e 244 já foram usadas pelas correções de recusa de escala.)
-- Parte da versão da migration 176 de coord_enviar_aviso_pastoral e acrescenta:
--   * filtro por atuação (membro_atuacoes / atuacoes_pastorais);
--   * validação de IDs e segmentos contra a paróquia do remetente;
--   * telefone em branco não conta como telefone (mesma regra do _pode_enviar_whatsapp);
--   * mensagem vazia/longa devolve erro amigável em vez de exceção de CHECK;
--   * trava por remetente (pg_advisory_xact_lock) para o limite de 3/hora valer mesmo com cliques simultâneos;
--   * bloqueio de reenvio idêntico (mesmo remetente, texto e segmento) em 10 minutos;
--   * search_path fixo na função SECURITY DEFINER.
-- O filtro de função já existe em ministerios/membro_ministerios; a interface o identifica como "Função".

ALTER TABLE public.comunicacao_pastoral_mensagens
  ADD COLUMN IF NOT EXISTS destinatario_atuacao_id uuid REFERENCES public.atuacoes_pastorais(id) ON DELETE SET NULL;

ALTER TABLE public.comunicacao_pastoral_mensagens DROP CONSTRAINT IF EXISTS chk_apenas_um_segmento;
ALTER TABLE public.comunicacao_pastoral_mensagens
  ADD CONSTRAINT chk_apenas_um_segmento CHECK (
    ((destinatario_membro_id IS NOT NULL)::int +
     (destinatario_ministerio_id IS NOT NULL)::int +
     (destinatario_escala_id IS NOT NULL)::int +
     (destinatario_atuacao_id IS NOT NULL)::int) <= 1
  );

-- Remove a assinatura antiga (5 argumentos). Como o novo sexto argumento tem DEFAULT NULL,
-- manter ambas as versões deixa chamadas com 5 argumentos ambíguas no PostgREST/PostgreSQL.
DROP FUNCTION IF EXISTS public.coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.coord_enviar_aviso_pastoral(
  p_paroquia_id                uuid,
  p_mensagem                   text,
  p_destinatario_membro_id     uuid DEFAULT NULL,
  p_destinatario_ministerio_id uuid DEFAULT NULL,
  p_destinatario_escala_id     uuid DEFAULT NULL,
  p_destinatario_atuacao_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  IF p_mensagem IS NULL OR char_length(btrim(p_mensagem)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escreva a mensagem antes de enviar.');
  END IF;

  IF char_length(p_mensagem) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A mensagem passa de 1000 caracteres.');
  END IF;

  IF (
    (p_destinatario_membro_id IS NOT NULL)::int +
    (p_destinatario_ministerio_id IS NOT NULL)::int +
    (p_destinatario_escala_id IS NOT NULL)::int +
    (p_destinatario_atuacao_id IS NOT NULL)::int
  ) > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Selecione apenas um tipo de destinatário por envio.');
  END IF;

  IF p_destinatario_membro_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM membros
    WHERE id = p_destinatario_membro_id AND paroquia_id = p_paroquia_id
      AND ativo = true AND conta_ativada = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Membro inválido ou não elegível nesta paróquia.');
  END IF;

  IF p_destinatario_ministerio_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ministerios
    WHERE id = p_destinatario_ministerio_id AND paroquia_id = p_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Função inválida ou pertencente a outra paróquia.');
  END IF;

  IF p_destinatario_escala_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM escalas
    WHERE id = p_destinatario_escala_id AND paroquia_id = p_paroquia_id AND status = 'publicada'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escala inválida, não publicada ou pertencente a outra paróquia.');
  END IF;

  IF p_destinatario_atuacao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM atuacoes_pastorais
    WHERE id = p_destinatario_atuacao_id AND paroquia_id = p_paroquia_id AND ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Atuação inválida ou pertencente a outra paróquia.');
  END IF;

  -- Serializa disparos do mesmo remetente: sem isso, dois cliques simultâneos
  -- leem a mesma contagem e ambos passam do limite de 3 por hora.
  PERFORM pg_advisory_xact_lock(hashtextextended('coord_enviar_aviso_pastoral:' || v_remetente_id::text, 0));

  -- Reenvio idêntico (mesmo texto e mesmo segmento) em menos de 10 minutos é
  -- tratado como duplicidade: cada disparo gera um evento_ref_id novo, então a
  -- deduplicação de whatsapp_sends não pegaria esse caso.
  IF EXISTS (
    SELECT 1 FROM comunicacao_pastoral_mensagens cm
    WHERE cm.remetente_id = v_remetente_id
      AND cm.paroquia_id  = p_paroquia_id
      AND cm.criado_em    > now() - interval '10 minutes'
      AND cm.mensagem     = p_mensagem
      AND cm.destinatario_membro_id     IS NOT DISTINCT FROM p_destinatario_membro_id
      AND cm.destinatario_ministerio_id IS NOT DISTINCT FROM p_destinatario_ministerio_id
      AND cm.destinatario_escala_id     IS NOT DISTINCT FROM p_destinatario_escala_id
      AND cm.destinatario_atuacao_id    IS NOT DISTINCT FROM p_destinatario_atuacao_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este mesmo aviso já foi enviado para estes destinatários há menos de 10 minutos.');
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
    AND  nullif(btrim(m.whatsapp_telefone), '') IS NOT NULL
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
            WHEN p_destinatario_atuacao_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM membro_atuacoes ma
        JOIN atuacoes_pastorais ap ON ap.id = ma.atuacao_id
        WHERE ma.membro_id = m.id AND ma.atuacao_id = p_destinatario_atuacao_id
          AND ap.paroquia_id = p_paroquia_id AND ap.ativo = true
      )
ELSE true
    END;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum membro elegível encontrado para este filtro. Verifique consentimento, conta ativada e telefone.');
  END IF;

  IF v_total > c_max_dest THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('O disparo atingiria %s destinatários, acima do limite de %s. Use segmentação por função, atuação ou escala.', v_total, c_max_dest)
    );
  END IF;

  INSERT INTO comunicacao_pastoral_rate_limit (remetente_id, paroquia_id)
  VALUES (v_remetente_id, p_paroquia_id);

  INSERT INTO comunicacao_pastoral_mensagens (
    paroquia_id, remetente_id, mensagem,
    destinatario_membro_id, destinatario_ministerio_id, destinatario_escala_id, destinatario_atuacao_id
  ) VALUES (
    p_paroquia_id, v_remetente_id, p_mensagem,
    p_destinatario_membro_id, p_destinatario_ministerio_id, p_destinatario_escala_id, p_destinatario_atuacao_id
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
      AND  nullif(btrim(m.whatsapp_telefone), '') IS NOT NULL
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


-- SECURITY DEFINER: permitir execução apenas a usuários autenticados; a própria RPC
-- valida papel, vínculo e paróquia antes de qualquer disparo.
REVOKE ALL ON FUNCTION public.coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
