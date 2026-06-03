import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BellOff, Plus, Loader2, AlertTriangle, Info,
  Zap, Settings2, CheckCheck, Trash2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/notificacoes")({
  component: NotificacoesPage,
  head: () => ({ meta: [{ title: "Notificações — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Notificacao = {
  id: string;
  titulo: string;
  mensagem: string | null;
  tipo: "aviso" | "alerta" | "urgente" | "sistema";
  lida: boolean;
  destinatario_id: string | null;
  created_at: string;
  link_referencia: string | null;
};

type NovaNotificacaoForm = {
  titulo: string;
  mensagem: string;
  tipo: "aviso" | "alerta" | "urgente" | "sistema";
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPO_CONFIG: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCls: string;
  dotCls: string;
}> = {
  aviso:   { label: "Aviso",   icon: Info,          badgeCls: "bg-blue-500/10 text-blue-700 border-blue-200",    dotCls: "bg-blue-500" },
  alerta:  { label: "Alerta",  icon: AlertTriangle, badgeCls: "bg-amber-500/10 text-amber-700 border-amber-200", dotCls: "bg-amber-500" },
  urgente: { label: "Urgente", icon: Zap,            badgeCls: "bg-red-500/10 text-red-700 border-red-200",       dotCls: "bg-red-500" },
  sistema: { label: "Sistema", icon: Settings2,      badgeCls: "bg-slate-500/10 text-slate-700 border-slate-200", dotCls: "bg-slate-500" },
};

const FILTROS = [
  { value: "todas",   label: "Todas" },
  { value: "nao_lidas", label: "Não lidas" },
  { value: "aviso",   label: "Avisos" },
  { value: "alerta",  label: "Alertas" },
  { value: "urgente", label: "Urgentes" },
  { value: "sistema", label: "Sistema" },
];

// ── Main Component ─────────────────────────────────────────────────────────────

function NotificacoesPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const qc = useQueryClient();

  const [filtro, setFiltro] = useState("todas");
  const [novaOpen, setNovaOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Notificacao | null>(null);

  const { data: notificacoes = [], isLoading } = useQuery<Notificacao[]>({
    queryKey: ["notificacoes", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("notificacoes")
        .select("id,titulo,mensagem,tipo,lida,destinatario_id,created_at,link_referencia")
        .eq("paroquia_id", pid)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Notificacao[];
    },
  });

  const marcarLidaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("notificacoes").update({ lida: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notificacoes", pid] }),
  });

  const marcarTodasMutation = useMutation({
    mutationFn: async () => {
      const { error } = await anyDb.from("notificacoes").update({ lida: true }).eq("paroquia_id", pid).eq("lida", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", pid] });
      toast.success("Todas marcadas como lidas.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("notificacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", pid] });
      toast.success("Notificação removida."); setDeleteTarget(null);
    },
  });

  const criarMutation = useMutation({
    mutationFn: async (form: NovaNotificacaoForm) => {
      const { error } = await anyDb.from("notificacoes").insert({
        paroquia_id: pid,
        titulo: form.titulo,
        mensagem: form.mensagem || null,
        tipo: form.tipo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", pid] });
      toast.success("Notificação criada."); setNovaOpen(false);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  const filtradas = notificacoes.filter((n) => {
    if (filtro === "nao_lidas") return !n.lida;
    if (filtro === "todas") return true;
    return n.tipo === filtro;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto space-y-6 pb-24 lg:pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Comunicação</p>
          <h1 className="mt-2 font-serif text-2xl sm:text-3xl flex items-center gap-2">
            Notificações
            {naoLidas > 0 && (
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
                {naoLidas > 9 ? "9+" : naoLidas}
              </span>
            )}
          </h1>
        </div>
        <div className="flex gap-2 shrink-0">
          {naoLidas > 0 && (
            <Button
              variant="outline" size="sm"
              onClick={() => marcarTodasMutation.mutate()}
              disabled={marcarTodasMutation.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-1" /> Marcar todas lidas
            </Button>
          )}
          <Button size="sm" onClick={() => setNovaOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFiltro(f.value)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              filtro === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
            {f.value === "nao_lidas" && naoLidas > 0 && (
              <span className="ml-1 font-bold text-red-500">{naoLidas}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <BellOff className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">Nenhuma notificação</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filtro === "todas" ? "Nenhuma notificação cadastrada ainda." : "Nenhuma notificação nesta categoria."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {filtradas.map((n) => {
            const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
            const Icon = cfg.icon;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-4 px-5 py-4 transition ${
                  !n.lida ? "bg-primary/5" : ""
                }`}
              >
                <div className={`mt-0.5 h-8 w-8 rounded-full grid place-items-center shrink-0 ${cfg.badgeCls}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => !n.lida && marcarLidaMutation.mutate(n.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm ${!n.lida ? "font-semibold" : "font-medium"}`}>{n.titulo}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.badgeCls}`}>
                      {cfg.label}
                    </span>
                    {!n.lida && (
                      <span className={`h-2 w-2 rounded-full ${cfg.dotCls}`} />
                    )}
                  </div>
                  {n.mensagem && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.mensagem}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(parseISO(n.created_at), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(n)}
                  className="mt-0.5 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Nova notificação */}
      <NovaNotificacaoDialog
        open={novaOpen}
        saving={criarMutation.isPending}
        onClose={() => setNovaOpen(false)}
        onSave={(data) => criarMutation.mutate(data)}
      />

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover notificação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── NovaNotificacaoDialog ─────────────────────────────────────────────────────

function NovaNotificacaoDialog({
  open, saving, onClose, onSave,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (data: NovaNotificacaoForm) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [tipo, setTipo] = useState<"aviso" | "alerta" | "urgente" | "sistema">("aviso");

  function reset() { setTitulo(""); setMensagem(""); setTipo("aviso"); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    onSave({ titulo: titulo.trim(), mensagem, tipo });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova notificação</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input required value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Reunião de coordenadores confirmada" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aviso">Aviso</SelectItem>
                <SelectItem value="alerta">Alerta</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
                <SelectItem value="sistema">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Mensagem (opcional)</Label>
            <Textarea rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Detalhes da notificação…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onClose(); reset(); }}>Cancelar</Button>
            <Button type="submit" disabled={saving || !titulo.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publicar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
