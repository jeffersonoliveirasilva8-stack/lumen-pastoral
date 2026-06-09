import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BellOff, Plus, Loader2, AlertTriangle, Info,
  Zap, Settings2, CheckCheck, Trash2, Clock, History, ChevronDown, ChevronUp,
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

const TIPO_FILTROS = [
  { value: "todos", label: "Todos os tipos" },
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

  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [novaOpen, setNovaOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Notificacao | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState(false);

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
      setHistoricoOpen(true);
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

  const filtered = tipoFiltro === "todos"
    ? notificacoes
    : notificacoes.filter((n) => n.tipo === tipoFiltro);

  const pendentes = filtered.filter((n) => !n.lida);
  const lidas = filtered.filter((n) => n.lida);
  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto space-y-6 pb-24 lg:pb-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Comunicação</p>
          <h1 className="mt-2 font-serif text-2xl sm:text-3xl flex items-center gap-2">
            Notificações
            {naoLidas > 0 && (
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1.5">
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
              {marcarTodasMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />
              }
              <span className="hidden sm:inline">Marcar todas lidas</span>
            </Button>
          )}
          <Button size="sm" onClick={() => setNovaOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nova</span>
          </Button>
        </div>
      </div>

      {/* Filtro por tipo */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
        {TIPO_FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setTipoFiltro(f.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              tipoFiltro === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── PENDENTES ─────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/70">
                Pendentes
              </h2>
              {pendentes.length > 0 && (
                <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                  {pendentes.length}
                </span>
              )}
            </div>

            {pendentes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                <CheckCheck className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma notificação pendente.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                {pendentes.map((n) => (
                  <NotificacaoItem
                    key={n.id}
                    n={n}
                    onMarcarLida={(id) => marcarLidaMutation.mutate(id)}
                    onDelete={setDeleteTarget}
                    isMarkingRead={marcarLidaMutation.isPending}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── LIDAS / HISTÓRICO ─────────────────────────────────────────── */}
          {lidas.length > 0 && (
            <section>
              <button
                type="button"
                className="flex items-center gap-2 mb-3 w-full group"
                onClick={() => setHistoricoOpen((o) => !o)}
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/50 group-hover:text-foreground/70 transition">
                  Histórico
                </h2>
                <span className="text-xs text-muted-foreground/60 bg-muted rounded-full px-2 py-0.5">
                  {lidas.length}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {historicoOpen
                    ? <ChevronUp className="h-4 w-4" />
                    : <ChevronDown className="h-4 w-4" />
                  }
                </span>
              </button>

              {historicoOpen && (
                <div className="rounded-2xl border border-border bg-card/50 overflow-hidden divide-y divide-border/60">
                  {lidas.map((n) => (
                    <NotificacaoItem
                      key={n.id}
                      n={n}
                      onMarcarLida={() => {}}
                      onDelete={setDeleteTarget}
                      isMarkingRead={false}
                      dimmed
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Estado vazio total */}
          {pendentes.length === 0 && lidas.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-16 text-center">
              <BellOff className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="font-medium">Nenhuma notificação</p>
              <p className="text-sm text-muted-foreground mt-1">
                {tipoFiltro === "todos"
                  ? "Nenhuma notificação cadastrada ainda."
                  : "Nenhuma notificação nesta categoria."}
              </p>
            </div>
          )}
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

// ── NotificacaoItem ───────────────────────────────────────────────────────────

function NotificacaoItem({
  n,
  onMarcarLida,
  onDelete,
  isMarkingRead,
  dimmed = false,
}: {
  n: Notificacao;
  onMarcarLida: (id: string) => void;
  onDelete: (n: Notificacao) => void;
  isMarkingRead: boolean;
  dimmed?: boolean;
}) {
  const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
  const Icon = cfg.icon;

  return (
    <div className={`flex items-start gap-4 px-5 py-4 transition ${dimmed ? "opacity-60" : ""}`}>
      <div className={`mt-0.5 h-8 w-8 rounded-full grid place-items-center shrink-0 ${cfg.badgeCls}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div
        className={`flex-1 min-w-0 ${!n.lida ? "cursor-pointer" : ""}`}
        onClick={() => !n.lida && !isMarkingRead && onMarcarLida(n.id)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm ${!n.lida ? "font-semibold" : "font-medium text-foreground/70"}`}>
            {n.titulo}
          </p>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.badgeCls}`}>
            {cfg.label}
          </span>
          {!n.lida && (
            <span className={`h-2 w-2 rounded-full ${cfg.dotCls} shrink-0`} />
          )}
        </div>
        {n.mensagem && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.mensagem}</p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-1">
          {format(parseISO(n.created_at), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
        </p>
        {!n.lida && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMarcarLida(n.id); }}
            className="mt-2 text-[11px] text-primary/70 hover:text-primary font-medium underline-offset-2 hover:underline transition"
          >
            Marcar como lida →
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(n)}
        className="mt-0.5 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
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
