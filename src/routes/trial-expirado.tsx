import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/trial-expirado")({
  component: TrialExpiradoPage,
});

function TrialExpiradoPage() {
  const { profile } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-20 w-20 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <Lock className="h-10 w-10 text-red-500" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold">Acesso suspenso</h1>
          <p className="text-sm text-muted-foreground">
            O período de teste da sua paróquia encerrou ou a assinatura foi suspensa. Para continuar usando o Lumen Pastoral, regularize sua assinatura.
          </p>
        </div>

        {profile?.paroquia_id && (
          <Button asChild className="w-full" size="lg">
            <Link to="/assinatura">Regularizar assinatura</Link>
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          Dúvidas? Entre em contato com o suporte.
        </p>
      </div>
    </div>
  );
}
