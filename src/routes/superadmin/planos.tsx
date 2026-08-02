import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Copy, CheckCircle2, XCircle, Power, PowerOff, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/superadmin/planos")({
  component: SuperAdminPlanos,
  head: () => ({ meta: [{ title: "Planos — Super Admin" }] }),
});

const FEATURE_LABELS: Record<string, string> = {
  motor_inteligente: "Motor Inteligente",
  substituicoes: "Substituições",
  portal_membro: "Portal do Membro",
  liturgia: "Liturgia",
  sacristia: "Sacristia",
  agenda: "Agenda",
  dashboard_avancado: "Dashboard Avançado",
  auditoria: "Auditoria",
  relatorios: "Relatórios",
  exportacao_pdf: "Exportação PDF",
  exportacao_excel: "Exportação Excel",
  notificacoes: "Notificações",
  emails: "E-mails",
  ranking: "Ranking",
  ocorrencias: "Ocorrências",
  api: "API",
};

const ALL_FEATURE_KEYS = Object.keys(FEATURE_LABELS);

type Plan = {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  preco_mensal: number | null;
  preco_anual: number | null;
  max_membros: number | null;
  max_coordenadores: number | null;
  trial_dias: number;
  ativo: boolean;
  destaque: boolean;
  ordem: number;
  plan_features: { feature_key: string; enabled: boolean; limit_value: number | null }[];
};

type PlanForm = Omit<Plan, "id" | "plan_features"> & {
  features: Record<string, { enabled: boolean; limit_value: string }>;
};

function emptyForm(): PlanForm {
  return {
    slug: "", nome: "", descricao: "", preco_mensal: null, preco_anual: null,
    max_membros: null, max_coordenadores: null, trial_dias: 30,
    ativo: true, destaque: false, ordem: 0,
    features: Object.fromEntries(
      ALL_FEATURE_KEYS.map((k) => [k, { enabled: false, limit_value: "" }])
    ),
  };
}

function planToForm(p: Plan): PlanForm {
  const features = Object.fromEntries(
    ALL_FEATURE_KEYS.map((k) => {
      const f = p.plan_features.find((f) => f.feature_key === k);
      return [k, { enabled: f?.enabled ?? false, limit_value: f?.limit_value?.toString() ?? "" }];
    })
  );
  return { ...p, descricao: p.descricao ?? "", features };
}

