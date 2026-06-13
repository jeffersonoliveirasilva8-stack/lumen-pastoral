import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { format, parseISO, isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BellOff, CheckCheck, Loader2, Trash2, Calendar, ArrowLeftRight,
  Megaphone, Users, Church, AlertTriangle, Zap, Settings2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/notificacoes")({
  component: PortalMembroNotificacoes,
  head: () => ({ meta: [{ title: "Notificações — Portal do Servidor" }] }),
});

type Notificacao = {
  id: string;
  titulo: string;
  mensagem: string | null;
  tipo: string;
  created_at: string;
  link_referencia: string | null;
  destinatario_id: string | null;
};

type Categoria = "todas" | "escalas" | "substituicoes" | "eventos" | "comunicados" | "pendencias" | "urgente" | "membros" | "sistema";

const CATEGORIA_CONFIG: Record<Exclude<Categoria, "todas">, {
  label: string;
  emoji: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}> = {
  urgente:       { label: "Urgente",       emoji: "🚨", icon: Zap,           color: "text-red-600",    bg: "bg-red-500/10 border-red-200 dark:border-red-800" },
  pendencias:    { label: "Pendências",    emoji: "⚠️",  icon: AlertTriangle, color: "text-amber-600",  bg: "bg-amber-500/10 border-amber-200 dark:border-amber-800" },
  escalas:       { label: "Escalas",       emoji: "📅", icon: Calendar,      color: "text-blue-600",   bg: "bg-blue-500/10 border-blue-200 dark:border-blue-800" },
  substituicoes: { label: "Substituições", emoji: "🔄", icon: ArrowLeftRight, color: "text-violet-600", bg: "bg-violet-500/10 border-violet-200 dark:border-violet-800" },
  eventos:       { label: "Eventos",       emoji: "⛪", icon: Church,        color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-200 dark:border-emerald-800" },
  comunicados:   { label: "Comunicados",   emoji: "📢", icon: Megaphone,     color: "text-sky-600",    bg: "bg-sky-500/10 border-sky-200 dark:border-sky-800" },
  membros:       { label: "Membros",       emoji: "👥", icon: Users,         color: "text-pink-600",   bg: "bg-pink-500/10 border-pink-200 dark:border-pink-800" },
  sistema:       { label: "Sistema",       emoji: "⚙️",  icon: Settings2,    color: "text-slate-600",  bg: "bg-slate-500/10 border-slate-200 dark:border-slate-800" },
};

// Derivar categoria a partir de tipo + link_referencia
function getCategoria(n: Notificacao): Exclude<Categoria, "todas"> {
  if (n.tipo === "urgente") return "urgente";
  if (n.tipo === "sistema") return "sistema";
  const link = n.link_referencia ?? "";
  if (link.includes("/escala")) return "escalas";
  if (link.includes("/substituic") || link.includes("/troca")) return "substituicoes";
  if (link.includes("/evento")) return "eventos";
  if (link.includes("/perfil") || link.includes("/membro")) return "membros";
  if (n.tipo === "alerta") return "pendencias";
  return "comunicados";
}

function getGrupoData(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  if (isThisWeek(d, { weekStartsOn: 0 })) return format(d, "EEEE", { locale: ptBR });
  if (isThisMonth(d)) return format(d, "'Dia' d", { locale: ptBR });
  return format(d, "MMMM 'de' yyyy", { locale: ptBR });
}

// Componente de card com swipe para deletar (mobile)
function NotifCard({
  n,
  isLida,
  podeExcluir,
  onTap,
  onDelete,
  onMarcarLida,
  isPendingLida,
}: {
  n: Notificacao;
  isLida: boolean;
  podeExcluir: boolean;
  onTap: () => void;
  onDelete: () => void;
  onMarcarLida: () => void;
  isPendingLida: boolean;
}) {
  const cat = getCategoria(n);
  const cfg = CATEGORIA_CONFIG[cat];
  const Icon = cfg.icon;
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStartX = useRef(0);
  const SWIPE_THRESHOLD = 72;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < 0 && podeExcluir) setSwipeX(Math.max(dx, -SWIPE_THRESHOLD - 8));
  }
  function onTouchEnd() {
    setSwiping(false);
    if (swipeX <= -SWIPE_THRESHOLD) {
      onDelete();
    }
    setSwipeX(0);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Fundo vermelho de exclusão (swipe) */}
      {podeExcluir && (
        <div className="absolute inset-y-0 right-0 w-16 flex items-center justify-center bg-destructive rounded-r-2xl">
          <Trash2 className="h-4 w-4 text-white" />
        </div>
      )}

      {/* Card principal */}
      <div
        className={[
          "relative transition-all duration-200",
          "rounded-2xl border",
          isLida
            ? "bg-card/60 border-border opacity-60"
            : cfg.bg,
          n.tipo === "urgente" && !isLida ? "shadow-md ring-1 ring-red-400/30" : "",
        ].join(" ")}
        style={{
          transform: swiping ? `translateX(${swipeX}px)` : undefined,
          transition: swiping ? "none" : "transform 0.2s ease",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          className="w-full text-left px-4 py-3.5"
          onClick={onTap}
          disabled={isPendingLida}
        >
          <div className="flex items-start gap-3">
            {/* Ícone de categoria */}
            <div className={[
              "shrink-0 h-9 w-9 rounded-xl flex items-center justify-center mt-0.5",
              isLida ? "bg-muted" : (n.tipo === "urgente" ? "bg-red-100 dark:bg-red-900/40" : "bg-background/70"),
            ].join(" ")}>
              <Icon className={`h-4 w-4 ${isLida ? "text-muted-foreground" : cfg.color}`} />
            </div>

            {/* Conteúdo */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-semibold leading-snug ${isLida ? "text-foreground/60" : ""}`}>
                  {n.titulo}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isLida && <span className="h-2 w-2 rounded-full bg-primary" />}
                </div>
              </div>

              {n.mensagem && (
                <p className={`text-xs mt-1 leading-relaxed line-clamp-2 ${isLida ? "text-muted-foreground/70" : "text-foreground/75"}`}>
                  {n.mensagem}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${isLida ? "bg-muted text-muted-foreground/60" : "bg-background/50 " + cfg.color}`}>
                  {cfg.emoji} {cfg.label}
                </span>
                <span className="text-[10px] text-foreground/40">·</span>
                <span className="text-[10px] text-foreground/50 capitalize">
                  {format(parseISO(n.created_at), "HH:mm", { locale: ptBR })}
                </span>
                {n.link_referencia && !isLida && (
                  <>
                    <span className="text-[10px] text-foreground/40">·</span>
                    <span className="text-[10px] text-primary underline underline-offset-2">Abrir</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </button>

        {/* Botões de ação (desktop / non-swipe) */}
        {(!isLida || podeExcluir) && (
          <div className="flex border-t border-current/10">
            {!isLida && (
              <button
                type="button"
                onClick={onMarcarLida}
                disabled={isPendingLida}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5 transition rounded-bl-2xl"
              >
                <CheckCheck className="h-3 w-3" />
                Marcar como lida
              </button>
            )}
            {podeExcluir && (
              <button
                type="button"
                onClick={onDelete}
                className={[
                  "flex items-center justify-center gap-1.5 px-4 py-2 text-xs text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition",
                  !isLida ? "border-l border-current/10 rounded-br-2xl" : "flex-1 rounded-b-2xl",
                ].join(" ")}
              >
                <Trash2 className="h-3 w-3" />
                Excluir
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PortalMembroNotificacoes() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<Categoria>("todas");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: notifs = [], isLoading } = useQuery<Notificacao[]>({
    queryKey: ["pm-notificacoes", membro?.paroquia_id, membro?.id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("notificacoes")
        .select("id, titulo, mensagem, tipo, created_at, link_referencia, destinatario_id")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("apenas_admin", false)
        .or(`destinatario_id.is.null,destinatario_id.eq.${membro!.id}`)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: minhasLeituras = [] } = useQuery<{ notificacao_id: string }[]>({
    queryKey: ["pm-notif-leituras", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("notificacoes_leituras")
        .select("notificacao_id")
        .eq("membro_id", membro!.id);
      return data ?? [];
    },
  });

  const lidasSet = useMemo(
    () => new Set(minhasLeituras.map((l) => l.notificacao_id)),
    [minhasLeituras],
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb
        .from("notificacoes").delete()
        .eq("id", id).eq("destinatario_id", membro!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
      qc.invalidateQueries({ queryKey: ["pm-notif-leituras"] });
      setDeleteId(null);
      toast.success("Notificação removida.");
    },
    onError: (e: Error) => toast.error("Erro ao remover: " + e.message),
  });

  const marcarLidaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await anyDb.rpc("portal_marcar_notificacao_lida", { p_notif_id: id });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error ?? "Falha");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notif-leituras"] });
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      qc.invalidateQueries({ queryKey: ["urgent-notifs"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  const marcarTodasMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await anyDb.rpc("portal_marcar_todas_notificacoes_lidas");
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error ?? "Falha");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notif-leituras"] });
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      qc.invalidateQueries({ queryKey: ["urgent-notifs"] });
      toast.success("Todas marcadas como lidas.");
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  function handleTap(n: Notificacao) {
    if (!lidasSet.has(n.id)) marcarLidaMutation.mutate(n.id);
    if (n.link_referencia?.startsWith("/portal-membro/")) {
      navigate({ to: n.link_referencia as never });
    }
  }

  // Contagem por categoria para badges dos filtros
  const contagemPorCategoria = useMemo(() => {
    const map: Partial<Record<Categoria, number>> = {};
    for (const n of notifs) {
      if (lidasSet.has(n.id)) continue;
      const cat = getCategoria(n);
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return map;
  }, [notifs, lidasSet]);

  const naoLidasTotal = notifs.filter((n) => !lidasSet.has(n.id)).length;

  // Filtra + organiza por data
  const notifsFiltradas = useMemo(() => {
    return filtro === "todas"
      ? notifs
      : notifs.filter((n) => getCategoria(n) === filtro);
  }, [notifs, filtro]);

  // Agrupa por grupo de data
  const grupos = useMemo(() => {
    const map = new Map<string, Notificacao[]>();
    for (const n of notifsFiltradas) {
      const g = getGrupoData(n.created_at);
      const arr = map.get(g) ?? [];
      arr.push(n);
      map.set(g, arr);
    }
    return map;
  }, [notifsFiltradas]);

  const FILTROS_ORDENADOS: Categoria[] = [
    "todas", "urgente", "escalas", "pendencias", "eventos", "comunicados", "membros", "substituicoes", "sistema",
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
          <h1 className="mt-1.5 font-serif text-3xl flex items-center gap-2.5">
            Notificações
            {naoLidasTotal > 0 && (
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold px-2">
                {naoLidasTotal}
              </span>
            )}
          </h1>
        </div>
        {naoLidasTotal > 0 && (
          <Button
            variant="outline" size="sm"
            onClick={() => marcarTodasMutation.mutate()}
            disabled={marcarTodasMutation.isPending}
            className="self-start sm:mt-1 shrink-0"
          >
            {marcarTodasMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCheck className="h-3.5 w-3.5" />}
            Marcar todas
          </Button>
        )}
      </div>

      {/* ── Filtros de categoria (scroll horizontal) ───────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {FILTROS_ORDENADOS.map((cat) => {
          const isAll = cat === "todas";
          const cfg = isAll ? null : CATEGORIA_CONFIG[cat as Exclude<Categoria, "todas">];
          const count = isAll ? naoLidasTotal : (contagemPorCategoria[cat] ?? 0);
          const ativo = filtro === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFiltro(cat)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
                ativo
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              ].join(" ")}
            >
              {cfg ? <span>{cfg.emoji}</span> : null}
              <span>{isAll ? "Todas" : cfg!.label}</span>
              {count > 0 && (
                <span className={[
                  "h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                  ativo ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary",
                ].join(" ")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Conteúdo ───────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : notifsFiltradas.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-border p-14 text-center">
          <BellOff className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {filtro === "todas" ? "Nenhuma notificação." : "Nenhuma notificação nesta categoria."}
          </p>
          {filtro !== "todas" && (
            <button
              type="button"
              onClick={() => setFiltro("todas")}
              className="mt-3 text-xs text-primary hover:underline flex items-center gap-1 mx-auto"
            >
              <X className="h-3 w-3" /> Limpar filtro
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grupos.entries()).map(([grupo, itens]) => (
            <section key={grupo}>
              {/* Separador de data */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 capitalize">
                  {grupo}
                </span>
                <div className="flex-1 h-px bg-border/60" />
                <span className="text-[10px] text-muted-foreground/40">{itens.length}</span>
              </div>

              <div className="space-y-2.5">
                {itens.map((n) => (
                  <NotifCard
                    key={n.id}
                    n={n}
                    isLida={lidasSet.has(n.id)}
                    podeExcluir={n.destinatario_id === membro?.id}
                    onTap={() => handleTap(n)}
                    onDelete={() => setDeleteId(n.id)}
                    onMarcarLida={() => marcarLidaMutation.mutate(n.id)}
                    isPendingLida={marcarLidaMutation.isPending && marcarLidaMutation.variables === n.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Confirmação de exclusão ────────────────────────────── */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover notificação?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
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
