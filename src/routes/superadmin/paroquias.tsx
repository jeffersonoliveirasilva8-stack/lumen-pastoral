import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Search, MoreHorizontal, Eye, Ban, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/paroquias")({
  component: SuperAdminParoquias,
  head: () => ({ meta: [{ title: "Paróquias — Super Admin" }] }),
});

const STATUS_COLORS: Record<string, string> = {
  trial:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
  active:    "bg-green-500/20 text-green-400 border-green-500/30",
  past_due:  "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  suspended: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  blocked:   "bg-red-500/20 text-red-400 border-red-500/30",
  canceled:  "bg-white/5 text-white/30 border-white/10",
};

function SuperAdminParoquias() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [impersonateTarget, setImpersonateTarget] = useState<{ id: string; nome: string } | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; nome: string } | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const { data: paroquias = [], isLoading } = useQuery({
    queryKey: ["saas-paroquias-list"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("paroquias")
        .select(`
          id, nome, diocese, cidade, estado, status, trial_until, created_at,
          subscriptions (
            status, plan_id, price_brl, next_billing_date,
            plans ( slug, nome )
          )
        `)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: membrosCount = {} } = useQuery({
    queryKey: ["saas-paroquias-membros-count"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membros")
        .select("paroquia_id")
        .eq("ativo", true);
      const counts: Record<string, number> = {};
      (data ?? []).forEach((m: any) => { counts[m.paroquia_id] = (counts[m.paroquia_id] ?? 0) + 1; });
      return counts;
    },
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase as any).rpc("saas_suspend_paroquia", { p_paroquia_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saas-paroquias-list"] });
      toast.success("Paróquia suspensa.");
      setSuspendTarget(null); setSuspendReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const blockMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("saas_block_paroquia", { p_paroquia_id: id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saas-paroquias-list"] }); toast.success("Paróquia bloqueada."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const impersonateMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await (supabase as any).rpc("saas_create_impersonate_token", { p_paroquia_id: id, p_reason: reason });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (token) => {
      sessionStorage.setItem("impersonate_token", token ?? "");
      sessionStorage.setItem("impersonate_paroquia", impersonateTarget?.nome ?? "");
      toast.success("Sessão delegada iniciada. Redirecionando…");
      setImpersonateTarget(null); setImpersonateReason("");
      window.location.href = "/painel";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = paroquias.filter((p: any) => {
    const ok = filtroStatus === "todos" || p.status === filtroStatus;
    const busOk = !busca || p.nome.toLowerCase().includes(busca.toLowerCase()) || (p.cidade ?? "").toLowerCase().includes(busca.toLowerCase());
    return ok && busOk;
  });

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Paróquias</h1>
          <p className="text-sm text-white/40">{paroquias.length} paróquias cadastradas</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome ou cidade…"
            className="w-full bg-[#0F1E33] border border-white/10 text-white placeholder:text-white/30 text-sm rounded-lg py-2 pl-9 pr-3 focus:outline-none focus:border-blue-500"
          />
        </div>
        {["todos","trial","active","past_due","suspended","blocked"].map(s => (
          <button
            key={s}
            onClick={() => setFiltroStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filtroStatus === s ? "bg-blue-600 text-white" : "bg-white/5 text-white/40 hover:text-white/70"
            }`}
          >
            {s === "todos" ? "Todos" : s}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-white/30 text-sm">Carregando…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["Paróquia", "Plano", "Membros", "Status", "Vencimento", "Ações"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-white/30 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => {
                const sub = p.subscriptions?.[0];
                const plan = sub?.plans;
                return (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white/90">{p.nome}</div>
                      <div className="text-xs text-white/30">{[p.diocese, p.cidade, p.estado].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-white/60 font-medium">{plan?.nome ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-white/50 tabular-nums">{membrosCount[p.id] ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-white/5 text-white/30"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/30 tabular-nums text-xs">
                      {sub?.next_billing_date
                        ? new Date(sub.next_billing_date).toLocaleDateString("pt-BR")
                        : p.trial_until
                        ? `Trial até ${new Date(p.trial_until).toLocaleDateString("pt-BR")}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white/70">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#0F1E33] border-white/10 text-white">
                          <DropdownMenuItem asChild>
                            <Link to="/superadmin/paroquias/$id" params={{ id: p.id }} className="flex items-center gap-2 text-white/70 hover:text-white cursor-pointer">
                              <Eye className="h-3.5 w-3.5" /> Visualizar
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="flex items-center gap-2 text-white/70 hover:text-white cursor-pointer"
                            onSelect={() => setImpersonateTarget({ id: p.id, nome: p.nome })}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Entrar como admin
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem
                            className="flex items-center gap-2 text-yellow-400 hover:text-yellow-300 cursor-pointer"
                            onSelect={() => setSuspendTarget({ id: p.id, nome: p.nome })}
                          >
                            <Ban className="h-3.5 w-3.5" /> Suspender
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="flex items-center gap-2 text-red-400 hover:text-red-300 cursor-pointer"
                            onSelect={() => { if (confirm(`Bloquear ${p.nome}?`)) blockMutation.mutate(p.id); }}
                          >
                            <Lock className="h-3.5 w-3.5" /> Bloquear
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Impersonate */}
      <Dialog open={!!impersonateTarget} onOpenChange={() => { setImpersonateTarget(null); setImpersonateReason(""); }}>
        <DialogContent className="bg-[#0F1E33] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Entrar como Admin — {impersonateTarget?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-xs text-orange-300">
              Esta ação fica registrada na auditoria da plataforma. Informe o motivo obrigatoriamente.
            </div>
            <textarea
              value={impersonateReason}
              onChange={e => setImpersonateReason(e.target.value)}
              placeholder="Motivo da sessão delegada (obrigatório)…"
              rows={3}
              className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg p-3 focus:outline-none focus:border-blue-500 resize-none placeholder:text-white/30"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImpersonateTarget(null)} className="text-white/50">Cancelar</Button>
            <Button
              onClick={() => impersonateTarget && impersonateMutation.mutate({ id: impersonateTarget.id, reason: impersonateReason })}
              disabled={impersonateReason.trim().length < 5 || impersonateMutation.isPending}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              Iniciar sessão delegada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Suspender */}
      <Dialog open={!!suspendTarget} onOpenChange={() => { setSuspendTarget(null); setSuspendReason(""); }}>
        <DialogContent className="bg-[#0F1E33] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Suspender — {suspendTarget?.nome}</DialogTitle>
          </DialogHeader>
          <textarea
            value={suspendReason}
            onChange={e => setSuspendReason(e.target.value)}
            placeholder="Motivo da suspensão…"
            rows={3}
            className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg p-3 focus:outline-none focus:border-blue-500 resize-none placeholder:text-white/30"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSuspendTarget(null)} className="text-white/50">Cancelar</Button>
            <Button
              onClick={() => suspendTarget && suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason })}
              disabled={!suspendReason.trim() || suspendMutation.isPending}
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
            >
              Suspender paróquia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
