-- migration 174: Módulo Comunicação Pastoral
-- Tabelas para avisos individuais e coletivos via WhatsApp pela coordenação.

-- ── Tabela de mensagens enviadas ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comunicacao_pastoral_mensagens (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  paroquia_id   UUID    NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  remetente_id  UUID    NOT NULL REFERENCES membros(id)   ON DELETE RESTRICT,
  mensagem      TEXT    NOT NULL CHECK (char_length(mensagem) BETWEEN 1 AND 1000),
  -- Segmentação: um dos três deve ser preenchido (ou nenhum = todos membros)
  destinatario_membro_id   UUID REFERENCES membros(id)     ON DELETE SET NULL,
  destinatario_ministerio_id UUID REFERENCES ministerios(id) ON DELETE SET NULL,
  destinatario_escala_id   UUID REFERENCES escalas(id)      ON DELETE SET NULL,
  -- Totais calculados após envio
  total_destinatarios INT     NOT NULL DEFAULT 0,
  total_enviados      INT     NOT NULL DEFAULT 0,
  total_falhas        INT     NOT NULL DEFAULT 0,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_apenas_um_segmento CHECK (
    (
      (destinatario_membro_id     IS NOT NULL)::int +
      (destinatario_ministerio_id IS NOT NULL)::int +
      (destinatario_escala_id     IS NOT NULL)::int
    ) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_cp_mensagens_paroquia   ON comunicacao_pastoral_mensagens(paroquia_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cp_mensagens_remetente  ON comunicacao_pastoral_mensagens(remetente_id);

-- ── Tabela de destinatários individuais ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS comunicacao_pastoral_destinatarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id  UUID NOT NULL REFERENCES comunicacao_pastoral_mensagens(id) ON DELETE CASCADE,
  membro_id    UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  -- Status retornado pela Edge Function ou pela RPC quando gate bloqueia.
  -- 'unknown' = provider não confirmou nem negou (timeout); não implica falha.
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','enviado','pulado','falha','unknown')),
  motivo       TEXT,  -- motivo de pulado/falha
  sends_id     UUID,  -- id em whatsapp_sends se enviado
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mensagem_id, membro_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_destinatarios_mensagem ON comunicacao_pastoral_destinatarios(mensagem_id);
CREATE INDEX IF NOT EXISTS idx_cp_destinatarios_membro   ON comunicacao_pastoral_destinatarios(membro_id);
-- Consultado pelo frontend para filtrar por status no histórico
CREATE INDEX IF NOT EXISTS idx_cp_destinatarios_status   ON comunicacao_pastoral_destinatarios(mensagem_id, status);

-- ── Índice de performance em whatsapp_sends ───────────────────────────────────
-- Usado pelo trigger trg_cp_sync_send_status para localizar o destinatário
-- correspondente. Sem este índice, cada UPDATE em whatsapp_sends faz seq-scan.
CREATE INDEX IF NOT EXISTS idx_ws_evento_ref_membro
  ON whatsapp_sends(evento_ref_id, membro_id)
  WHERE evento_tipo = 'aviso_pastoral';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE comunicacao_pastoral_mensagens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicacao_pastoral_destinatarios ENABLE ROW LEVEL SECURITY;

-- Coordenadores veem mensagens da sua paróquia
CREATE POLICY "coord_select_mensagens" ON comunicacao_pastoral_mensagens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.auth_user_id = auth.uid()
        AND m.paroquia_id  = comunicacao_pastoral_mensagens.paroquia_id
        AND m.tipo_acesso  IN ('auxiliar','vice','coordenador','administrador')
        AND m.ativo        = true
    )
  );

CREATE POLICY "coord_insert_mensagens" ON comunicacao_pastoral_mensagens
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros m
      WHERE m.auth_user_id = auth.uid()
        AND m.paroquia_id  = comunicacao_pastoral_mensagens.paroquia_id
        AND m.tipo_acesso  IN ('auxiliar','vice','coordenador','administrador')
        AND m.ativo        = true
    )
  );

