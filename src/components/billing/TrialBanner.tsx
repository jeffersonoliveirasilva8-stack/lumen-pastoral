import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { differenceInDays, parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function TrialBanner() {
  const { profile } = useAuth();

  const { data } = useQuery({
    queryKey: ["trial-banner", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("status, trial_until, current_period_end")
        .eq("paroquia_id", profile!.paroquia_id)
        .maybeSingle();
      return data as { status: string; trial_until: string | null; current_period_end: string | null } | null;
    },
  });

  if (!data || data.status !== "trial") return null;

  const endsAt = data.trial_until ?? data.current_period_end;
  if (!endsAt) return null;

  const daysLeft = differenceInDays(parseISO(endsAt), new Date());
  if (daysLeft > 14) return null;

  const urgent = daysLeft <= 3;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
        urgent
          ? "bg-red-500 text-white"
          : "bg-amber-400 text-amber-900"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium truncate">
          {daysLeft <= 0
            ? "Seu período de teste encerrou."
            : daysLeft === 1
            ? "Seu período de teste termina amanhã!"
            : `Seu período de teste termina em ${daysLeft} dias.`}
        </span>
      </div>
      <Link
        to="/assinatura"
        className={`shrink-0 rounded-lg px-3 py-1 text-xs font-bold transition ${
          urgent
            ? "bg-white text-red-600 hover:bg-red-50"
            : "bg-amber-900/15 text-amber-900 hover:bg-amber-900/25"
        }`}
      >
        Assinar agora
      </Link>
    </div>
  );
}
