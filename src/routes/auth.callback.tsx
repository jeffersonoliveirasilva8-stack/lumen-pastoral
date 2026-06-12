import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPostLoginRoute } from "@/lib/auth-redirect";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
  head: () => ({ meta: [{ title: "Redirecionando… — Lumen Pastoral" }] }),
});

/**
 * Rota de callback para OAuth (Google, GitHub, etc.).
 *
 * Supabase redireciona aqui após autenticação externa.
 * Esta rota:
 *   1. Aguarda a sessão ser estabelecida (onAuthStateChange)
 *   2. Chama getPostLoginRoute() para determinar destino por role
 *   3. Redireciona sem expor lógica de role ao provider OAuth
 *
 * A URL configurada no Supabase Dashboard → Auth → URL Configuration
 * deve conter: <origin>/auth/callback
 */
function AuthCallback() {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    // Processa apenas uma vez — evita double-redirect em StrictMode
    if (processed.current) return;

    let unsub: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout>;

    async function handleSession() {
      // Password recovery: hash fragment contains type=recovery
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (hashParams.get("type") === "recovery" || window.location.search.includes("type=recovery")) {
        processed.current = true;
        navigate({ to: "/reset-senha", replace: true });
        return;
      }

      // Verifica se sessão já está disponível (hash fragment ou cookie)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && !processed.current) {
        processed.current = true;
        const route = await getPostLoginRoute(supabase);
        navigate({ to: route, replace: true });
        return;
      }

      // Aguarda evento de auth (token no hash fragment ainda sendo processado)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, sess) => {
          if (_event === "PASSWORD_RECOVERY" && !processed.current) {
            processed.current = true;
            clearTimeout(timeout);
            navigate({ to: "/reset-senha", replace: true });
            return;
          }
          if (sess?.user && !processed.current) {
            processed.current = true;
            clearTimeout(timeout);
            const route = await getPostLoginRoute(supabase);
            navigate({ to: route, replace: true });
          }
        },
      );
      unsub = () => subscription.unsubscribe();

      // Timeout de segurança: se em 8s nada acontecer, volta ao login
      timeout = setTimeout(() => {
        if (!processed.current) {
          processed.current = true;
          navigate({ to: "/login", replace: true });
        }
      }, 8_000);
    }

    handleSession();

    return () => {
      unsub?.();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verificando acesso…</p>
      </div>
    </div>
  );
}
