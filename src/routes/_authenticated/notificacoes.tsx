import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  BellOff, Plus, Loader2, AlertTriangle, Info, Zap, Settings2,
  CheckCheck, Trash2, ChevronRight, X,
} from "lucide-react";
import {
  format, parseISO, isToday, isYesterday, isThisWeek,
  differenceInMinutes, differenceInHours,
} from "date-fns";
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

// ── Types ──────────────────────────────────────────────────────

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

// ── Configuração visual por tipo ───────────────────────────────

const TIPO_CONFIG: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  accent: string;
}> = {
  aviso:   { label: "Aviso",   icon: Info,          iconBg: "bg-blue-500",   accent: "border-l-blue-500" },
  alerta:  { label: "Alerta",  icon: AlertTriangle, iconBg: "bg-amber-400",  accent: "border-l-amber-400" },
  urgente: { label: "Urgente", icon: Zap,            iconBg: "bg-red-500",    accent: "border-l-red-500" },
  sistema: { label: "Sistema", icon: Settings2,      iconBg: "bg-slate-400",  accent: "border-l-slate-400" },
};

const TIPO_FILTROS = [
  { value: "todos",   label: "Todas" },
  { value: "aviso",   label: "Avisos" },
  { value: "alerta",  label: "Alertas" },
  { value: "urgente", label: "Urgentes" },
  { value: "sistema", label: "Sistema" },
];

// ── Helpers ────────────────────────────────────────────────────

function getGrupoData(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  if (isThisWeek(d, { weekStartsOn: 0 })) return format(d, "EEEE", { locale: ptBR });
  return format(d, "d 'de' MMMM", { locale: ptBR });
}

function tempoRelativo(dateStr: string): string {
  const d = parseISO(dateStr);
  const mins = differenceInMinutes(new Date(), d);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = differenceInHours(new Date(), d);
  if (hrs < 24) return `${hrs}h`;
  return format(d, "d MMM", { locale: ptBR });
}

// ── Card iOS ───────────────────────────────────────────────────