CREATE POLICY "coord_select_destinatarios" ON comunicacao_pastoral_destinatarios
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   comunicacao_pastoral_mensagens cpm
      JOIN   membros m ON m.auth_user_id = auth.uid()
               AND m.paroquia_id = cpm.paroquia_id
               AND m.tipo_acesso IN ('auxiliar','vice','coordenador','administrador')
               AND m.ativo = true
      WHERE  cpm.id = comunicacao_pastoral_destinatarios.mensagem_id
    )
  );

-- Apenas service_role pode inserir/atualizar destinatários diretamente.
-- RPCs com SECURITY DEFINER (dono = postgres) contornam o RLS corretamente.
CREATE POLICY "service_insert_destinatarios" ON comunicacao_pastoral_destinatarios
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_update_destinatarios" ON comunicacao_pastoral_destinatarios
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── Rate limiting por coordenador ─────────────────────────────────────────────
-- Registra cada disparo para limitar a 3 por hora por remetente por paróquia.
-- A tabela é pequena; linhas expiradas são limpas pela RPC antes de inserir.

CREATE TABLE IF NOT EXISTS comunicacao_pastoral_rate_limit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remetente_id UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  paroquia_id  UUID NOT NULL REFERENCES paroquias(id) ON DELETE CASCADE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_rate_limit_remetente
  ON comunicacao_pastoral_rate_limit(remetente_id, paroquia_id, criado_em DESC);

ALTER TABLE comunicacao_pastoral_rate_limit ENABLE ROW LEVEL SECURITY;
-- Somente a RPC (SECURITY DEFINER) escreve e lê esta tabela
CREATE POLICY "deny_all_rate_limit" ON comunicacao_pastoral_rate_limit
  AS RESTRICTIVE FOR ALL USING (false);

-- ── RPC: coord_enviar_aviso_pastoral ─────────────────────────────────────────
-- Chamado pelo frontend da coordenação. Resolve destinatários, insere registros
-- e chama send-whatsapp para cada um via pg_net.
--
-- Limites de segurança:
--   MAX_DESTINATARIOS = 200 por disparo
--   MAX_DISPAROS_HORA = 3 por remetente × paróquia (janela deslizante de 1h)

CREATE OR REPLACE FUNCTION coord_enviar_aviso_pastoral(
  p_paroquia_id               uuid,
  p_mensagem                  text,
  p_destinatario_membro_id    uuid DEFAULT NULL,
  p_destinatario_ministerio_id uuid DEFAULT NULL,
  p_destinatario_escala_id    uuid DEFAULT NULL
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
  -- Limites configuráveis via constantes
  c_max_dest       constant int := 200;
  c_max_hora       constant int := 3;
BEGIN
  -- Valida remetente
  SELECT m.id, m.nome INTO v_remetente_id, v_remetente_nome
  FROM   membros m
  WHERE  m.auth_user_id = auth.uid()
    AND  m.paroquia_id  = p_paroquia_id
    AND  m.tipo_acesso  IN ('auxiliar','vice','coordenador','administrador')
    AND  m.ativo        = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para enviar avisos pastorais');
  END IF;

  -- Rate limiting: limpa entradas expiradas (> 1h) e conta as recentes
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

  SELECT nome INTO v_paroquia_nome
  FROM   paroquias
  WHERE  id = p_paroquia_id;

  SELECT val INTO v_wa_secret
  FROM   _push_config
  WHERE  key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WhatsApp não configurado');
  END IF;

  -- Conta destinatários antes de criar a mensagem para validar o limite
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
      ELSE true
    END;

  IF v_total > c_max_dest THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format('O disparo atingiria %s destinatários, acima do limite de %s. Use segmentação por ministério ou escala.', v_total, c_max_dest)
    );
  END IF;

  -- Registra este disparo no rate limiter ANTES de criar a mensagem
  INSERT INTO comunicacao_pastoral_rate_limit (remetente_id, paroquia_id)
  VALUES (v_remetente_id, p_paroquia_id);

  -- Cria registro da mensagem
  INSERT INTO comunicacao_pastoral_mensagens (
    paroquia_id, remetente_id, mensagem,
    destinatario_membro_id, destinatario_ministerio_id, destinatario_escala_id
  ) VALUES (
    p_paroquia_id, v_remetente_id, p_mensagem,
    p_destinatario_membro_id, p_destinatario_ministerio_id, p_destinatario_escala_id
  )
  RETURNING id INTO v_mensagem_id;

  v_url   := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_total := 0;

  -- Resolve destinatários e dispara
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
        ELSE true
      END
  LOOP
    -- Registra destinatário como pending
    INSERT INTO comunicacao_pastoral_destinatarios (mensagem_id, membro_id)
    VALUES (v_mensagem_id, v_membro.id)
    ON CONFLICT (mensagem_id, membro_id) DO NOTHING;

    -- Dispara envio via pg_net (assíncrono)
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
      body    := v_payload::text
    );

    v_total := v_total + 1;
  END LOOP;

  -- Atualiza total_destinatarios
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

