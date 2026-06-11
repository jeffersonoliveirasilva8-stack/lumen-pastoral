import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

// Constante injetada pelo Vite em build-time (vite.config.ts → define)
// true = Vercel SPA, false = Cloudflare SSR
declare const __IS_SPA__: boolean;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium tracking-[0.2em] uppercase text-gold">Página não encontrada</p>
        <h1 className="mt-3 font-serif text-7xl text-foreground">404</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          O recurso que você procura não está disponível ou foi movido.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl text-foreground">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >Tentar novamente</button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent">Início</a>
        </div>
      </div>
    </div>
  );
}

const HEAD_META = {
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    { title: "Lumen Pastoral — Gestão pastoral para paróquias" },
    { name: "description", content: "Plataforma SaaS para gestão litúrgica, escalas pastorais e coordenação de paróquias." },
    { property: "og:title", content: "Lumen Pastoral — Gestão pastoral para paróquias" },
    { property: "og:description", content: "Escalas inteligentes, multi-paróquia, totalmente em nuvem." },
    { property: "og:type", content: "website" },
  ],
  links: [
    { rel: "stylesheet", href: appCss },
  ],
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => HEAD_META,
  // shellComponent só é usado no build SSR (Cloudflare Workers).
  // No SPA (Vercel) ele renderizaria <html><head><body> dentro do <div id="root">,
  // o browser auto-corrigiria o HTML inválido e quebraria o virtual DOM do React.
  ...(__IS_SPA__ ? {} : { shellComponent: RootShell }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Usado apenas no build SSR — fornece o envelope HTML para Server-Side Rendering
function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthSync() {
  const router = useRouter();
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        // Garante que o usuário seja levado à tela de redefinição, independente
        // de para onde o Supabase redirecionou após o link de recuperação
        if (!window.location.pathname.startsWith("/reset-senha")) {
          navigate({ to: "/reset-senha", replace: true });
        }
        return;
      }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        qc.invalidateQueries();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, qc, navigate]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSync />
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
