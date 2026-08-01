import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface PlanUpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredPlan?: string;
}

export function PlanUpgradeModal({ open, onOpenChange, requiredPlan }: PlanUpgradeModalProps) {
  const { data: plans = [] } = useQuery({
    queryKey: ["plans-list"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plans")
        .select("id, name, slug, price_brl")
        .order("price_brl", { ascending: true });
      return (data ?? []) as { id: string; name: string; slug: string; price_brl: number }[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {requiredPlan
              ? `Recurso disponível a partir do plano ${requiredPlan}`
              : "Faça upgrade do seu plano"}
          </DialogTitle>
          <DialogDescription>
            Escolha o plano que melhor atende sua paróquia.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="font-semibold text-sm">{plan.name}</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {plan.price_brl === 0
                  ? "Grátis"
                  : `R$ ${plan.price_brl.toFixed(2).replace(".", ",")}/mês`}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button asChild onClick={() => onOpenChange(false)}>
            <Link to="/assinatura">Ver planos</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
