-- Migration 096 — Adicionar nível Vice-Coordenador (tipo_acesso = 'vice')
--
-- Problema: o sistema tem apenas dois níveis de acesso além de membro:
--   auxiliar (Secretário) e coordenador (Coordenador completo).
--   O ROLE_CONFIG no frontend já definia "Vice-Coordenador" mas nenhum
--   valor do DB mapeava para esse nível — a opção ficava invisível.
--
-- Solução:
--   1. Adicionar 'vice' ao CHECK constraint de tipo_acesso
--   2. Atualizar o trigger de sincronização para mapear 'vice' → 'coordenador'
--      em user_roles (mesmo acesso operacional do coordenador, mas sem isAdmin)
--   3. Atualizar is_coordenador_da_paroquia para incluir 'vice'
--
-- Níveis após a migration:
--   membro       → portal do servidor (padrão)
--   auxiliar     → Secretário: sacristia + confirmações
--   vice         → Vice-Coordenador: gerencia escalas e membros, sem configs avançadas
--   coordenador  → Coordenador: acesso completo ao painel
--   administrador → reservado (super_admin)
--
-- IDEMPOTENTE: sim (ALTER com IF NOT EXISTS não existe para CHECK,
--   mas a migration inteira pode ser reaplicada sem erro pois
--   ALTER TABLE DROP + ADD CONSTRAINT é feito com IF EXISTS)

-- ── 1. Atualizar CHECK constraint ─────────────────────────────────────────────

ALTER TABLE public.membros
  DROP CONSTRAINT IF EXISTS membros_tipo_acesso_check;

ALTER TABLE public.membros
  ADD CONSTRAINT membros_tipo_acesso_check
  CHECK (tipo_acesso IN ('membro','auxiliar','vice','coordenador','administrador'));

-- ── 2. Atualizar trigger de sincronização tipo_acesso → user_roles ────────────

CREATE OR REPLACE FUNCTION public._sync_tipo_acesso_to_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_user_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tipo_acesso = OLD.tipo_acesso THEN
    RETURN NEW;
  END IF;

  v_user_id := NEW.auth_user_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  v_role := CASE NEW.tipo_acesso
    WHEN 'administrador' THEN 'admin_paroquial'
    WHEN 'coordenador'   THEN 'coordenador'
    WHEN 'vice'          THEN 'coordenador'   -- vice tem mesmos direitos DB que coordenador
    WHEN 'auxiliar'      THEN 'auxiliar'
    ELSE NULL
  END;

  IF v_role IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND paroquia_id = NEW.paroquia_id
      AND role IN ('admin_paroquial', 'coordenador', 'auxiliar', 'admin');

    INSERT INTO public.user_roles (user_id, paroquia_id, role)
    VALUES (v_user_id, NEW.paroquia_id, v_role)
    ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id AND paroquia_id = NEW.paroquia_id
      AND role IN ('admin_paroquial', 'coordenador', 'auxiliar', 'admin');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
CREATE TRIGGER sync_tipo_acesso_user_roles
  AFTER INSERT OR UPDATE OF tipo_acesso ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public._sync_tipo_acesso_to_user_roles();

-- ── 3. Atualizar is_coordenador_da_paroquia para incluir 'vice' ───────────────

CREATE OR REPLACE FUNCTION public.is_coordenador_da_paroquia(p_paroquia_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.membros m
    WHERE (m.auth_user_id = auth.uid()
           OR LOWER(TRIM(COALESCE(m.email,''))) = LOWER(TRIM(COALESCE(auth.email(),''))))
      AND m.paroquia_id = p_paroquia_id
      AND m.ativo = true
      AND m.tipo_acesso IN ('auxiliar', 'vice', 'coordenador', 'administrador')
    UNION ALL
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.paroquia_id = p_paroquia_id
      AND ur.role IN ('coordenador', 'auxiliar', 'admin_paroquial', 'lider', 'super_admin')
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_coordenador_da_paroquia(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
