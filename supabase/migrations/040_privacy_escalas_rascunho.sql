-- ============================================================
-- Migration 040: Correção de privacidade — escalas rascunho
-- Data: 2026-06-15
--
-- CAUSA RAIZ IDENTIFICADA:
--   As políticas originais da migration 001 (escalas_paroquia,
--   escala_membros_paroquia, escala_funcoes_paroquia) foram
--   criadas com FOR ALL USING (paroquia_id = current_paroquia_id())
--   sem nunca serem substituídas.
--
--   Como membros ativados têm profiles.paroquia_id definido
--   (criado pelas migrations 011/012 para current_paroquia_id()
--   funcionar), QUALQUER membro autenticado passa por essas
--   policies e VÊ TODOS OS RASCUNHOS da sua paróquia.
--
--   As policies corretas adicionadas em 002 e 010 são ineficazes
--   porque o PostgreSQL RLS combina policies permissivas com OR —
--   a policy aberta de 001 sempre concede acesso primeiro.
--
-- SOLUÇÃO:
--   1. Dropar as 3 policies overbroad de 001
--   2. Criar policies segregadas: admin/coord (tudo) | membro (publicada)
--   3. Corrigir RPCs SECURITY DEFINER do portal token (002+)
--   4. Bloquear resposta de membros a escalas não publicadas
--
-- REGRA OBRIGATÓRIA:
--   Membros nunca veem, recebem notificações ou interagem com
--   escalas que não estejam com status = 'publicada'.
--
-- IDEMPOTENTE: sim (DROP IF EXISTS / CREATE OR REPLACE)
-- REQUER: migrations 001–039 aplicadas
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. TABLE: escalas — corrigir policies
-- ══════════════════════════════════════════════════════════════

-- Remove a policy original overbroad que concedia acesso a
-- rascunhos para qualquer membro com profiles.paroquia_id.
DROP POLICY IF EXISTS "escalas_paroquia" ON public.escalas;

-- Admin (super_admin / admin_paroquial / lider via user_roles): acesso total
DROP POLICY IF EXISTS "escalas_admin" ON public.escalas;
CREATE POLICY "escalas_admin" ON public.escalas
  FOR ALL TO authenticated
  USING  (public._portal_is_admin(paroquia_id))
  WITH CHECK (public._portal_is_admin(paroquia_id));

-- Coordenador (tabela coordenadores): acesso total operacional
-- (criação / edição / publicação de escalas)
DROP POLICY IF EXISTS "escalas_coord" ON public.escalas;
CREATE POLICY "escalas_coord" ON public.escalas
  FOR ALL TO authenticated
  USING  (
    public._portal_is_coord(public._portal_membro_id())
    AND paroquia_id = public.current_paroquia_id()
  )
  WITH CHECK (
    public._portal_is_coord(public._portal_membro_id())
    AND paroquia_id = public.current_paroquia_id()
  );

-- Membro comum: somente leitura de escalas publicadas da sua paróquia
-- (escalas_leitura_publica de 002 cobre acesso anônimo / token portal)
DROP POLICY IF EXISTS "escalas_membro_leitura" ON public.escalas;
CREATE POLICY "escalas_membro_leitura" ON public.escalas
  FOR SELECT TO authenticated
  USING (
    paroquia_id = public.current_paroquia_id()
    AND status = 'publicada'
  );

-- ══════════════════════════════════════════════════════════════
-- 2. TABLE: escala_membros — corrigir policies
-- ══════════════════════════════════════════════════════════════

-- Remove a policy original overbroad.
-- As policies corretas de 010 (membro_read_escala_paroquia_full,
-- em_coord_read, em_coord_update) já existem mas eram anuladas por esta.
DROP POLICY IF EXISTS "escala_membros_paroquia" ON public.escala_membros;

-- Admin: acesso completo (INSERT/UPDATE/DELETE para gerenciar escalações)
DROP POLICY IF EXISTS "escala_membros_admin" ON public.escala_membros;
CREATE POLICY "escala_membros_admin" ON public.escala_membros
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND public._portal_is_admin(e.paroquia_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND public._portal_is_admin(e.paroquia_id)
    )
  );

-- Membro: UPDATE apenas no próprio registro em escalas publicadas
-- (confirmar presença, recusar, voltar para pendente)
DROP POLICY IF EXISTS "escala_membros_membro_update" ON public.escala_membros;
CREATE POLICY "escala_membros_membro_update" ON public.escala_membros
  FOR UPDATE TO authenticated
  USING (
    membro_id = public._portal_membro_id()
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  )
  WITH CHECK (
    membro_id = public._portal_membro_id()
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id AND e.status = 'publicada'
    )
  );

-- Nota: as policies de 010 (membro_read_escala_paroquia_full,
-- em_coord_read, em_coord_update) agora são eficazes porque a
-- policy overbroad de 001 foi removida.

-- ══════════════════════════════════════════════════════════════
-- 3. TABLE: escala_funcoes — corrigir policies
-- ══════════════════════════════════════════════════════════════

-- Remove a policy original overbroad.
DROP POLICY IF EXISTS "escala_funcoes_paroquia" ON public.escala_funcoes;

