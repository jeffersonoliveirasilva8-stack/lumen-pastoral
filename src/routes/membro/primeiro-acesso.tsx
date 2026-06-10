import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

// Rota mantida para compatibilidade com links antigos já enviados por e-mail.
// Redireciona para o novo fluxo de ativação de conta.
export const Route = createFileRoute("/membro/primeiro-acesso")({
  component: PrimeiroAcessoRedirect,
  head: () => ({ meta: [{ title: "Ativando conta — Portal do Servidor" }] }),
});

function PrimeiroAcessoRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: "/membro/ativar-conta" as any, replace: true });
  }, [navigate]);
  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