function NotifCard({
  n,
  onMarcarLida,
  onDelete,
  isMarkingRead,
}: {
  n: Notificacao;
  onMarcarLida: (id: string) => void;
  onDelete: (n: Notificacao) => void;
  isMarkingRead: boolean;
}) {
  const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
  const Icon = cfg.icon;
  const isLida = n.lida;

  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStartX = useRef(0);
  const THRESHOLD = 80;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < 0) setSwipeX(Math.max(dx, -(THRESHOLD + 12)));
  }
  function onTouchEnd() {
    setSwiping(false);
    if (swipeX <= -THRESHOLD) onDelete(n);
    setSwipeX(0);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Reveal vermelho */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 rounded-r-2xl"
        style={{ width: Math.abs(swipeX) || 72 }}
      >
        <Trash2 className="h-5 w-5 text-white" />
      </div>

      {/* Card */}
      <div
        className={[
          "relative flex items-start gap-3 px-4 py-3.5 rounded-2xl border-l-4",
          "transition-all duration-300",
          !isLida
            ? cfg.accent + " bg-card shadow-sm"
            : "border-l-transparent bg-muted/30",
        ].join(" ")}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swiping ? "none" : "transform 0.25s cubic-bezier(.4,0,.2,1)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Ícone redondo */}
        <div
          className={[
            "shrink-0 h-10 w-10 rounded-2xl flex items-center justify-center mt-0.5 transition-all duration-300",
            isLida ? "bg-muted text-muted-foreground/40" : `${cfg.iconBg} text-white`,
          ].join(" ")}
        >
          {isLida
            ? <CheckCheck className="h-[18px] w-[18px]" />
            : <Icon className="h-[18px] w-[18px]" />}
        </div>

        {/* Conteúdo */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => !isLida && !isMarkingRead && onMarcarLida(n.id)}
        >
          {/* Linha: tipo + tempo */}
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${isLida ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                {cfg.label}
              </span>
              {isLida && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/50 leading-none">
                  Lida
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground/50 shrink-0 ml-2">
              {tempoRelativo(n.created_at)}
            </span>
          </div>

          {/* Título */}
          <div className="flex items-start gap-1.5">
            {!isLida && (
              <span className="mt-[5px] shrink-0 h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            )}
            <p className={`text-sm font-semibold leading-snug transition-colors duration-300 ${isLida ? "text-foreground/50 font-normal" : "text-foreground"}`}>
              {n.titulo}
            </p>
          </div>

          {/* Mensagem */}
          {n.mensagem && (
            <p className={`text-xs mt-0.5 leading-relaxed line-clamp-2 ${isLida ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
              {n.mensagem}
            </p>
          )}

          {/* CTA marcar lida */}
          {!isLida && (
            <div className="flex items-center gap-0.5 mt-1.5">
              <span className="text-[11px] text-blue-500 font-medium">Marcar como lida</span>
              <ChevronRight className="h-3 w-3 text-blue-500" />
            </div>
          )}
        </div>

        {/* Ações desktop */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!isLida && (
            <button
              type="button"
              onClick={() => onMarcarLida(n.id)}
              disabled={isMarkingRead}
              title="Marcar como lida"
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-blue-500 hover:bg-blue-500/10 transition"
            >
              {isMarkingRead
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(n)}
            title="Excluir"
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Separador de data ──────────────────────────────────────────

function DateDivider({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60 capitalize">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[10px] text-muted-foreground/40 tabular-nums">{count}</span>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────

function NotificacoesPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;
  const qc = useQueryClient();

  const [tipoFiltro, setTipoFiltro] = useState("todos");
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
    onError: (e: unknown) => toast.error((e as Error).message),
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
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("notificacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", pid] });
      toast.success("Notificação removida.");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error("Erro ao remover: " + (e as Error).message),
  });

  const criarMutation = useMutation({
    mutationFn: async (form: NovaNotificacaoForm) => {
      const { error } = await anyDb.from("notificacoes").insert({
        paroquia_id:     pid,
        titulo:          form.titulo,
        mensagem:        form.mensagem || null,
        tipo:            form.tipo,
        apenas_admin:    false,
        destinatario_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", pid] });
      toast.success("Notificação publicada.");
      setNovaOpen(false);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const filtered = tipoFiltro === "todos"
    ? notificacoes
    : notificacoes.filter((n) => n.tipo === tipoFiltro);

  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  // Agrupa por data
  const grupos = useMemo(() => {
    const map = new Map<string, Notificacao[]>();
    for (const n of filtered) {
      const g = getGrupoData(n.created_at);
      const arr = map.get(g) ?? [];
      arr.push(n);
      map.set(g, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto pb-24">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground mb-1">
            Comunicação
          </p>
          <h1 className="font-serif text-2xl flex items-center gap-2">
            Notificações
            {naoLidas > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-bold px-1.5">
                {naoLidas}
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {naoLidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => marcarTodasMutation.mutate()}
              disabled={marcarTodasMutation.isPending}
              className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 text-xs font-semibold h-8 px-3"
            >
              {marcarTodasMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <CheckCheck className="h-3.5 w-3.5 mr-1" />}
              Limpar todas
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setNovaOpen(true)}
            className="h-8 rounded-xl"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nova
          </Button>
        </div>
      </div>

      {/* ── Filtro por tipo ─────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {TIPO_FILTROS.map((f) => {
          const ativo = tipoFiltro === f.value;
          const cfg = f.value !== "todos" ? TIPO_CONFIG[f.value] : null;
          const count = f.value === "todos"
            ? naoLidas
            : notificacoes.filter((n) => n.tipo === f.value && !n.lida).length;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setTipoFiltro(f.value)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0",
                ativo
                  ? "bg-foreground text-background shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              ].join(" ")}
            >
              {cfg && (
                <span className={`inline-flex h-3 w-3 rounded-full ${cfg.iconBg}`} />
              )}
              {f.label}
              {count > 0 && (
                <span className={[
                  "h-4 min-w-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                  ativo ? "bg-background/20 text-background" : "bg-blue-500 text-white",
                ].join(" ")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Conteúdo ────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="h-16 w-16 rounded-3xl bg-muted flex items-center justify-center">
            <BellOff className="h-7 w-7 text-muted-foreground/30" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {tipoFiltro === "todos" ? "Nenhuma notificação" : "Nenhuma notificação nesta categoria"}
          </p>
          {tipoFiltro !== "todos" && (
            <button
              type="button"
              onClick={() => setTipoFiltro("todos")}
              className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
            >
              <X className="h-3 w-3" /> Ver todas
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grupos.entries()).map(([grupo, itens]) => (
            <section key={grupo}>
              <DateDivider label={grupo} count={itens.length} />
              <div className="space-y-2 mt-2">
                {itens.map((n) => (
                  <NotifCard
                    key={n.id}
                    n={n}
                    onMarcarLida={(id) => marcarLidaMutation.mutate(id)}
                    onDelete={setDeleteTarget}
                    isMarkingRead={marcarLidaMutation.isPending}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Nova notificação ───────────────────────────────────── */}
      <NovaNotificacaoDialog
        open={novaOpen}
        saving={criarMutation.isPending}
        onClose={() => setNovaOpen(false)}
        onSave={(data) => criarMutation.mutate(data)}
      />

      {/* ── Confirmar exclusão ─────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover notificação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── NovaNotificacaoDialog ──────────────────────────────────────

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

  function submit(e: { preventDefault(): void }) {
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
            <Label>Título <span className="text-destructive">*</span></Label>
            <Input
              required
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Reunião de coordenadores confirmada"
            />
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
            <Label>Mensagem <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Textarea
              rows={3}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Detalhes da notificação…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onClose(); reset(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !titulo.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Publicar para todos
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
