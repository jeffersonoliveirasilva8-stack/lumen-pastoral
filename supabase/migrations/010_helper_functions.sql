-- ============================================================
-- Migration 010: Funções Helper de Segurança (RLS)
-- Data: 2026-06-11
--
-- OBJETIVO:
--   Formalizar as funções SECURITY DEFINER que são pré-requisito para
--   todas as policies RLS do sistema. Anteriormente existiam apenas em
--   scripts ad-hoc (APLICAR_NO_SUPABASE.sql, DEFINITIVO_FIX.sql).
--
-- ATENÇÃO — ORDEM DE APLICAÇÃO:
--   Esta migration DEVE ser aplicada ANTES de 006_rls_gaps.sql e
--   009_audit_log.sql, pois ambas referenciam current_paroquia_id().
--   Em um ambiente fresco, execute na ordem:
--     010 → 001 → 002 → ... → 009
--   (ou aplique 010 manualmente antes de rodar as migrations formais).
--
-- SEGURANÇA:
--   Todas as funções usam SECURITY DEFINER + SET search_path = public.
--   Isso evita search_path injection e permite que as funções sejam
--   chamadas por policies RLS (que rodam no contexto do chamador).
--
-- IDEMPOTENTE: sim (CREATE OR REPLACE FUNCTION)
-- ============================================================

-- ── 1. current_paroquia_id() ──────────────────────────────────────────────────
--
-- Retorna o paroquia_id do usuário autenticado lendo de profiles.
-- Usada em: 006_rls_gaps (tipos_prioridade, formacoes_eventos, presencas_eventos,
--            ocorrencias_escala), 009_audit_log (audit_logs_paroquia_read)
--
-- PADRÃO ANTIGO: usado em migrations anteriores antes de _portal_*
-- COMPORTAMENTO: retorna NULL se o usuário não tiver perfil ou não estiver
--                autenticado — fazendo a policy falhar graciosamente.

CREATE OR REPLACE FUNCTION public.current_paroquia_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT paroquia_id FROM public.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION public.current_paroquia_id()
  IS 'Retorna paroquia_id do usuário autenticado via profiles. Usada em policies RLS legadas (006, 009).';

-- ── 2. _portal_membro_id() ────────────────────────────────────────────────────
--
-- Retorna o UUID do membro autenticado na tabela membros.
-- Tenta primeiro por auth_user_id (caso normal), com fallback por email
-- (caso de primeiro acesso antes do link auth_user_id ser salvo).
--
-- Usada em: DEFINITIVO_FIX.sql policies (membros, escala_membros, indisponibilidades,
--            historico_participacoes, formacoes_eventos, presencas_eventos, coordenadores)

CREATE OR REPLACE FUNCTION public._portal_membro_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Caminho normal: auth_user_id já vinculado
    (SELECT id FROM public.membros
     WHERE auth_user_id = auth.uid() AND ativo = true
     LIMIT 1),
    -- Fallback primeiro acesso: busca por email (requer membro_read_own policy)
    (SELECT id FROM public.membros
     WHERE lower(trim(coalesce(email, ''))) = lower(trim(coalesce(auth.email(), '')))
       AND ativo = true
     LIMIT 1)
  )
$$;

COMMENT ON FUNCTION public._portal_membro_id()
  IS 'Retorna UUID do membro autenticado. Fallback por email para primeiro acesso.';

-- ── 3. _portal_membro_paroquia(uuid) ─────────────────────────────────────────
--
-- Retorna paroquia_id de um membro dado seu UUID.
-- Usada em policies que precisam isolar por paróquia via membro_id (não diretamente
-- via paroquia_id na tabela alvo): escala_membros, membro_ministerios.

