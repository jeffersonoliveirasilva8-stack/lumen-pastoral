import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export const Route = createFileRoute("/superadmin/auditoria")({
  component: SuperAdminAuditoria,
  head: () => ({ meta: [{ title: "Auditoria — Super Admin" }] }),
});

function SuperAdminAuditoria() {
  const [busca, setBusca] = useState("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["saas-platform-audit"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("platform_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const filtered = busca
    ? logs.filter((l: any) => l.action?.includes(busca) || l.actor_email?.includes(busca) || l.target_label?.includes(busca))
    : logs;

  const actionColor = (action: string) => {
    if (action.includes("deleted") || action.includes("blocked")) return "text-red-400";
    if (action.includes("suspended")) return "text-orange-400";
    if (action.includes("approved") || action.includes("activated")) return "text-green-400";
    if (action.includes("impersonate")) return "text-yellow-400";
    return "text-white/50";
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Auditoria da Plataforma</h1>
          <p className="text-sm text-white/40">Registro de todas as ações administrativas</p>
        </div>
      </div>

      <div className="mb-4">
        <input
          value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Filtrar por ação, email ou paróquia…"
          className="w-full max-w-sm bg-[#0F1E33] border border-white/10 text-white text-sm rounded-lg py-2 px-3 focus:outline-none focus:border-blue-500 placeholder:text-white/30"
        />
      </div>

      <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-white/30 text-sm">Carregando…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["Data/Hora", "Ação", "Ator", "Alvo", "Detalhes"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log: any) => (
                <tr key={log.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-2.5 text-white/30 tabular-nums text-xs whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className={`px-4 py-2.5 font-mono text-xs font-medium ${actionColor(log.action)}`}>
                    {log.action}
                  </td>
                  <td className="px-4 py-2.5 text-white/50 text-xs">{log.actor_email ?? "sistema"}</td>
                  <td className="px-4 py-2.5 text-white/60 text-xs">{log.target_label ?? log.target_id?.slice(0,8)}</td>
                  <td className="px-4 py-2.5 text-white/30 text-xs font-mono">
                    {log.new_value ? JSON.stringify(log.new_value).slice(0, 60) : "—"}
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
