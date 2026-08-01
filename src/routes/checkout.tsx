import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Flame, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type CheckoutSearch = { plan?: string };

export const Route = createFileRoute("/checkout")({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { plan: planSlug } = Route.useSearch();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const { data: planData, isLoading } = useQuery({
    queryKey: ["plan-detail", planSlug],
    enabled: !!planSlug,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plans")
        .select("id, name, slug, price_brl, description")
        .eq("slug", planSlug)
        .maybeSingle();
      return data as any;
    },
  });

  async function handleCheckout() {
    if (!profile?.paroquia_id || !planData) {
      toast.error("Dados insuficientes para iniciar o checkout.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-subscription", {
        body: { plan_slug: planData.slug, paroquia_id: profile.paroquia_id },
      });

      if (error) throw error;

      if (data?.init_point) {
        window.location.href = data.init_point;
      } else {
        toast.info("Em breve — integração com Mercado Pago ainda não ativada.");
      }
    } catch {
      toast.info("Em breve — integração com Mercado Pago ainda não ativada.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
            <Flame className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Lumen Pastoral</p>
            <p className="text-sm font-semibold">Checkout</p>
          </div>
        </div>

        {/* Voltar */}
        <Link to="/assinatura" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para planos
        </Link>

        {/* Card do plano */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h1 className="text-lg font-bold">Resumo do pedido</h1>

          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          ) : planData ? (
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
              <div>
                <p className="font-semibold">{planData.name}</p>
                {planData.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{planData.description}</p>
                )}
              </div>
              <p className="font-bold text-lg">
                {planData.price_brl === 0
                  ? "Grátis"
                  : `R$ ${Number(planData.price_brl).toFixed(2).replace(".", ",")}/mês`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {planSlug ? `Plano "${planSlug}" não encontrado.` : "Nenhum plano selecionado."}
            </p>
          )}

          {planData && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-200">
              A integração com Mercado Pago está em implantação. Clique em "Prosseguir" para ser redirecionado ao ambiente de pagamento quando disponível, ou entre em contato via WhatsApp para assinar agora.
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={handleCheckout}
            disabled={loading || !planData}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Pagar com Mercado Pago
          </Button>
        </div>
      </div>
    </div>
  );
}
