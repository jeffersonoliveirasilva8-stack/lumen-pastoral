-- migration 056 — Recria trigger de sync tipo_acesso→user_roles sem cast ::app_role
-- O tipo user_roles.role é TEXT no banco real (não app_role enum).

-- Remove versão anterior com cast incorreto
DROP TRIGGER IF EXISTS sync_tipo_acesso_user_roles ON public.membros;
DROP FUNCTION IF EXISTS public._sync_tipo_acesso_to_user_roles();

CREATE OR REPLACE FUNCTION public._sync_tipo_acesso_to_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_uid  UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tipo_acesso = OLD.tipo_acesso THEN
    RETURN NEW;
  END IF;

  v_uid := NEW.auth_user_id;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  CASE NEW.tipo_acesso
    WHEN 'coordenador' THEN v_role := 'coordenador';
    WHEN 'auxiliar'    THEN v_role := 'auxiliar';
    ELSE                    v_role := NULL;
  END CASE;

  IF v_role IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id    = v_uid
      AND paroquia_id = NEW.paroquia_id
      AND role IN ('coordenador', 'auxiliar');

    INSERT INTO public.user_roles (user_id, paroquia_id, role)
    VALUES (v_uid, NEW.paroquia_id, v_role)
    ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id    = v_uid
      AND paroquia_id = NEW.paroquia_id
      AND role IN ('coordenador', 'auxiliar');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_tipo_acesso_user_roles
  AFTER INSERT OR UPDATE OF tipo_acesso ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public._sync_tipo_acesso_to_user_roles();

-- Backfill retroativo (sem cast de enum)
DELETE FROM public.user_roles
WHERE role IN ('coordenador', 'auxiliar')
  AND EXISTS (
    SELECT 1 FROM public.membros m
    WHERE m.auth_user_id = user_roles.user_id
      AND m.paroquia_id  = user_roles.paroquia_id
  );

INSERT INTO public.user_roles (user_id, paroquia_id, role)
SELECT m.auth_user_id, m.paroquia_id, m.tipo_acesso
FROM   public.membros m
WHERE  m.tipo_acesso IN ('coordenador', 'auxiliar')
  AND  m.auth_user_id IS NOT NULL
ON CONFLICT (user_id, role, paroquia_id) DO NOTHING;