CREATE OR REPLACE FUNCTION public._portal_membro_paroquia(p_membro_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT paroquia_id FROM public.membros WHERE id = p_membro_id LIMIT 1
$$;

COMMENT ON FUNCTION public._portal_membro_paroquia(UUID)
  IS 'Retorna paroquia_id de um membro dado seu UUID.';

-- ── 4. _portal_escala_paroquia(uuid) ─────────────────────────────────────────
--
-- Retorna paroquia_id de uma escala dado seu UUID.
-- Usada em policies de escala_membros e historico_participacoes, que não têm
-- paroquia_id direto mas chegam a ela via escala_id → escalas.paroquia_id.

CREATE OR REPLACE FUNCTION public._portal_escala_paroquia(p_escala_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT paroquia_id FROM public.escalas WHERE id = p_escala_id LIMIT 1
$$;

COMMENT ON FUNCTION public._portal_escala_paroquia(UUID)
  IS 'Retorna paroquia_id de uma escala dado seu UUID.';

-- ── 5. _portal_is_admin(uuid) ─────────────────────────────────────────────────
--
-- Retorna TRUE se o usuário autenticado tiver role admin na paróquia especificada.
-- Roles que conferem acesso de admin: super_admin, admin_paroquial, lider.
--
-- DEPENDÊNCIA CRÍTICA: user_roles deve existir antes desta migration.
-- Usada em: DEFINITIVO_FIX.sql (11 tabelas), PATCH_P (notificacoes, ocorrencias_membros)

CREATE OR REPLACE FUNCTION public._portal_is_admin(p_paroquia_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id   = auth.uid()
      AND paroquia_id = p_paroquia_id
      AND role IN ('super_admin', 'admin_paroquial', 'lider')
  )
$$;

COMMENT ON FUNCTION public._portal_is_admin(UUID)
  IS 'Retorna TRUE se o usuário autenticado for super_admin, admin_paroquial ou lider na paróquia.';

-- ── 6. _portal_is_coord(uuid) ─────────────────────────────────────────────────
--
-- Retorna TRUE se o membro especificado for coordenador ativo.
-- Distinta de _portal_is_admin: coordenadores têm acesso operacional
-- (escalas) mas não administrativo (membros, configurações).
--
-- Usada em: escala_membros (3 policies), escala_ocorrencias (2 policies),
--            indisponibilidades (1 policy)
--
-- NOTA: CREATE OR REPLACE falha se o nome do parâmetro for diferente da versão
-- existente no banco (erro 42P13). Para contornar, derrubamos TODAS as policies
-- dependentes, recriamos a função e restauramos as policies.

-- Dropa TODAS as 6 policies que dependem de _portal_is_coord
DROP POLICY IF EXISTS "em_coord_read"                    ON public.escala_membros;
DROP POLICY IF EXISTS "em_coord_update"                  ON public.escala_membros;
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;
DROP POLICY IF EXISTS "ocorrencia_coord_insert"          ON public.escala_ocorrencias;
DROP POLICY IF EXISTS "ocorrencia_coord_read"            ON public.escala_ocorrencias;
DROP POLICY IF EXISTS "indisp_membro_read"               ON public.indisponibilidades;

DROP FUNCTION IF EXISTS public._portal_is_coord(uuid);

CREATE FUNCTION public._portal_is_coord(p_membro_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coordenadores
    WHERE membro_id = p_membro_id AND ativo = true
  )
$$;

COMMENT ON FUNCTION public._portal_is_coord(UUID)
  IS 'Retorna TRUE se o membro especificado for coordenador ativo.';

-- ── Restaura policies: escala_membros ────────────────────────────────────────

-- Membro vê todos os escalados da sua paróquia em escalas publicadas
-- (ou admin, ou coordenador) — definição de PATCH_D_FIXES_2026_06_09
DROP POLICY IF EXISTS "membro_read_escala_paroquia_full" ON public.escala_membros;
CREATE POLICY "membro_read_escala_paroquia_full" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.escalas e
        WHERE e.id = escala_membros.escala_id
          AND e.status = 'publicada'
      )
      AND _portal_escala_paroquia(escala_membros.escala_id)
          = _portal_membro_paroquia(_portal_membro_id())
    )
    OR _portal_is_admin(_portal_escala_paroquia(escala_membros.escala_id))
    OR _portal_is_coord(_portal_membro_id())
  );

DROP POLICY IF EXISTS "em_coord_read" ON public.escala_membros;
CREATE POLICY "em_coord_read" ON public.escala_membros
  FOR SELECT TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

DROP POLICY IF EXISTS "em_coord_update" ON public.escala_membros;
CREATE POLICY "em_coord_update" ON public.escala_membros
  FOR UPDATE TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  )
  WITH CHECK (
    _portal_is_coord(_portal_membro_id())
    AND _portal_escala_paroquia(escala_id) = _portal_membro_paroquia(_portal_membro_id())
  );