GRANT EXECUTE ON FUNCTION coord_enviar_aviso_pastoral(uuid, text, uuid, uuid, uuid) TO authenticated;

-- ── Trigger: whatsapp_sends → comunicacao_pastoral_destinatarios ──────────────
-- Sincroniza o status de cada destinatário quando o envio WhatsApp é concluído.
-- Também propaga motivo quando o status for 'unknown' (timeout do provider).
-- O índice idx_ws_evento_ref_membro garante que este UPDATE seja eficiente.

CREATE OR REPLACE FUNCTION _trg_fn_cp_sync_send_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.evento_tipo <> 'aviso_pastoral' THEN
    RETURN NEW;
  END IF;

  -- 'unknown' em whatsapp_sends = timeout do provider; entrega incerta.
  -- NÃO converte para 'falha' — preserva incerteza para reconciliação futura.
  -- 'unknown' bloqueia reenvio via dedup (registro pending permanece em whatsapp_sends).
  UPDATE comunicacao_pastoral_destinatarios
  SET
    status   = CASE NEW.status
                 WHEN 'sent'    THEN 'enviado'
                 WHEN 'failed'  THEN 'falha'
                 WHEN 'unknown' THEN 'unknown'
                 ELSE 'pending'
               END,
    motivo   = CASE NEW.status
                 WHEN 'failed'  THEN COALESCE(NEW.resposta_body, 'falha_provider')
                 WHEN 'unknown' THEN 'timeout_provider'
                 ELSE NULL
               END,
    sends_id = NEW.id
  WHERE mensagem_id = NEW.evento_ref_id
    AND membro_id   = NEW.membro_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cp_sync_send_status
AFTER INSERT OR UPDATE OF status ON whatsapp_sends
FOR EACH ROW EXECUTE FUNCTION _trg_fn_cp_sync_send_status();

-- ── Trigger: comunicacao_pastoral_destinatarios → mensagens (totais) ──────────
-- Recalcula total_enviados e total_falhas na mensagem pai quando o status muda.
-- Usa COUNT(*) — idempotente e correto mesmo em múltiplas atualizações do mesmo row.

CREATE OR REPLACE FUNCTION _trg_fn_cp_update_totais()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_msg_id uuid := COALESCE(NEW.mensagem_id, OLD.mensagem_id);
BEGIN
  UPDATE comunicacao_pastoral_mensagens
  SET
    total_enviados = (
      SELECT COUNT(*) FROM comunicacao_pastoral_destinatarios
      WHERE mensagem_id = v_msg_id AND status = 'enviado'
    ),
    total_falhas = (
      SELECT COUNT(*) FROM comunicacao_pastoral_destinatarios
      WHERE mensagem_id = v_msg_id AND status IN ('falha')
    )
  WHERE id = v_msg_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cp_update_totais
