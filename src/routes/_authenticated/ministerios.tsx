import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Layers, Users, Star } from "lucide-react";
import { ListSkeleton } from "@/components/ui/page-skeleton";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/ministerios")({
  component: MinisteriosPage,
  head: () => ({ meta: [{ title: "Grupos — Lumen Pastoral" }] }),
});

type Ministerio = {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  ordem: number;
  relevancia: "normal" | "principal";
  duplicidade_permitida: boolean;
  ordem_prioridade: number;
};

const CORES = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6B7280",
];

const MINISTERIOS_PADRAO = [
  { nome: "Acólito", descricao: "Auxilia nas celebrações litúrgicas", cor: "#6366f1" },
  { nome: "Leitor", descricao: "Proclama a Palavra de Deus", cor: "#8b5cf6" },
  { nome: "Ministro da Eucaristia", descricao: "Distribui a comunhão", cor: "#22c55e" },
  { nome: "Comentador", descricao: "Guia a participação da assembleia", cor: "#3b82f6" },
  { nome: "Coroinha", descricao: "Auxilia o sacerdote no altar", cor: "#ec4899" },
  { nome: "Auxiliar", descricao: "Apoio geral às celebrações", cor: "#6B7280" },
];

function FormGrupo({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial: Partial<Ministerio>;
  onSave: (data: Omit<Ministerio, "id" | "ordem">) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [nome, setNome] = useState(initial.nome ?? "");
  const [descricao, setDescricao] = useState(initial.descricao ?? "");
  const [cor, setCor] = useState(initial.cor ?? CORES[0]);
  const [relevancia, setRelevancia] = useState<"normal" | "principal">(initial.relevancia ?? "normal");
  const [duplicidade, setDuplicidade] = useState(initial.duplicidade_permitida ?? false);
  const [ordemPrio, setOrdemPrio] = useState(initial.ordem_prioridade ?? 0);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    onSave({
      nome: nome.trim(), descricao: descricao || null, cor, ativo: true,
      relevancia, duplicidade_permitida: duplicidade, ordem_prioridade: ordemPrio,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome do grupo</Label>
        <Input
          id="nome"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Acólito, Leitor, Ministro..."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="descricao">Descrição (opcional)</Label>
        <Textarea
          id="descricao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Breve descrição do grupo"
          rows={2}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Cor de identificação</Label>
        <div className="flex flex-wrap gap-2">
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              className={`h-7 w-7 rounded-full transition ring-offset-2 ${cor === c ? "ring-2 ring-ring" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => setCor(c)}
            />
          ))}
        </div>
      </div>

      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Motor de Escalas V3</p>

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">Função principal</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Em solenidades usa mérito + rodízio. Normal usa equilíbrio de oportunidades.
            </p>
          </div>
          <Switch
            checked={relevancia === "principal"}
            onCheckedChange={(v) => setRelevancia(v ? "principal" : "normal")}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">Permitir multi-função (fallback)</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Se não houver candidatos disponíveis, permite que um membro já escalado assuma esta função.
            </p>
          </div>
          <Switch
            checked={duplicidade}
            onCheckedChange={setDuplicidade}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="ordem_prio" className="text-sm font-medium">Ordem de processamento</Label>
          <p className="text-xs text-muted-foreground">Menor número = processado antes pelo motor (ex: 0 = primeira prioridade).</p>
          <Input
            id="ordem_prio"
            type="number"
            min={0}
            max={999}
            value={ordemPrio}
            onChange={(e) => setOrdemPrio(Number(e.target.value))}
            className="w-24"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || !nome.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function MinisteriosPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Ministerio | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Ministerio | null>(null);

  const { data: ministerios = [], isLoading } = useQuery({
    queryKey: ["ministerios", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ministerios")
        .select("id, nome, descricao, cor, ativo, ordem, relevancia, duplicidade_permitida, ordem_prioridade")
        .eq("paroquia_id", profile!.paroquia_id!)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Ministerio[];
    },
  });

  const { data: contagens = {} } = useQuery({
    queryKey: ["ministerios-contagens", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id && ministerios.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("membro_ministerios")
        .select("ministerio_id")
        .in("ministerio_id", ministerios.map((m) => m.id));
      const map: Record<string, number> = {};
      (data ?? []).forEach((r) => {
        map[r.ministerio_id] = (map[r.ministerio_id] ?? 0) + 1;
      });
      return map;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      id?: string;
      nome: string;
      descricao: string | null;
      cor: string;
      ativo: boolean;
      relevancia: "normal" | "principal";
      duplicidade_permitida: boolean;
      ordem_prioridade: number;
    }) => {
      const campos = {
        nome: payload.nome, descricao: payload.descricao, cor: payload.cor, ativo: payload.ativo,
        relevancia: payload.relevancia, duplicidade_permitida: payload.duplicidade_permitida,
        ordem_prioridade: payload.ordem_prioridade,
      };
      const anyDb = supabase as any;
      if (payload.id) {
        const { error } = await anyDb.from("ministerios").update(campos).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await anyDb.from("ministerios").insert({
          paroquia_id: profile!.paroquia_id!,
          ...campos,
          ordem: ministerios.length,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      toast.success(editTarget ? "Grupo atualizado." : "Grupo criado.");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ministerios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      qc.invalidateQueries({ queryKey: ["ministerios-contagens"] });
      toast.success("Grupo removido.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const rows = MINISTERIOS_PADRAO.map((m, i) => ({
        paroquia_id: profile!.paroquia_id!,
        ...m,
        ordem: i,
      }));
      const { error } = await supabase.from("ministerios").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ministerios"] });
      toast.success("Grupos padrão criados!");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  function openCreate() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  function openEdit(m: Ministerio) {
    setEditTarget(m);
    setDialogOpen(true);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24 lg:pb-10">
      <div className="page-header">
        <div>
          <p className="section-label text-gold mb-2">Configurações</p>
          <h1 className="page-header-title">Grupos de Serviço</h1>
          <p className="page-header-sub">
            Configure os grupos litúrgicos da paróquia.
          </p>
        </div>
        <Button onClick={openCreate} className="h-9 rounded-xl shrink-0">
          <Plus className="h-4 w-4 mr-1" /> Novo grupo
        </Button>
      </div>

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : ministerios.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Layers className="h-5 w-5" />
          </div>
          <p className="empty-state-title">Nenhum grupo cadastrado</p>
          <p className="empty-state-desc">
            Crie os grupos de serviço litúrgico (acólitos, leitores, músicos, etc.) para começar a organizar sua pastoral.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            <Button variant="outline" className="rounded-xl" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Criar grupos padrão
            </Button>
            <Button className="rounded-xl" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Criar manualmente
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {ministerios.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 interactive-card group"
            >
              {/* Color swatch — iOS-style rounded square */}
              <div
                className="h-10 w-10 shrink-0 rounded-xl shadow-sm"
                style={{ backgroundColor: m.cor }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm truncate">{m.nome}</span>
                  {m.relevancia === "principal" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                      <Star className="h-2.5 w-2.5" /> principal
                    </Badge>
                  )}
                  {!m.ativo && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">inativo</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-3 w-3 shrink-0" />
                  <span>{contagens[m.id] ?? 0} membro{(contagens[m.id] ?? 0) !== 1 ? "s" : ""}</span>
                  {m.descricao && (
                    <><span className="text-border">·</span><span className="truncate">{m.descricao}</span></>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" onClick={() => openEdit(m)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(m)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog criar/editar */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) { setDialogOpen(false); setEditTarget(null); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Editar grupo" : "Novo grupo"}</DialogTitle>
          </DialogHeader>
          <FormGrupo
            initial={editTarget ?? {}}
            saving={saveMutation.isPending}
            onClose={() => { setDialogOpen(false); setEditTarget(null); }}
            onSave={(data) =>
              saveMutation.mutate({ id: editTarget?.id, ...data })
            }
          />
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              O grupo <strong>{deleteTarget?.nome}</strong> será removido permanentemente,
              incluindo todas as atribuições de membros a este grupo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
