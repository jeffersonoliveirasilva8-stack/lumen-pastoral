-- ============================================================
-- Migration 020: Corrige vazamento de notificações privadas
--               e erro "column user_id does not exist" no perfil
-- Data: 2026-06-13
--
-- PROBLEMAS CORRIGIDOS:
--   1. Notificações de indisponibilidade, falta e ocorrência de escala
--      aparecendo para TODOS os membros da paróquia.
--      Causa: _notify_coordenacao() inseria sem apenas_admin = true.
--      Fix: recria a função com apenas_admin = true no INSERT.
--
--   2. Salvar perfil do membro retornava:
--        column "user_id" does not exist (42703)
--      Causa: migration 014 tinha `WHERE user_id = v_auth_id` para
--      atualizar profiles, mas profiles usa `id` como PK (não user_id).
--      Fix: recria atualizar_perfil_membro() com WHERE id = v_auth_id
--      e adiciona bloco EXCEPTION para robustez.
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE + UPDATE ... WHERE)
-- REQUER: migrations 014, 015 já aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. CORRIGE _notify_coordenacao — adiciona apenas_admin = true
-- ══════════════════════════════════════════════════════════════
-- Chamada por:
--   _trigger_indisponibilidade()  → indisponibilidade registrada
--   _trigger_falta_registrada()   → falta/atraso na escala
--   _trigger_ocorrencia_escala()  → ocorrência registrada na escala
--
-- Antes desta correção, todas essas notificações tinham
-- apenas_admin = false (valor padrão) e destinatario_id = NULL
-- → visíveis para TODOS os membros da paróquia.
-- Após: visíveis apenas para a coordenação (apenas_admin = true).

CREATE OR REPLACE FUNCTION public._notify_coordenacao(
  p_paroquia_id uuid,
  p_titulo      text,
  p_mensagem    text,
  p_tipo        text DEFAULT 'alerta'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.notificacoes
    (paroquia_id, titulo, mensagem, tipo, lida, apenas_admin)
  VALUES
    (p_paroquia_id, p_titulo, p_mensagem, p_tipo, false, true);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. MIGRA notificações históricas vazadas
-- ══════════════════════════════════════════════════════════════
-- Notificações de coordenação já inseridas sem apenas_admin=true:
--   - sobre indisponibilidade (contém "Indisponibilidade:")
--   - sobre falta/ausência/atraso (contém "Falta:", "Ausência:", "Atraso:")
--   - sobre ocorrência de escala (contém "Ocorrência:")
-- → marcar retroativamente como apenas_admin = true

UPDATE public.notificacoes
SET apenas_admin = true
WHERE apenas_admin = false
  AND destinatario_id IS NULL
  AND (
    titulo ILIKE 'Indisponibilidade:%'
    OR titulo ILIKE 'Falta:%'
    OR titulo ILIKE 'Ausência:%'
    OR titulo ILIKE 'Atraso:%'
    OR titulo ILIKE 'Ocorrência:%'
    OR link_referencia = '/ocorrencias'
  );

-- ══════════════════════════════════════════════════════════════
-- 3. CORRIGE atualizar_perfil_membro — WHERE id (não user_id)
-- ══════════════════════════════════════════════════════════════
-- A migration 014 gerava:
--   ERROR: column "user_id" does not exist (42703)
-- porque tentava: UPDATE profiles SET ... WHERE user_id = v_auth_id
-- mas profiles usa `id` como PK, não `user_id`.
--
-- Esta versão:
--   a) Usa WHERE id = v_auth_id para a sync de profiles
--   b) Envolve o sync de profiles em EXCEPTION handler (não-fatal)
--   c) Mantém toda a lógica de atualização da tabela membros

