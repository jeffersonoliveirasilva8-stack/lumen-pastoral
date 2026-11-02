-- migration 173: WhatsApp para escala completa
-- Envia WhatsApp a todos os membros quando TODOS os slots de escala_funcoes
-- forem preenchidos E a escala estiver publicada.
--
-- NÃO duplica a notificação de escala_publicada:
--   escala_publicada → disparado ao mudar status para "publicada"
--   escala_completa  → disparado quando o último slot é preenchido
--     (pode ocorrer antes ou depois da publicação, mas só notifica se publicada)

-- ── Helper: verifica se todos os slots estão preenchidos ─────────────────────

CREATE OR REPLACE FUNCTION _escala_esta_completa(p_escala_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    -- toda função definida em escala_funcoes...
    NOT EXISTS (
      SELECT 1
      FROM   escala_funcoes ef
      WHERE  ef.escala_id = p_escala_id
        AND  ef.quantidade > (
          -- ...tem membros ativos suficientes
          SELECT COUNT(*)
          FROM   escala_membros em
          WHERE  em.escala_id    = p_escala_id
            AND  em.ministerio_id = ef.ministerio_id
            AND  em.ativo IS NOT FALSE
        )
    )
    -- e existe pelo menos uma função definida
    AND EXISTS (
      SELECT 1 FROM escala_funcoes WHERE escala_id = p_escala_id
    )
$$;

-- ── Função de trigger: membro adicionado/reativado ───────────────────────────
-- Dispara quando escala_membros é INSERT/UPDATE e a escala está publicada.
-- Envia apenas se a escala acabou de ficar completa (dedup via whatsapp_sends).

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_membros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escala        record;
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  -- Só processa INSERT ou UPDATE que (re)ative o membro
  IF TG_OP = 'UPDATE' AND (NEW.ativo IS NOT TRUE OR OLD.ativo IS NOT FALSE) THEN
    -- Ignora atualizações que não sejam reativações
    -- (ativo FALSE→TRUE é reativação; qualquer outra mudança sem reativação ignora)
    IF NOT (OLD.ativo IS FALSE AND NEW.ativo IS NOT FALSE) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Verifica se a escala está publicada
  SELECT e.id, e.titulo, e.data, e.hora_inicio, e.local, e.paroquia_id, e.status
  INTO   v_escala
  FROM   escalas e
  WHERE  e.id     = NEW.escala_id
    AND  e.status = 'publicada';

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Verifica se a escala acabou de ficar completa
  IF NOT _escala_esta_completa(NEW.escala_id) THEN
    RETURN NEW;
  END IF;

  -- Busca nome da paróquia
  SELECT nome INTO v_paroquia_nome
  FROM   paroquias
  WHERE  id = v_escala.paroquia_id;

  -- Busca secret para autenticar chamada ao send-whatsapp
  SELECT val INTO v_wa_secret
  FROM   _push_config
  WHERE  key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RETURN NEW;
  END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  -- Envia para todos os membros ativos desta escala com whatsapp_opt_in=true
  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.escala_id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',    v_membro.membro_id,
      'paroquia_id',  v_escala.paroquia_id,
      'evento_tipo',  'escala_completa',
      'evento_ref_id', v_escala.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                              THEN left(v_escala.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         v_escala.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
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
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Trigger em escala_membros ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_membros ON escala_membros;

CREATE TRIGGER trg_whatsapp_escala_completa_membros
  AFTER INSERT OR UPDATE OF ativo, ministerio_id
  ON escala_membros
  FOR EACH ROW
  EXECUTE FUNCTION _trg_fn_whatsapp_escala_completa_membros();

-- ── Função de trigger: escala publicada quando já está completa ───────────────
-- Caso a escala seja publicada DEPOIS de todos os slots já estarem preenchidos,
-- este trigger garante que a notificação escala_completa seja enviada.

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_publicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  -- Só processa transição para 'publicada'
  IF OLD.status = 'publicada' OR NEW.status != 'publicada' THEN
    RETURN NEW;
  END IF;

  -- Verifica se a escala está completa no momento da publicação
  IF NOT _escala_esta_completa(NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO v_paroquia_nome
  FROM   paroquias
  WHERE  id = NEW.paroquia_id;

  SELECT val INTO v_wa_secret
  FROM   _push_config
  WHERE  key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RETURN NEW;
  END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',     v_membro.membro_id,
      'paroquia_id',   NEW.paroquia_id,
      'evento_tipo',   'escala_completa',
      'evento_ref_id', NEW.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(NEW.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN NEW.hora_inicio IS NOT NULL
                              THEN left(NEW.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         NEW.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
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
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_publicacao ON escalas;

CREATE TRIGGER trg_whatsapp_escala_completa_publicacao
  AFTER UPDATE OF status
  ON escalas
  FOR EACH ROW
  EXECUTE FUNCTION _trg_fn_whatsapp_escala_completa_publicacao();

-- ── Função de trigger: redução de vagas em escala_funcoes ────────────────────
-- Quando a quantidade de uma função é reduzida numa escala publicada,
-- a escala pode tornar-se completa sem INSERT/UPDATE em escala_membros.
-- Este trigger reutiliza _trg_fn_whatsapp_escala_completa_publicacao mas
-- no contexto da escala que contém a função alterada.

CREATE OR REPLACE FUNCTION _trg_fn_whatsapp_escala_completa_funcoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escala        record;
  v_paroquia_nome text;
  v_wa_secret     text;
  v_url           text;
  v_membro        record;
  v_payload       jsonb;
  v_link          text;
BEGIN
  -- Só processa redução de quantidade
  IF TG_OP = 'UPDATE' AND NEW.quantidade >= OLD.quantidade THEN
    RETURN NEW;
  END IF;
  -- INSERT com quantidade 0 também pode completar (função opcional)
  -- mas nesse caso escala_membros ainda está vazia — deixa o trigger de membros agir.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Verifica se a escala está publicada
  SELECT e.id, e.titulo, e.data, e.hora_inicio, e.local, e.paroquia_id, e.status
  INTO   v_escala
  FROM   escalas e
  WHERE  e.id     = NEW.escala_id
    AND  e.status = 'publicada';

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Verifica se a escala ficou completa após a redução
  IF NOT _escala_esta_completa(NEW.escala_id) THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO v_paroquia_nome
  FROM   paroquias
  WHERE  id = v_escala.paroquia_id;

  SELECT val INTO v_wa_secret
  FROM   _push_config
  WHERE  key = 'internal_wa_secret';

  IF v_wa_secret IS NULL THEN
    RETURN NEW;
  END IF;

  v_url  := _cfg_supabase_url() || '/functions/v1/send-whatsapp';
  v_link := 'https://lumenpastoral.com.br/portal-membro/escalas';

  FOR v_membro IN
    SELECT
      m.id          AS membro_id,
      m.nome        AS nome_membro,
      min2.nome     AS ministerio_nome
    FROM  escala_membros em
    JOIN  membros      m    ON m.id = em.membro_id
    JOIN  ministerios  min2 ON min2.id = em.ministerio_id
    WHERE em.escala_id = NEW.escala_id
      AND em.ativo IS NOT FALSE
      AND m.whatsapp_opt_in   = true
      AND m.whatsapp_telefone IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'membro_id',     v_membro.membro_id,
      'paroquia_id',   v_escala.paroquia_id,
      'evento_tipo',   'escala_completa',
      'evento_ref_id', v_escala.id,
      'context', jsonb_build_object(
        'nome_membro',   v_membro.nome_membro,
        'data_escala',   to_char(v_escala.data, 'DD/MM/YYYY'),
        'hora_escala',   CASE WHEN v_escala.hora_inicio IS NOT NULL
                              THEN left(v_escala.hora_inicio::text, 5) END,
        'ministerio',    v_membro.ministerio_nome,
        'local',         v_escala.local,
        'paroquia_nome', v_paroquia_nome,
        'link_escala',   v_link
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
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_escala_completa_funcoes ON escala_funcoes;

CREATE TRIGGER trg_whatsapp_escala_completa_funcoes
  AFTER UPDATE OF quantidade
  ON escala_funcoes
  FOR EACH ROW
  EXECUTE FUNCTION _trg_fn_whatsapp_escala_completa_funcoes();

-- ── Aplicação ─────────────────────────────────────────────────────────────────
-- Aplicar via: supabase db push  (CLI com banco local ou staging)
-- Ou via SQL Editor do Dashboard na ordem: 173 → 174 → (175 manualmente)
-- O Supabase CLI rastreia migrations pelo nome do arquivo — não há INSERT manual.
