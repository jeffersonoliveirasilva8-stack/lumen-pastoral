import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";

type SucessoSearch = {
  payment_id?: string;
  status?: string;
  external_reference?: string;
};

export const Route = createFileRoute("/checkout/sucesso")({
  validateSearch: (search: Record<string, unknown>): SucessoSearch => ({
    payment_id: typeof search.payment_id === "string" ? search.payment_id : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    external_reference: typeof search.external_reference === "string" ? search.external_reference : undefined,
  }),
  component: CheckoutSucessoPage,
});

function CheckoutSucessoPage() {
  const { status } = Route.useSearch();

  const approved = status === "approved" || !status;
  const pending = status === "pending";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>

        {/* Ícone de status */}
        <div className="flex justify-center">
          {pending ? (
            <div className="h-20 w-20 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Clock className="h-10 w-10 text-amber-500" />
            </div>
          ) : (
            <div className="h-20 w-20 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            </div>
          )}
        </div>

        {/* Texto */}
        <div className="space-y-2">
          {pending ? (
            <>
              <h1 className="text-xl font-bold text-amber-600 dark:text-amber-400">Aguardando confirmação</h1>
              <p className="text-sm text-muted-foreground">
                Seu pagamento está sendo processado. Você receberá uma confirmação assim que for aprovado.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">Assinatura ativada!</h1>
              <p className="text-sm text-muted-foreground">
                Parabéns! Seu plano foi ativado com sucesso. Aproveite todos os recursos do Lumen Pastoral.
              </p>
            </>
          )}
        </div>

        <Button asChild className="w-full" size="lg">
          <Link to="/painel">Ir para o painel</Link>
        </Button>
      </div>
    </div>
  );
}
