-- migration 054 — Corrige migration 053: sync tipo_acesso → user_roles com enum correto
-- O erro 22P02 foi causado pelo uso de 'admin' que não existe no tipo app_role.
-- Valores válidos relevantes: 'coordenador', 'auxiliar', 'membro'

-- Remove o trigger criado em 053 (será recriado corretamente abaixo)
DROP TRIGGER IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

-- ─────────────────────────────────────────────────────────────────
-- Trigger corrigido com valores de enum válidos
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sync_tipo_acesso_to_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  app_role;
  v_uid   UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tipo_acesso = OLD.tipo_acesso THEN
    RETURN NEW;
  END IF;

  v_uid := NEW.auth_user_id;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  CASE NEW.tipo_acesso
    WHEN 'coordenador' THEN v_role := 'coordenador'::app_role;
    WHEN 'auxiliar'    THEN v_role := 'auxiliar'::app_role;
    ELSE                    v_role := NULL;
  END CASE;

  IF v_role IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_uid AND paroquia_id = NEW.paroquia_id
      AND role IN ('coordenador'::app_role, 'auxiliar'::app_role);

    INSERT INTO public.user_roles (user_id, paroquia_id, role)
    VALUES (v_uid, NEW.paroquia_id, v_role)
    ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
  ELSE
    -- tipo_acesso = 'membro' → remove roles elevados
    DELETE FROM public.user_roles
    WHERE user_id = v_uid AND paroquia_id = NEW.paroquia_id
      AND role IN ('coordenador'::app_role, 'auxiliar'::app_role);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_tipo_acesso_user_roles
  AFTER INSERT OR UPDATE OF tipo_acesso ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public._sync_tipo_acesso_to_user_roles();

-- ─────────────────────────────────────────────────────────────────
-- Backfill retroativo com valores corretos
-- ─────────────────────────────────────────────────────────────────
DELETE FROM public.user_roles ur
WHERE ur.role IN ('coordenador'::app_role, 'auxiliar'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.membros m
    WHERE m.auth_user_id = ur.user_id
      AND m.paroquia_id  = ur.paroquia_id
  );

INSERT INTO public.user_roles (user_id, paroquia_id, role)
SELECT m.auth_user_id,
       m.paroquia_id,
       m.tipo_acesso::app_role
FROM   public.membros m
WHERE  m.tipo_acesso IN ('coordenador', 'auxiliar')
  AND  m.auth_user_id IS NOT NULL
ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
