import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/acesso-negado")({
  component: AcessoNegadoPage,
  head: () => ({ meta: [{ title: "Acesso Negado — Lumen Pastoral" }] }),
});

function AcessoNegadoPage() {
  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="text-center max-w-sm">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <ShieldX className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="font-serif text-2xl mb-2">Acesso negado</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sua conta está desativada ou sem permissão de acesso.
          Entre em contato com o coordenador da sua paróquia para mais informações.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            to="/membro/login"
            className="inline-flex justify-center items-center rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Tentar com outra conta
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 mt-1"
          >
            Sair da conta atual
          </button>
        </div>
      </div>
    </div>
  );
}
