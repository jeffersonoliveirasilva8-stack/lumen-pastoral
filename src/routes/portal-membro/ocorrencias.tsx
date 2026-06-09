import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, AlertTriangle, CheckCircle2, Clock, Plus, X,
  ChevronDown, ChevronUp, MessageSquare, Trash2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/ocorrencias")({
  component: PortalMembroOcorrencias,
  head: () => ({ meta: [{ title: "Ocorrências — Portal do Servidor" }] }),
});

const TIPOS = [
  { value: "problema_pastoral",      label: "Problema pastoral",         icon: "⚠️" },
  { value: "dificuldade_pessoal",    label: "Dificuldade pessoal",       icon: "🙏" },
  { value: "ausencia_futura",        label: "Ausência futura",           icon: "⏳" },
  { value: "situacao_urgente",       label: "Situação urgente",          icon: "🚨" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  aberta:      { label: "Aberta",      color: "text-amber-600 bg-amber-50 border-amber-200",    icon: <Clock className="h-3 w-3" /> },
  em_analise:  { label: "Em análise",  color: "text-blue-600 bg-blue-50 border-blue-200",       icon: <AlertTriangle className="h-3 w-3" /> },
  resolvida:   { label: "Resolvida",   color: "text-green-600 bg-green-50 border-green-200",    icon: <CheckCircle2 className="h-3 w-3" /> },
  arquivada:   { label: "Arquivada",   color: "text-muted-foreground bg-muted border-border",   icon: <X className="h-3 w-3" /> },
};

type Ocorrencia = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  status: string;
  resposta: string | null;
  created_at: string;
};

function PortalMembroOcorrencias() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    tipo: "problema_pastoral",
    titulo: "",
    descricao: "",
  });

  const { data: ocorrencias = [], isLoading } = useQuery<Ocorrencia[]>({
    queryKey: ["pm-ocorrencias", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("ocorrencias_membros")
        .select("id, tipo, titulo, descricao, status, resposta, created_at")
        .eq("membro_id", membro!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!membro) throw new Error("Membro não autenticado.");
      const { error } = await anyDb
        .from("ocorrencias_membros")
        .insert({
          paroquia_id: membro.paroquia_id,
          membro_id:   membro.id,
          tipo:        form.tipo,
          titulo:      form.titulo.trim(),
          descricao:   form.descricao.trim(),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-ocorrencias", membro?.id] });
      setForm({ tipo: "problema_pastoral", titulo: "", descricao: "" });
      setShowForm(false);
      toast.success("Ocorrência registrada. A coordenação foi notificada.");
    },
    onError: (e: Error) => toast.error("Erro ao registrar: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!membro?.id) throw new Error("Não autenticado.");
      const { data: deleted, error } = await anyDb
        .from("ocorrencias_membros")
        .delete()
        .eq("id", id)
        .eq("membro_id", membro.id)
        .eq("status", "aberta")
        .is("resposta", null)
        .select("id");
      if (error) throw error;
      if (!deleted?.length) {
        throw new Error("Não foi possível excluir. A ocorrência pode já ter sido respondida ou alterada.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-ocorrencias", membro?.id] });
      setDeleteId(null);
      setExpandedId(null);
      toast.success("Ocorrência excluída.");
    },
    onError: (e: Error) => toast.error("Erro ao excluir: " + e.message),
  });

  const canSubmit = form.titulo.trim().length >= 3 && form.descricao.trim().length >= 10;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-24 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
          <h1 className="mt-1.5 font-serif text-3xl">Ocorrências</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Envie um problema pastoral, dificuldade pessoal, ausência futura ou situação urgente para a coordenação.
          </p>
        </div>
        {!showForm && (
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="shrink-0 mt-1"
          >
            <Plus className="h-4 w-4" />
            Enviar ocorrência
          </Button>
        )}
      </div>

      {/* Formulário de nova ocorrência */}
      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-altar">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Enviar ocorrência</p>
            <button
              onClick={() => setShowForm(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tipo */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, tipo: t.value }))}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                    form.tipo === t.value
                      ? "border-primary/50 bg-primary/8 text-primary"
                      : "border-border bg-background text-foreground/70 hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  <span>{t.icon}</span>
                  <span className="leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Título */}
          <div className="space-y-1.5">
            <Label htmlFor="oc-titulo">Título</Label>
            <Input
              id="oc-titulo"
              placeholder="Resumo breve da ocorrência"
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
            />
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="oc-desc">Descrição</Label>
            <textarea
              id="oc-desc"
              rows={4}
              placeholder="Descreva a situação com detalhes para que a coordenação possa analisar…"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none placeholder:text-muted-foreground"
            />
            <p className="text-[11px] text-muted-foreground text-right">
              {form.descricao.trim().length}/10 mín.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!canSubmit || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <MessageSquare className="h-4 w-4" />
              }
              Registrar ocorrência
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            A coordenação receberá uma notificação automática.
          </p>
        </div>
      )}

      {/* Lista de ocorrências */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : ocorrencias.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-border p-12 text-center">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Use o botão acima para comunicar algo à coordenação.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ocorrencias.map((oc) => {
            const tipo = TIPOS.find((t) => t.value === oc.tipo);
            const statusCfg = STATUS_CONFIG[oc.status] ?? STATUS_CONFIG.aberta;
            const isExpanded = expandedId === oc.id;

            return (
              <div
                key={oc.id}
                className="rounded-2xl border border-border bg-card shadow-altar overflow-hidden"
              >
                <button
                  className="w-full text-left px-4 py-4"
                  onClick={() => setExpandedId(isExpanded ? null : oc.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm">{tipo?.icon ?? "📋"}</span>
                        <span className="text-xs text-muted-foreground">{tipo?.label ?? oc.tipo}</span>
                      </div>
                      <p className="text-sm font-semibold leading-snug">{oc.titulo}</p>
                      <p className="text-xs text-muted-foreground capitalize mt-0.5">
                        {format(new Date(oc.created_at), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.color}`}
                      >
                        {statusCfg.icon}
                        {statusCfg.label}
                      </span>
                      {isExpanded
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 px-4 py-4 space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Descrição</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">{oc.descricao}</p>
                    </div>
                    {oc.resposta && (
                      <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-4 py-3">
                        <p className="text-[10px] uppercase tracking-wider text-green-700 dark:text-green-400 mb-1">
                          Resposta da coordenação
                        </p>
                        <p className="text-sm text-green-900 dark:text-green-200 leading-relaxed">{oc.resposta}</p>
                      </div>
                    )}
                    {oc.status === "aberta" && !oc.resposta && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteId(oc.id); }}
                        className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition mt-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir ocorrência
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ocorrência?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A ocorrência será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
