import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  past_due: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  canceled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_LABEL: Record<string, string> = {
  trial: "Teste",
  active: "Ativo",
  past_due: "Vencido",
  suspended: "Suspenso",
  blocked: "Bloqueado",
  canceled: "Cancelado",
};

export function PlanBadge() {
  const { profile } = useAuth();

  const { data } = useQuery({
    queryKey: ["subscription-badge", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("sub_status, plans(name)")
        .eq("paroquia_id", profile!.paroquia_id)
        .maybeSingle();
      return data as { sub_status: string; plans: { name: string } | null } | null;
    },
  });

  if (!data) return null;

  const status = data.sub_status ?? "active";
  const planName = data.plans?.name ?? "Gratuito";
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.active;
  const label = STATUS_LABEL[status] ?? status;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {planName}
      <span className="opacity-70">·</span>
      {label}
    </span>
  );
}
