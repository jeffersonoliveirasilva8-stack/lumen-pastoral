import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/paroquias/$id")({
  component: ParoquiaDetalhe,
  head: () => ({ meta: [{ title: "Detalhe — Super Admin" }] }),
});

function ParoquiaDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [novoPlano, setNovoPlano] = useState("");

  const { data: p, isLoading } = useQuery({
    queryKey: ["saas-paroquia-detalhe", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("paroquias")
        .select(`*, subscriptions (*, plans(*))`)
        .eq("id", id)
        .single();
      return data;
    },
  });

  const { data: membros = [] } = useQuery({
    queryKey: ["saas-paroquia-membros", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membros")
        .select("id, nome_completo, email, ativo")
        .eq("paroquia_id", id)
        .order("nome_completo")
        .limit(20);
      return data ?? [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["saas-paroquia-invoices", id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("paroquia_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const { data: planos = [] } = useQuery({
    queryKey: ["saas-plans-list"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("plans").select("id, slug, nome").eq("ativo", true).order("ordem");
      return data ?? [];
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("saas_change_plan", { p_paroquia_id: id, p_new_plan_slug: novoPlano });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saas-paroquia-detalhe", id] });
      toast.success("Plano alterado.");
      setNovoPlano("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-white/40 text-sm">Carregando…</div>;
  if (!p) return <div className="p-8 text-white/40 text-sm">Paróquia não encontrada.</div>;

  const sub = p.subscriptions?.[0];
  const plan = sub?.plans;

  return (
    <div className="p-8 max-w-5xl">
      <Link to="/superadmin/paroquias" className="flex items-center gap-1 text-white/40 hover:text-white/70 text-sm mb-6">
        <ChevronLeft className="h-4 w-4" /> Todas as paróquias
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{p.nome}</h1>
          <p className="text-sm text-white/40">{[p.diocese, p.cidade, p.estado].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
          {p.status}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Plano", value: plan?.nome ?? "—" },
          { label: "Membros ativos", value: membros.filter((m: any) => m.ativo).length },
          { label: "Próximo vencimento", value: sub?.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString("pt-BR") : "—" },
          { label: "Trial até", value: p.trial_until ? new Date(p.trial_until).toLocaleDateString("pt-BR") : "—" },
          { label: "E-mail", value: p.contato_email ?? "—" },
          { label: "Criada em", value: new Date(p.created_at).toLocaleDateString("pt-BR") },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0F1E33] border border-white/10 rounded-xl p-4">
            <p className="text-xs text-white/30 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-sm font-medium text-white/80">{value}</p>
          </div>
        ))}
      </div>

      {/* Trocar plano */}
      <div className="bg-[#0F1E33] border border-white/10 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4" /> Alterar Plano
        </h2>
        <div className="flex gap-3">
          <select
            value={novoPlano} onChange={e => setNovoPlano(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">Selecionar plano…</option>
            {planos.map((pl: any) => (
              <option key={pl.slug} value={pl.slug}>{pl.nome}</option>
            ))}
          </select>
          <Button
            onClick={() => changePlanMutation.mutate()}
            disabled={!novoPlano || changePlanMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Aplicar
          </Button>
        </div>
      </div>

      {/* Faturas */}
      {invoices.length > 0 && (
        <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden mb-5">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white">Faturas</h2>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5">
              {["Data", "Valor", "Status", "Vencimento"].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs font-medium text-white/30 uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="border-b border-white/5">
                  <td className="px-4 py-2 text-white/40 tabular-nums text-xs">{new Date(inv.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-2 text-white/70 tabular-nums">{Number(inv.amount_brl).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                  <td className="px-4 py-2"><span className={`text-xs px-1.5 py-0.5 rounded ${inv.status === "paid" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>{inv.status}</span></td>
                  <td className="px-4 py-2 text-white/30 tabular-nums text-xs">{new Date(inv.due_date).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
