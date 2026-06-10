import * as Sentry from "@sentry/react";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Captura erros não tratados e rejeições de Promise
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.MODE === "production" ? 0.1 : 0,
    // Remove dados sensíveis antes de enviar ao Sentry
    beforeSend(event) {
      // Nunca enviar tokens, CPF, RG ou senhas nos dados do evento
      const SENSITIVE = ["token_acesso", "cpf", "rg", "senha", "password", "token"];
      function scrub(obj: unknown): unknown {
        if (obj === null || typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.map(scrub);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          out[k] = SENSITIVE.includes(k.toLowerCase()) ? "[Filtered]" : scrub(v);
        }
        return out;
      }
      if (event.extra)  event.extra  = scrub(event.extra)  as typeof event.extra;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      return event;
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(<RouterProvider router={router} />);
