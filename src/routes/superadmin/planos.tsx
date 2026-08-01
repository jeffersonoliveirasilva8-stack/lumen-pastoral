import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/superadmin/planos")({
  component: SuperAdminPlanos,
  head: () => ({ meta: [{ title: "Planos — Super Admin" }] }),
});

function SuperAdminPlanos() {
  const { data: planos = [], isLoading } = useQuery({
    queryKey: ["saas-plans-full"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plans")
        .select("*, plan_features(*)")
        .order("ordem");
      return data ?? [];
    },
  });

  if (isLoading) return <div className="p-8 text-white/40 text-sm">Carregando…</div>;

  const allFeatures = Array.from(
    new Set(planos.flatMap((p: any) => p.plan_features?.map((f: any) => f.feature_key) ?? []))
  ).sort() as string[];

  const fmtBrl = (n: number | null) => n != null ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Gratuito";

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Planos</h1>
        <p className="text-sm text-white/40">Configuração de planos e feature flags</p>
      </div>

      <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-5 py-4 text-xs font-medium text-white/30 uppercase tracking-wider w-40">Feature</th>
                {planos.map((p: any) => (
                  <th key={p.id} className="text-center px-5 py-4">
                    <div className="font-bold text-white">{p.nome}</div>
                    <div className="text-xs text-white/40 mt-0.5">{fmtBrl(p.preco_mensal)}/mês</div>
                    {p.destaque && <div className="text-xs text-blue-400 mt-0.5">⭐ Recomendado</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5 bg-white/2">
                <td className="px-5 py-2 text-xs text-white/30 uppercase">Limite de membros</td>
                {planos.map((p: any) => (
                  <td key={p.id} className="px-5 py-2 text-center text-white/60 tabular-nums text-xs">
                    {p.max_membros ?? "Ilimitado"}
                  </td>
                ))}
              </tr>
              {allFeatures.map((fk) => (
                <tr key={fk} className="border-b border-white/5">
                  <td className="px-5 py-2.5 font-mono text-xs text-white/50">{fk}</td>
                  {planos.map((p: any) => {
                    const feat = p.plan_features?.find((f: any) => f.feature_key === fk);
                    return (
                      <td key={p.id} className="px-5 py-2.5 text-center">
                        {!feat || !feat.enabled
                          ? <XCircle className="h-4 w-4 text-white/15 mx-auto" />
                          : feat.limit_value != null
                          ? <span className="text-xs text-blue-400 tabular-nums">{feat.limit_value}/mês</span>
                          : <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        }
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
