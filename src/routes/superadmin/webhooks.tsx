import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/webhooks")({
  component: SuperAdminWebhooks,
  head: () => ({ meta: [{ title: "Webhooks — Super Admin" }] }),
});

function SuperAdminWebhooks() {
  const qc = useQueryClient();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["saas-webhook-events"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("webhook_events")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  const reprocessMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("saas_reprocess_webhook", { p_event_id: id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saas-webhook-events"] }); toast.success("Evento marcado para reprocessamento."); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Webhooks de Pagamento</h1>
        <p className="text-sm text-white/40">Eventos recebidos dos gateways de pagamento</p>
      </div>

      <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-white/30 text-sm">Carregando…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["Recebido", "Gateway", "Evento", "Status", "Tentativas", "Ações"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-white/30 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev: any) => (
                <tr key={ev.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-4 py-2.5 text-white/30 tabular-nums text-xs">{new Date(ev.received_at).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2.5 text-white/50 text-xs">{ev.gateway}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-white/70">{ev.event_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ev.processed ? "bg-green-500/20 text-green-400" : ev.processing_error ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                      {ev.processed ? "OK" : ev.processing_error ? "ERRO" : "PENDENTE"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/40 tabular-nums text-xs">{ev.retry_count}</td>
                  <td className="px-4 py-2.5">
                    {!ev.processed && (
                      <button
                        onClick={() => reprocessMutation.mutate(ev.id)}
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        <RefreshCw className="h-3 w-3" /> Reprocessar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