DROP FUNCTION IF EXISTS public.atualizar_perfil_membro(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.atualizar_perfil_membro(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.atualizar_perfil_membro(
  p_nome                TEXT     DEFAULT NULL,
  p_telefone            TEXT     DEFAULT NULL,
  p_data_nascimento     DATE     DEFAULT NULL,
  p_cpf                 TEXT     DEFAULT NULL,
  p_rg                  TEXT     DEFAULT NULL,
  p_endereco            TEXT     DEFAULT NULL,
  p_cidade              TEXT     DEFAULT NULL,
  p_cep                 TEXT     DEFAULT NULL,
  p_nome_pai            TEXT     DEFAULT NULL,
  p_nome_mae            TEXT     DEFAULT NULL,
  p_nome_emergencia     TEXT     DEFAULT NULL,
  p_telefone_emergencia TEXT     DEFAULT NULL,
  p_observacoes         TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_membro_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_nome IS NOT NULL AND length(trim(p_nome)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_obrigatorio');
  END IF;

  -- Localiza o membro por auth_user_id ou email
  SELECT id INTO v_membro_id FROM public.membros
  WHERE auth_user_id = v_auth_id AND ativo = true
  LIMIT 1;

  IF v_membro_id IS NULL THEN
    SELECT id INTO v_membro_id FROM public.membros
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(COALESCE(auth.email(), '')))
      AND ativo = true
    LIMIT 1;
  END IF;

  IF v_membro_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'membro_not_found');
  END IF;

  -- Atualiza membros (preserva valores existentes quando parâmetro é NULL)
  UPDATE public.membros SET
    nome                = COALESCE(NULLIF(TRIM(p_nome), ''),  nome),
    telefone            = CASE WHEN p_telefone            IS NOT NULL THEN p_telefone            ELSE telefone            END,
    data_nascimento     = CASE WHEN p_data_nascimento     IS NOT NULL THEN p_data_nascimento     ELSE data_nascimento     END,
    cpf                 = CASE WHEN p_cpf                 IS NOT NULL THEN p_cpf                 ELSE cpf                 END,
    rg                  = CASE WHEN p_rg                  IS NOT NULL THEN p_rg                  ELSE rg                  END,
    endereco            = CASE WHEN p_endereco            IS NOT NULL THEN p_endereco            ELSE endereco            END,
    cidade              = CASE WHEN p_cidade              IS NOT NULL THEN p_cidade              ELSE cidade              END,
    cep                 = CASE WHEN p_cep                 IS NOT NULL THEN p_cep                 ELSE cep                 END,
    nome_pai            = CASE WHEN p_nome_pai            IS NOT NULL THEN p_nome_pai            ELSE nome_pai            END,
    nome_mae            = CASE WHEN p_nome_mae            IS NOT NULL THEN p_nome_mae            ELSE nome_mae            END,
    nome_emergencia     = CASE WHEN p_nome_emergencia     IS NOT NULL THEN p_nome_emergencia     ELSE nome_emergencia     END,
    telefone_emergencia = CASE WHEN p_telefone_emergencia IS NOT NULL THEN p_telefone_emergencia ELSE telefone_emergencia END,
    observacoes         = CASE WHEN p_observacoes         IS NOT NULL THEN p_observacoes         ELSE observacoes         END,
    updated_at          = now()
  WHERE id = v_membro_id;

  -- Sincroniza nome em profiles (profiles.id = auth.uid(), não user_id)
  -- Envolto em bloco de exceção: se a coluna nome_completo não existir
  -- ou o profiles row não existir, a operação principal já foi concluída.
  BEGIN
    IF p_nome IS NOT NULL AND length(trim(p_nome)) > 0 THEN
      UPDATE public.profiles
        SET nome_completo = TRIM(p_nome),
            updated_at    = now()
      WHERE id = v_auth_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- sync de profiles é não-crítico; não interrompe o save
  END;

  RETURN jsonb_build_object('success', true, 'membro_id', v_membro_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_perfil_membro(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- AUDITORIA DE CLASSIFICAÇÃO DE NOTIFICAÇÕES
-- ─────────────────────────────────────────────────────────────
--
-- Tipo | Destinatários | Tabela | Policy | apenas_admin | destinatario_id
-- ─────────────────────────────────────────────────────────────────────────
-- Escala atribuída ao membro       | Privada      | notificacoes | notif_membro_read | false | = membro_id
--   Criada por: _notify_escala_membro() (trigger insert escala_membros)
--
-- Ocorrência criada pelo membro    | Coordenação  | notificacoes | notif_membro_read | true  | NULL
--   Criada por: _notify_ocorrencia_membro() (trigger insert ocorrencias_membros)
--
-- Ocorrência respondida/status     | Privada      | notificacoes | notif_membro_read | false | = membro_id
--   Criada por: _notify_ocorrencia_respondida() (trigger update ocorrencias_membros)
--
-- Indisponibilidade registrada     | Coordenação  | notificacoes | notif_membro_read | true  | NULL
--   Criada por: _trigger_indisponibilidade() → _notify_coordenacao() (CORRIGIDO AQUI)
--
-- Falta/atraso na escala           | Coordenação  | notificacoes | notif_membro_read | true  | NULL
--   Criada por: _trigger_falta_registrada() → _notify_coordenacao() (CORRIGIDO AQUI)
--
-- Ocorrência de escala             | Coordenação  | notificacoes | notif_membro_read | true  | NULL
--   Criada por: _trigger_ocorrencia_escala() → _notify_coordenacao() (CORRIGIDO AQUI)
--
-- Evento criado (broadcast)        | Broadcast    | notificacoes | notif_membro_read | false | NULL
--   Criada por: _trigger_evento_criado() → _notify_all_membros()
--   → Correto: todos membros devem ver comunicados de eventos
--
-- Comunicado admin manual          | Broadcast    | notificacoes | notif_membro_read | false | NULL
--   Criado por: admin no painel → INSERT manual
--   → Correto: broadcast intencional pelo admin
--
-- Notificação admin-only manual    | Coordenação  | notificacoes | notif_membro_read | true  | NULL
--   Criada por: admin no painel com apenas_admin = true
--
-- Atualização cadastral            | Sistema      | notificacoes | notif_membro_read | false | = membro_id
--   A criar: quando admin altera dados do membro → notificar o próprio membro
--
-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Membro A não vê indisponibilidade do Membro B
--   ✓ Membro A não vê falta/atraso do Membro B
--   ✓ Membro A não vê ocorrência de escala do Membro B
--   ✓ Admin AINDA vê todas essas notificações (apenas_admin=true)
--   ✓ Membro vê sua própria escala atribuída (destinatario_id = seu id)
--   ✓ Salvar perfil não retorna column "user_id" does not exist
--   ✓ Nome atualizado no perfil reflete no painel admin
-- ─────────────────────────────────────────────────────────────