function SuperAdminPlanos() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);

  const { data: planos = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["saas-plans-full"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plans")
        .select("*, plan_features(*)")
        .order("ordem");
      return data ?? [];
    },
  });

  function openCreate() {
    setEditPlan(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(p: Plan) {
    setEditPlan(p);
    setForm(planToForm(p));
    setFormOpen(true);
  }

  function openDuplicate(p: Plan) {
    setEditPlan(null);
    const f = planToForm(p);
    f.slug = p.slug + "_copia";
    f.nome = p.nome + " (Cópia)";
    f.ativo = false;
    setForm(f);
    setFormOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (f: PlanForm) => {
      const payload = {
        slug: f.slug.trim().toLowerCase().replace(/\s+/g, "_"),
        nome: f.nome.trim(),
        descricao: f.descricao || null,
        preco_mensal: f.preco_mensal !== null && f.preco_mensal !== undefined ? Number(f.preco_mensal) : null,
        preco_anual: f.preco_anual !== null && f.preco_anual !== undefined ? Number(f.preco_anual) : null,
        max_membros: f.max_membros !== null && f.max_membros !== undefined ? Number(f.max_membros) : null,
        max_coordenadores: f.max_coordenadores !== null && f.max_coordenadores !== undefined ? Number(f.max_coordenadores) : null,
        trial_dias: Number(f.trial_dias) || 0,
        ativo: f.ativo,
        destaque: f.destaque,
        ordem: Number(f.ordem) || 0,
      };

      let planId: string;
      if (editPlan) {
        await (supabase as any).from("plans").update(payload).eq("id", editPlan.id);
        planId = editPlan.id;
      } else {
        const { data } = await (supabase as any).from("plans").insert(payload).select("id").single();
        planId = data.id;
      }

      // Upsert plan_features
      const featuresPayload = ALL_FEATURE_KEYS.map((k) => ({
        plan_id: planId,
        feature_key: k,
        enabled: f.features[k]?.enabled ?? false,
        limit_value: f.features[k]?.limit_value ? Number(f.features[k].limit_value) : null,
      }));

      await (supabase as any)
        .from("plan_features")
        .upsert(featuresPayload, { onConflict: "plan_id,feature_key" });
    },
    onSuccess: () => {
      toast.success(editPlan ? "Plano atualizado!" : "Plano criado!");
      qc.invalidateQueries({ queryKey: ["saas-plans-full"] });
      setFormOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      await (supabase as any).from("plans").update({ ativo }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saas-plans-full"] }),
    onError: () => toast.error("Erro ao atualizar"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("plans").delete().eq("id", id);
    },
    onSuccess: () => {
      toast.success("Plano excluído.");
      qc.invalidateQueries({ queryKey: ["saas-plans-full"] });
      setDeleteTarget(null);
    },
    onError: () => toast.error("Não é possível excluir — verifique se há assinaturas vinculadas."),
  });

  const fmtBrl = (n: number | null) =>
    n === null ? "Gratuito" : n === 0 ? "Gratuito" : `R$ ${Number(n).toFixed(2).replace(".", ",")}`;

  function setField(key: keyof PlanForm, val: any) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function setFeature(key: string, field: "enabled" | "limit_value", val: any) {
    setForm((f) => ({
      ...f,
      features: { ...f.features, [key]: { ...f.features[key], [field]: val } },
    }));
  }

  if (isLoading) return <div className="p-8 text-white/40 text-sm">Carregando…</div>;

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Planos</h1>
          <p className="text-sm text-white/40">Gerencie planos, preços e funcionalidades</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> Novo plano
        </Button>
      </div>

      {/* Cards de planos */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {planos.map((p) => {
          const featCount = p.plan_features.filter((f) => f.enabled).length;
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-5 space-y-4 transition ${
                p.ativo
                  ? "border-white/10 bg-[#0F1E33]"
                  : "border-white/5 bg-[#0F1E33]/50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-white text-sm">{p.nome}</p>
                    {p.destaque && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />}
                  </div>
                  <p className="text-xs text-white/30 font-mono mt-0.5">{p.slug}</p>
                </div>
                <Badge
                  variant={p.ativo ? "default" : "secondary"}
                  className={`text-[10px] shrink-0 ${p.ativo ? "bg-emerald-600" : "bg-white/10 text-white/40"}`}
                >
                  {p.ativo ? "Ativo" : "Inativo"}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-xl font-bold text-white">{fmtBrl(p.preco_mensal)}</p>
                {p.preco_mensal != null && p.preco_mensal > 0 && (
                  <p className="text-xs text-white/30">/mês · Anual: {fmtBrl(p.preco_anual)}</p>
                )}
              </div>

              <div className="text-xs text-white/40 space-y-0.5">
                <p>Trial: <span className="text-white/60">{p.trial_dias} dias</span></p>
                <p>Membros: <span className="text-white/60">{p.max_membros ?? "Ilimitado"}</span></p>
                <p>Coordenadores: <span className="text-white/60">{p.max_coordenadores ?? "Ilimitado"}</span></p>
                <p>Features ativas: <span className="text-white/60">{featCount}</span></p>
              </div>

              {/* Ações */}
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-white/50 hover:text-white text-xs"
                  onClick={() => openEdit(p)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-white/50 hover:text-white text-xs"
                  onClick={() => openDuplicate(p)}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Duplicar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-white/50 hover:text-white text-xs"
                  onClick={() => toggleMutation.mutate({ id: p.id, ativo: !p.ativo })}
                >
                  {p.ativo
                    ? <><PowerOff className="h-3.5 w-3.5 mr-1" /> Desativar</>
                    : <><Power className="h-3.5 w-3.5 mr-1" /> Ativar</>
                  }
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-red-400/70 hover:text-red-400 text-xs"
                  onClick={() => setDeleteTarget(p)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Matrix de features (readonly) */}
      {planos.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#0F1E33] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Matriz de funcionalidades</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-5 py-3 text-xs text-white/30 w-48">Funcionalidade</th>
                  {planos.map((p) => (
                    <th key={p.id} className="px-4 py-3 text-center text-xs text-white/60 font-semibold">{p.nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_FEATURE_KEYS.map((fk) => (
                  <tr key={fk} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-5 py-2 text-xs text-white/50">{FEATURE_LABELS[fk]}</td>
                    {planos.map((p) => {
                      const feat = p.plan_features.find((f) => f.feature_key === fk);
                      return (
                        <td key={p.id} className="px-4 py-2 text-center">
                          {!feat || !feat.enabled
                            ? <XCircle className="h-4 w-4 text-white/15 mx-auto" />
                            : feat.limit_value != null
                            ? <span className="text-xs text-blue-400 tabular-nums">{feat.limit_value}</span>
                            : <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
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
      )}

      {/* Dialog criar/editar */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0B1525] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">{editPlan ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Info básica */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Nome</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setField("nome", e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="Ex: Essencial"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setField("slug", e.target.value)}
                  className="bg-white/5 border-white/10 text-white font-mono"
                  placeholder="essencial"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-white/60 text-xs">Descrição</Label>
                <Input
                  value={form.descricao ?? ""}
                  onChange={(e) => setField("descricao", e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="Descrição curta do plano"
                />
              </div>
            </div>

            {/* Preços */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Preço mensal (R$)</Label>
                <Input
                  type="number"
                  value={form.preco_mensal ?? ""}
                  onChange={(e) => setField("preco_mensal", e.target.value === "" ? null : e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="0 = gratuito"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Preço anual (R$)</Label>
                <Input
                  type="number"
                  value={form.preco_anual ?? ""}
                  onChange={(e) => setField("preco_anual", e.target.value === "" ? null : e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Dias de trial</Label>
                <Input
                  type="number"
                  value={form.trial_dias}
                  onChange={(e) => setField("trial_dias", e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
            </div>

            {/* Limites */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Máx. membros (vazio = ilimitado)</Label>
                <Input
                  type="number"
                  value={form.max_membros ?? ""}
                  onChange={(e) => setField("max_membros", e.target.value === "" ? null : e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Máx. coordenadores</Label>
                <Input
                  type="number"
                  value={form.max_coordenadores ?? ""}
                  onChange={(e) => setField("max_coordenadores", e.target.value === "" ? null : e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-xs">Ordem (menor = primeiro)</Label>
                <Input
                  type="number"
                  value={form.ordem}
                  onChange={(e) => setField("ordem", e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
            </div>

            {/* Flags */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.ativo} onCheckedChange={(v) => setField("ativo", v)} />
                <Label className="text-white/60 text-sm">Ativo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.destaque} onCheckedChange={(v) => setField("destaque", v)} />
                <Label className="text-white/60 text-sm">Destaque (recomendado)</Label>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-2">
              <Label className="text-white/60 text-xs uppercase tracking-wider">Funcionalidades</Label>
              <div className="rounded-lg border border-white/10 divide-y divide-white/5">
                {ALL_FEATURE_KEYS.map((fk) => (
                  <div key={fk} className="flex items-center justify-between px-4 py-2.5 gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Switch
                        checked={form.features[fk]?.enabled ?? false}
                        onCheckedChange={(v) => setFeature(fk, "enabled", v)}
                      />
                      <span className="text-sm text-white/70 truncate">{FEATURE_LABELS[fk]}</span>
                    </div>
                    <Input
                      type="number"
                      value={form.features[fk]?.limit_value ?? ""}
                      onChange={(e) => setFeature(fk, "limit_value", e.target.value)}
                      className="bg-white/5 border-white/10 text-white w-24 h-7 text-xs"
                      placeholder="Limite"
                      disabled={!form.features[fk]?.enabled}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/30">Limite vazio = ilimitado. Preencha para restringir (ex: 50 notificações/mês).</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" className="text-white/50" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || !form.nome || !form.slug}
            >
              {saveMutation.isPending ? "Salvando…" : editPlan ? "Salvar alterações" : "Criar plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#0B1525] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Excluir plano?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              O plano <strong className="text-white">{deleteTarget?.nome}</strong> será excluído permanentemente.
              Assinaturas existentes não serão afetadas, mas o plano não poderá ser selecionado para novas assinaturas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-white/70">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
