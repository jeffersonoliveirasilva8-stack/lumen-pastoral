import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Church, Users, CreditCard, AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

export const Route = createFileRoute("/superadmin/dashboard")({
  component: SuperAdminDashboard,
  head: () => ({ meta: [{ title: "Dashboard — Super Admin" }] }),
});

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-[#0F1E33] border border-white/10 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-2xl font-bold text-white font-mono">{value}</p>
          {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 ${color}`}>
          <Icon className="h-4.5 w-4.5 text-white" />
        </div>
      </div>
    </div>
  );
}

function SuperAdminDashboard() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["saas-platform-metrics"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("saas_get_platform_metrics");
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: 60_000,
  });

  const { data: recentParoquias = [] } = useQuery({
    queryKey: ["saas-recent-paroquias"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("paroquias")
        .select("id, nome, cidade, estado, status, created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  const fmt = (n?: number) => n?.toLocaleString("pt-BR") ?? "—";
  const fmtBrl = (n?: number) =>
    n != null ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const statusChip: Record<string, string> = {
    trial:     "bg-blue-500/20 text-blue-400",
    active:    "bg-green-500/20 text-green-400",
    past_due:  "bg-yellow-500/20 text-yellow-400",
    suspended: "bg-orange-500/20 text-orange-400",
    blocked:   "bg-red-500/20 text-red-400",
    canceled:  "bg-white/10 text-white/40",
  };

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-white mb-1">Dashboard da Plataforma</h1>
        <p className="text-sm text-white/40">Visão geral de todas as paróquias e métricas SaaS</p>
      </div>

      {isLoading ? (
        <div className="text-white/40 text-sm">Carregando métricas…</div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Total de Paróquias" value={fmt(metrics?.total_paroquias)} icon={Church} color="bg-blue-600" />
            <MetricCard label="Paróquias Ativas" value={fmt(metrics?.paroquias_ativas)} sub={`${fmt(metrics?.paroquias_trial)} em trial`} icon={CheckCircle2} color="bg-green-600" />
            <MetricCard label="Total de Membros" value={fmt(metrics?.total_membros)} icon={Users} color="bg-violet-600" />
            <MetricCard label="Escalas Publicadas" value={fmt(metrics?.escalas_publicadas)} sub={`de ${fmt(metrics?.total_escalas)} total`} icon={TrendingUp} color="bg-cyan-600" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard label="MRR" value={fmtBrl(metrics?.mrr_brl)} sub="Receita mensal recorrente" icon={CreditCard} color="bg-emerald-600" />
            <MetricCard label="ARR" value={fmtBrl(metrics?.arr_brl)} sub="Receita anual estimada" icon={TrendingUp} color="bg-teal-600" />
            <MetricCard label="Inadimplentes" value={fmt(metrics?.inadimplentes)} icon={AlertTriangle} color="bg-orange-600" />
            <MetricCard label="Novos (30d)" value={fmt(metrics?.novos_30d)} sub={`${fmt(metrics?.cancelamentos_30d)} cancelamentos`} icon={Clock} color="bg-slate-600" />
          </div>

          {/* Últimas paróquias */}
          <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-sm font-semibold text-white">Paróquias Recentes</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-5 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">Nome</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">Cidade</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">Criada</th>
                </tr>
              </thead>
              <tbody>
                {recentParoquias.map((p: any) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-5 py-3 text-white/80 font-medium">{p.nome}</td>
                    <td className="px-5 py-3 text-white/40">{[p.cidade, p.estado].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusChip[p.status] ?? "bg-white/10 text-white/40"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-white/30 tabular-nums text-xs">
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