-- ── Restaura policies: escala_ocorrencias ────────────────────────────────────

-- Coordenadores podem inserir ocorrências nas escalas onde estão escalados
DROP POLICY IF EXISTS "ocorrencia_coord_insert" ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_coord_insert" ON public.escala_ocorrencias
  FOR INSERT TO authenticated
  WITH CHECK (
    registrado_por = _portal_membro_id()
    AND _portal_is_coord(_portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = escala_ocorrencias.escala_id
        AND em.membro_id = _portal_membro_id()
    )
  );

-- Coordenadores lêem ocorrências das escalas em que estão escalados
DROP POLICY IF EXISTS "ocorrencia_coord_read" ON public.escala_ocorrencias;
CREATE POLICY "ocorrencia_coord_read" ON public.escala_ocorrencias
  FOR SELECT TO authenticated
  USING (
    _portal_is_coord(_portal_membro_id())
    AND EXISTS (
      SELECT 1 FROM public.escala_membros em
      WHERE em.escala_id = escala_ocorrencias.escala_id
        AND em.membro_id = _portal_membro_id()
    )
  );

-- ── Restaura policies: indisponibilidades ────────────────────────────────────

-- Membro vê as próprias; admin vê todas da paróquia; coordenador vê todas
-- (definição de PATCH_H_INDISP_RLS_2026_06_09)
DROP POLICY IF EXISTS "indisp_membro_read" ON public.indisponibilidades;
CREATE POLICY "indisp_membro_read" ON public.indisponibilidades
  FOR SELECT TO authenticated
  USING (
    membro_id = _portal_membro_id()
    OR _portal_is_admin(paroquia_id)
    OR _portal_is_coord(_portal_membro_id())
  );

-- ── 7. Permissões de execução ─────────────────────────────────────────────────
--
-- Funções SECURITY DEFINER rodam como o proprietário (postgres / owner da função).
-- A permissão EXECUTE para 'authenticated' é necessária para que as policies RLS
-- possam invocar estas funções quando o usuário faz uma query.
-- 'anon' não deve chamar funções que acessam dados autenticados.

GRANT EXECUTE ON FUNCTION public.current_paroquia_id()                TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_membro_id()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_membro_paroquia(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_escala_paroquia(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_is_admin(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_is_coord(UUID)               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.current_paroquia_id()               FROM anon;
REVOKE EXECUTE ON FUNCTION public._portal_membro_id()                 FROM anon;
REVOKE EXECUTE ON FUNCTION public._portal_membro_paroquia(UUID)       FROM anon;
REVOKE EXECUTE ON FUNCTION public._portal_escala_paroquia(UUID)       FROM anon;
REVOKE EXECUTE ON FUNCTION public._portal_is_admin(UUID)              FROM anon;
REVOKE EXECUTE ON FUNCTION public._portal_is_coord(UUID)              FROM anon;

-- ── 8. Validação pós-aplicação ────────────────────────────────────────────────
--
-- Execute após aplicar para confirmar que as funções existem:
--
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'current_paroquia_id', '_portal_membro_id', '_portal_membro_paroquia',
--     '_portal_escala_paroquia', '_portal_is_admin', '_portal_is_coord'
--   );
--
-- CRITÉRIO DE APROVAÇÃO:
--   ✓ 6 funções listadas
--   ✓ security_type = 'DEFINER' para todas
--   ✓ 006_rls_gaps.sql pode ser re-executado sem erros de função não encontrada
--
-- REFERÊNCIA CRUZADA:
--   current_paroquia_id()         → 006_rls_gaps.sql, 009_audit_log.sql
--   _portal_membro_id()           → DEFINITIVO_FIX.sql (11 policies)
--   _portal_membro_paroquia(uuid) → DEFINITIVO_FIX.sql (5 policies)
--   _portal_escala_paroquia(uuid) → DEFINITIVO_FIX.sql (5 policies)
--   _portal_is_admin(uuid)        → DEFINITIVO_FIX.sql (11 policies), PATCH_P (4 policies)
--   _portal_is_coord(uuid)        → DEFINITIVO_FIX.sql (2 policies)
-- ─────────────────────────────────────────────────────────────────────────────