AFTER UPDATE OF status ON comunicacao_pastoral_destinatarios
FOR EACH ROW EXECUTE FUNCTION _trg_fn_cp_update_totais();

-- ── RPC: cp_marcar_pulado ─────────────────────────────────────────────────────
-- Chamada pela Edge Function send-whatsapp quando o gate bloqueia o envio
-- (sem consentimento, dedup, membro inativo). Atualiza o destinatário para
-- 'pulado' com o motivo, sem criar registro em whatsapp_sends.
--
-- Chamada com service_role — nunca exposta ao frontend.

CREATE OR REPLACE FUNCTION cp_marcar_pulado(
  p_mensagem_id uuid,
  p_membro_id   uuid,
  p_motivo      text DEFAULT 'bloqueado'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comunicacao_pastoral_destinatarios
  SET    status = 'pulado',
         motivo = p_motivo
  WHERE  mensagem_id = p_mensagem_id
    AND  membro_id   = p_membro_id
    AND  status      = 'pending';
  -- Sem RETURNING; se não encontrar row, apenas não faz nada (idempotente).
END;
$$;

-- Apenas service_role pode chamar — não expor ao authenticated/anon
-- (Supabase tem DEFAULT PRIVILEGES que concedem EXECUTE a authenticated e anon
--  automaticamente; é necessário revogar explicitamente de cada role.)
REVOKE EXECUTE ON FUNCTION cp_marcar_pulado(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cp_marcar_pulado(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION cp_marcar_pulado(uuid, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION cp_marcar_pulado(uuid, uuid, text) TO service_role;

-- ── RPC: cp_reconciliar_pending ───────────────────────────────────────────────
-- Move destinatários 'pending' mais antigos que p_janela para 'unknown',
-- indicando que a entrega é incerta e requer verificação manual.
--
-- NÃO usa 'pulado' (que significa bloqueio intencional pelo gate) nem 'falha'
-- (que implica certeza de não-entrega). 'unknown' preserva a ambiguidade.
--
-- O registro correspondente em whatsapp_sends (se existir com status 'pending')
-- continua bloqueando reenvio automático via dedup — reconciliar não autoriza
-- retentativa; isso requer ação manual explícita.
--
-- Uso manual (somente service_role, nunca em banco de produção como dry-run):
--   SELECT * FROM cp_reconciliar_pending();
--   SELECT * FROM cp_reconciliar_pending(interval '4 hours');

CREATE OR REPLACE FUNCTION cp_reconciliar_pending(
  p_janela interval DEFAULT interval '2 hours'
)
RETURNS TABLE(mensagem_id uuid, membro_id uuid, motivo text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE comunicacao_pastoral_destinatarios d
  SET    status = 'unknown',
         motivo = 'timeout_reconciliacao'
  FROM   comunicacao_pastoral_mensagens m
  WHERE  d.mensagem_id = m.id
    AND  d.status      = 'pending'
    AND  m.criado_em   < now() - p_janela
  RETURNING d.mensagem_id, d.membro_id, d.motivo;
END;
$$;

REVOKE EXECUTE ON FUNCTION cp_reconciliar_pending(interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cp_reconciliar_pending(interval) FROM authenticated;
REVOKE EXECUTE ON FUNCTION cp_reconciliar_pending(interval) FROM anon;
GRANT  EXECUTE ON FUNCTION cp_reconciliar_pending(interval) TO service_role;

-- ── Aplicação ─────────────────────────────────────────────────────────────────
-- Aplicar via: supabase db push  (CLI com banco local ou staging)
-- Ou via SQL Editor do Dashboard na ordem: 173 → 174 → (175 manualmente)
-- O Supabase CLI rastreia migrations pelo nome do arquivo — não há INSERT manual.

NOTIFY pgrst, 'reload schema';
