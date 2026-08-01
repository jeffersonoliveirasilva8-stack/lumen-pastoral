import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

interface SubscriptionGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function SubscriptionGate({ feature, children, fallback }: SubscriptionGateProps) {
  const { profile } = useAuth();

  const { data: allowed, isLoading } = useQuery({
    queryKey: ["plan-feature", feature, profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("check_plan_feature", { p_feature: feature });
      return data as boolean;
    },
  });

  // Otimista: mostra children enquanto carrega
  if (isLoading || allowed === true || allowed === undefined) {
    return <>{children}</>;
  }

  if (fallback) return <>{fallback}</>;

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-sm text-foreground">Recurso não disponível</p>
        <p className="text-xs text-muted-foreground mt-1">
          Este recurso não está incluído no seu plano atual.
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to="/assinatura">Ver planos</Link>
      </Button>
    </div>
  );
}
