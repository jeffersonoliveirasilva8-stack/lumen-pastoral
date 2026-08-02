import { createFileRoute, Link } from "@tanstack/react-router";
import { XCircle, Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type FalhaSearch = { plan?: string; error?: string };

export const Route = createFileRoute("/checkout/falha")({
  validateSearch: (search: Record<string, unknown>): FalhaSearch => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: CheckoutFalhaPage,
});

function CheckoutFalhaPage() {
  const { plan } = Route.useSearch();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>

        <div className="flex justify-center">
          <div className="h-20 w-20 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <XCircle className="h-10 w-10 text-red-500" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-red-600 dark:text-red-400">Pagamento não realizado</h1>
          <p className="text-sm text-muted-foreground">
            Não foi possível processar seu pagamento. Nenhum valor foi cobrado.
            Você pode tentar novamente ou escolher outro método de pagamento.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="w-full gap-2">
            <Link to="/checkout" search={{ plan }}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link to="/assinatura">Ver planos</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
