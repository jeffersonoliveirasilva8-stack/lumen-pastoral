import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  format, parseISO, isToday, isYesterday, isThisWeek, differenceInMinutes,
  differenceInHours,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BellOff, CheckCheck, Loader2, Trash2, Calendar, ArrowLeftRight,
  Megaphone, Users, Church, AlertTriangle, Zap, Settings2, X, ChevronRight,
  Bell,
} from "lucide-react";
import { ListSkeleton } from "@/components/ui/page-skeleton";
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
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  accent: string;
}> = {
  urgente:       { label: "Urgente",       icon: Zap,            iconBg: "bg-red-500",     iconColor: "text-white",  accent: "border-l-red-500" },
  pendencias:    { label: "Pendências",    icon: AlertTriangle,  iconBg: "bg-amber-400",   iconColor: "text-white",  accent: "border-l-amber-400" },
  escalas:       { label: "Escalas",       icon: Calendar,       iconBg: "bg-blue-500",    iconColor: "text-white",  accent: "border-l-blue-500" },
  substituicoes: { label: "Substituições", icon: ArrowLeftRight,  iconBg: "bg-violet-500",  iconColor: "text-white",  accent: "border-l-violet-500" },
  eventos:       { label: "Eventos",       icon: Church,         iconBg: "bg-emerald-500", iconColor: "text-white",  accent: "border-l-emerald-500" },
  comunicados:   { label: "Comunicados",   icon: Megaphone,      iconBg: "bg-sky-500",     iconColor: "text-white",  accent: "border-l-sky-500" },
  membros:       { label: "Membros",       icon: Users,          iconBg: "bg-pink-500",    iconColor: "text-white",  accent: "border-l-pink-500" },
  sistema:       { label: "Sistema",       icon: Settings2,      iconBg: "bg-slate-400",   iconColor: "text-white",  accent: "border-l-slate-400" },
};

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

// ── Card estilo iOS ────────────────────────────────────────────

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
  const THRESHOLD = 80;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < 0 && podeExcluir) setSwipeX(Math.max(dx, -(THRESHOLD + 12)));
  }
  function onTouchEnd() {
    setSwiping(false);
    if (swipeX <= -THRESHOLD) onDelete();
    setSwipeX(0);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Reveal: botão vermelho atrás */}
      {podeExcluir && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 rounded-r-2xl"
          style={{ width: Math.abs(swipeX) || 72 }}
        >
          <Trash2 className="h-5 w-5 text-white" />
        </div>
      )}

      {/* Card principal */}
      <div
        className={[
          "relative flex items-start gap-3 px-4 py-3.5 rounded-2xl",
          "border-l-4 bg-card",
          !isLida ? cfg.accent + " shadow-sm" : "border-l-transparent opacity-60",
        ].join(" ")}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swiping ? "none" : "transform 0.25s cubic-bezier(.4,0,.2,1)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Ícone redondo estilo iOS */}
        <div
          className={`shrink-0 h-10 w-10 rounded-2xl flex items-center justify-center mt-0.5 ${cfg.iconBg} ${cfg.iconColor}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>

        {/* Conteúdo */}
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={onTap}
          disabled={isPendingLida}
        >
          {/* Linha superior: categoria + tempo */}
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${isLida ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
              {cfg.label}
            </span>
            <span className="text-[11px] text-muted-foreground/60 shrink-0 ml-2">
              {tempoRelativo(n.created_at)}
            </span>
          </div>

          {/* Título */}
          <div className="flex items-start gap-1.5">
            {!isLida && (
              <span className="mt-1 shrink-0 h-2 w-2 rounded-full bg-blue-500" />
            )}
            <p className={`text-sm font-semibold leading-snug ${isLida ? "text-foreground/60" : "text-foreground"}`}>
              {n.titulo}
            </p>
          </div>

          {/* Mensagem */}
          {n.mensagem && (
            <p className={`text-xs mt-0.5 leading-relaxed line-clamp-2 ${isLida ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
              {n.mensagem}
            </p>
          )}

          {/* Link */}
          {n.link_referencia && !isLida && (
            <div className="flex items-center gap-0.5 mt-1.5">
              <span className="text-[11px] text-primary font-medium">Abrir</span>
              <ChevronRight className="h-3 w-3 text-primary" />
            </div>
          )}
        </button>

        {/* Ações desktop */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!isLida && (
            <button
              type="button"
              onClick={onMarcarLida}
              disabled={isPendingLida}
              title="Marcar como lida"
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted transition"
            >
              {isPendingLida
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />}
            </button>
          )}
          {podeExcluir && (
            <button
              type="button"
              onClick={onDelete}
              title="Excluir"
              className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Separador de data estilo iOS ───────────────────────────────

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

// ── Página principal ────────────────────────────────────────────

const FILTROS_ORDENADOS: Categoria[] = [
  "todas", "urgente", "escalas", "pendencias", "eventos", "comunicados", "membros", "substituicoes", "sistema",
];

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
        .eq("apenas_coordenacao", false)
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

  const notifsFiltradas = useMemo(
    () => filtro === "todas" ? notifs : notifs.filter((n) => getCategoria(n) === filtro),
    [notifs, filtro],
  );

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

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto pb-28">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground mb-1">
            Portal do Servidor
          </p>
          <h1 className="font-serif text-2xl flex items-center gap-2">
            Notificações
            {naoLidasTotal > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-bold px-1.5">
                {naoLidasTotal}
              </span>
            )}
          </h1>
        </div>
        {naoLidasTotal > 0 && (
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
      </div>

      {/* ── Filtros de categoria ────────────────────────────────── */}
      <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0 mb-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none scroll-x-fade">
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
                className={`filter-chip shrink-0 ${ativo ? "filter-chip-active" : ""}`}
              >
                {cfg && (
                  <span className={`inline-flex h-3.5 w-3.5 rounded-full items-center justify-center shrink-0 ${cfg.iconBg}`} />
                )}
                {isAll ? "Todas" : cfg!.label}
                {count > 0 && (
                  <span className={`filter-chip-count ${ativo ? "bg-primary/20 text-primary" : "bg-blue-500 text-white"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Conteúdo ───────────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : notifsFiltradas.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <BellOff className="h-5 w-5" />
          </div>
          <p className="empty-state-title">
            {filtro === "todas" ? "Nenhuma notificação" : "Nenhuma notificação nesta categoria"}
          </p>
          <p className="empty-state-desc">
            {filtro === "todas"
              ? "Você receberá avisos sobre escalas, eventos e comunicados da paróquia aqui."
              : "Tente outra categoria ou limpe o filtro para ver todas."}
          </p>
          {filtro !== "todas" && (
            <button
              type="button"
              onClick={() => setFiltro("todas")}
              className="flex items-center gap-1 text-xs text-primary hover:underline font-medium mt-1"
            >
              <X className="h-3 w-3" /> Limpar filtro
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
            <AlertDialogDescription>
              Esta notificação será excluída permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
