import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/superadmin/financeiro")({
  component: SuperAdminFinanceiro,
  head: () => ({ meta: [{ title: "Financeiro — Super Admin" }] }),
});

function SuperAdminFinanceiro() {
  const { data: metrics } = useQuery({
    queryKey: ["saas-platform-metrics"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("saas_get_platform_metrics");
      return data as Record<string, number>;
    },
  });

  const { data: inadimplentes = [] } = useQuery({
    queryKey: ["saas-inadimplentes"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("paroquia_id, past_due_since, next_billing_date, price_brl, paroquias(nome, contato_email)")
        .eq("status", "past_due")
        .order("past_due_since");
      return data ?? [];
    },
  });

  const fmtBrl = (n?: number) => n != null ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Financeiro</h1>
        <p className="text-sm text-white/40">Receita, inadimplência e métricas de negócio</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: "MRR", value: fmtBrl(metrics?.mrr_brl) },
          { label: "ARR Estimado", value: fmtBrl(metrics?.arr_brl) },
          { label: "Inadimplentes", value: metrics?.inadimplentes ?? "—" },
          { label: "Cancelamentos (30d)", value: metrics?.cancelamentos_30d ?? "—" },
          { label: "Paróquias Pagas", value: metrics?.paroquias_ativas ?? "—" },
          { label: "Novas (30d)", value: metrics?.novos_30d ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0F1E33] border border-white/10 rounded-xl p-5">
            <p className="text-xs text-white/30 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-2xl font-bold text-white font-mono">{value}</p>
          </div>
        ))}
      </div>

      {inadimplentes.length > 0 && (
        <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-orange-500/20 bg-orange-500/5">
            <h2 className="text-sm font-semibold text-orange-400">⚠ Clientes Inadimplentes ({inadimplentes.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5">
              {["Paróquia", "E-mail", "Inadimplente desde", "Valor"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-white/30 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {inadimplentes.map((i: any) => (
                <tr key={i.paroquia_id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white/80 font-medium">{i.paroquias?.nome}</td>
                  <td className="px-4 py-3 text-white/40 text-xs">{i.paroquias?.contato_email ?? "—"}</td>
                  <td className="px-4 py-3 text-orange-400 tabular-nums text-xs">
                    {i.past_due_since ? new Date(i.past_due_since).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/60 tabular-nums">{fmtBrl(i.price_brl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