-- Admin: acesso completo (define funções necessárias na escala)
DROP POLICY IF EXISTS "escala_funcoes_admin" ON public.escala_funcoes;
CREATE POLICY "escala_funcoes_admin" ON public.escala_funcoes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND public._portal_is_admin(e.paroquia_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND public._portal_is_admin(e.paroquia_id)
    )
  );

-- Coordenador: acesso completo (cria/edita funções na escala)
DROP POLICY IF EXISTS "escala_funcoes_coord" ON public.escala_funcoes;
CREATE POLICY "escala_funcoes_coord" ON public.escala_funcoes
  FOR ALL TO authenticated
  USING (
    public._portal_is_coord(public._portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = public.current_paroquia_id()
    )
  )
  WITH CHECK (
    public._portal_is_coord(public._portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escalas e
      WHERE e.id = escala_id
        AND e.paroquia_id = public.current_paroquia_id()
    )
  );

-- Nota: escala_funcoes_leitura_publica de 002 continua válida para
-- leitura anônima/token de funções em escalas publicadas.

-- ══════════════════════════════════════════════════════════════
-- 4. RPC portal_get_escalas_membro — FIX CRÍTICO
-- ══════════════════════════════════════════════════════════════
-- SECURITY DEFINER bypassa RLS. A versão anterior filtrava apenas
-- e.status <> 'cancelada', expondo rascunhos via token de acesso.

CREATE OR REPLACE FUNCTION public.portal_get_escalas_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, em.justificativa, em.ministerio_id,
      e.id AS escala_id, e.titulo, e.data, e.hora_inicio, e.hora_fim,
      e.local, e.tipo, e.solene, e.tem_adoracao, e.tem_bispo, e.observacoes,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data >= CURRENT_DATE
      AND e.status = 'publicada'       -- CORREÇÃO: era <> 'cancelada'
    ORDER BY e.data
    LIMIT 20
  ) t;
$$;

-- ══════════════════════════════════════════════════════════════
-- 5. RPC portal_get_historico_membro — FIX CRÍTICO
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_get_historico_membro(p_token UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (t).data DESC), '[]'::json) FROM (
    SELECT
      em.id AS escala_membro_id, em.status, e.titulo, e.data, e.tipo, e.solene,
      mn.nome AS ministerio_nome, mn.cor AS ministerio_cor,
      hp.presenca, hp.pontos
    FROM escala_membros em
    JOIN escalas     e  ON e.id  = em.escala_id
    JOIN ministerios mn ON mn.id = em.ministerio_id
    JOIN membros     m  ON m.id  = em.membro_id
    LEFT JOIN historico_participacoes hp
      ON hp.escala_id = e.id AND hp.membro_id = m.id
    WHERE m.token_acesso = p_token
      AND m.ativo = true
      AND (m.token_acesso_expires_at IS NULL OR m.token_acesso_expires_at > now())
      AND e.data < CURRENT_DATE
      AND e.status = 'publicada'       -- CORREÇÃO: filtro ausente anteriormente
    ORDER BY e.data DESC
    LIMIT 30
  ) t;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. RPC portal_responder_escala — FIX COMPLEMENTAR
-- ══════════════════════════════════════════════════════════════
-- Impede que um membro responda a escalas não publicadas,
-- mesmo que obtenha o escala_membro_id por outros meios.

CREATE OR REPLACE FUNCTION public.portal_responder_escala(
  p_token             UUID,
  p_escala_membro_id  UUID,
  p_status            TEXT,
  p_justificativa     TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_membro_id     UUID;
  v_escala_status TEXT;
BEGIN
  SELECT id INTO v_membro_id
  FROM membros
  WHERE token_acesso = p_token
    AND ativo = true
    AND (token_acesso_expires_at IS NULL OR token_acesso_expires_at > now());

  IF v_membro_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou expirado';
  END IF;

  SELECT e.status INTO v_escala_status
  FROM escala_membros em
  JOIN escalas e ON e.id = em.escala_id
  WHERE em.id = p_escala_membro_id AND em.membro_id = v_membro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escalação não encontrada';
  END IF;

  IF v_escala_status <> 'publicada' THEN
    RAISE EXCEPTION 'Escala não disponível para resposta';
  END IF;

  UPDATE escala_membros
  SET status = p_status, justificativa = p_justificativa
  WHERE id = p_escala_membro_id AND membro_id = v_membro_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 7. Invalida cache PostgREST
-- ══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ Membro autenticado: SELECT em escalas retorna APENAS publicadas
--   ✓ Membro autenticado: SELECT em escala_membros retorna APENAS publicadas
--   ✓ Admin: SELECT em escalas retorna tudo (rascunho inclusive)
--   ✓ Coordenador: SELECT em escalas retorna tudo (rascunho inclusive)
--   ✓ portal_get_escalas_membro  → apenas status='publicada'
--   ✓ portal_get_historico_membro → apenas status='publicada'
--   ✓ portal_responder_escala    → bloqueia rascunhos
--   ✓ Membros NÃO podem inserir/deletar escala_membros
--   ✓ Membros SÓ podem alterar o próprio status em escalas publicadas
--
-- QUERY DE VERIFICAÇÃO (executar no Supabase SQL editor):
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('escalas', 'escala_membros', 'escala_funcoes')
--   ORDER BY tablename, policyname;
--
-- Não deve existir:
--   "escalas_paroquia", "escala_membros_paroquia", "escala_funcoes_paroquia"
-- ─────────────────────────────────────────────────────────────
