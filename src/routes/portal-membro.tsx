import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/ui/page-transition";
import { format } from "date-fns";
import {
  Loader2, Home, Calendar, Trophy, User, LogOut, Flame,
  CalendarDays, MessageSquare, Bell, BookOpen, X,
  CalendarRange, Zap, AlertCircle, ArrowLeftRight, HelpCircle,
} from "lucide-react";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { WelcomeGuide } from "@/components/portal/WelcomeGuide";
import { supabase } from "@/integrations/supabase/client";
import { getLiturgicalDays } from "@/lib/liturgical-calendar";
import { checkProfileCompleteness } from "@/lib/profile-completeness";
import {
  Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const LITURGICAL_COLOR_HEX: Record<string, string> = {
  branco: "#d1d5db", roxo: "#9333ea", vermelho: "#dc2626",
  verde: "#16a34a", preto: "#374151", dourado: "#f59e0b", rosa: "#ec4899",
};

const COMPLETAR_CADASTRO_PATH = "/portal-membro/completar-cadastro";

export const Route = createFileRoute("/portal-membro")({
  component: PortalMembroLayout,
});

// Sidebar desktop — completa
const NAV_SIDEBAR = [
  { to: "/portal-membro/home",           label: "Início",        icon: Home },
  { to: "/portal-membro/escalas",        label: "Escalas",       icon: Calendar },
  { to: "/portal-membro/substituicoes",  label: "Substituições", icon: ArrowLeftRight },
  { to: "/portal-membro/eventos",        label: "Agenda",        icon: CalendarDays },
  { to: "/portal-membro/liturgia",       label: "Liturgia",      icon: BookOpen },
  { to: "/portal-membro/ranking",        label: "Ranking",       icon: Trophy },
  { to: "/portal-membro/ocorrencias",    label: "Ocorrências",   icon: MessageSquare },
  { to: "/portal-membro/notificacoes",   label: "Notificações",  icon: Bell },
  { to: "/portal-membro/perfil",         label: "Perfil",        icon: User },
  { to: "/portal-membro/ajuda",          label: "Ajuda",         icon: HelpCircle },
] as const;

// Bottom nav mobile: Início | Escalas | [FAB] | Liturgia | Perfil
const NAV_BOTTOM = [
  { to: "/portal-membro/home",          label: "Início",        icon: Home },
  { to: "/portal-membro/escalas",       label: "Escalas",       icon: Calendar },
  { to: "/portal-membro/liturgia",      label: "Liturgia",      icon: BookOpen },
  { to: "/portal-membro/perfil",        label: "Perfil",        icon: User },
] as const;

// Drawer "Mais" — itens secundários
const DRAWER_ITEMS = [
  { to: "/portal-membro/substituicoes", label: "Substituições", icon: ArrowLeftRight, color: "bg-orange-500" },
  { to: "/portal-membro/eventos",       label: "Agenda",        icon: CalendarDays,   color: "bg-blue-500" },
  { to: "/portal-membro/ranking",       label: "Ranking",       icon: Trophy,         color: "bg-amber-500" },
  { to: "/portal-membro/notificacoes",  label: "Avisos",        icon: Bell,           color: "bg-sky-500" },
  { to: "/portal-membro/ocorrencias",   label: "Ocorrências",   icon: MessageSquare,  color: "bg-rose-500" },
  { to: "/portal-membro/calendario",    label: "Calendário",    icon: CalendarRange,  color: "bg-teal-500" },
  { to: "/portal-membro/ajuda",         label: "Ajuda",         icon: HelpCircle,     color: "bg-slate-500" },
] as const;

function PortalMembroLayout() {
  const { user, membro, loading, linking, isAdministrador } = useMembroAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Pull-to-refresh
  const mainRef = useRef<HTMLElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (mainRef.current && mainRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);
  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 80 && mainRef.current && mainRef.current.scrollTop === 0) {
      setRefreshing(true);
      await qc.invalidateQueries();
      setTimeout(() => setRefreshing(false), 600);
    }
  }, [qc]);
  const today = useMemo(() => new Date(), []);
  const liturgy = useMemo(() => {
    const days = getLiturgicalDays(today.getFullYear());
    const key = format(today, "yyyy-MM-dd");
    return days.find((d) => format(d.date, "yyyy-MM-dd") === key);
  }, [today]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [urgentDismissed, setUrgentDismissed] = useState(() =>
    localStorage.getItem("urgentNotifDismissed") === "true"
  );
  function dismissUrgent() {
    localStorage.setItem("urgentNotifDismissed", "true");
    setUrgentDismissed(true);
  }

  // ── Completude de perfil ──────────────────────────────────────────────────
  const { data: profileCompleteness, isSuccess: completenessLoaded } = useQuery({
    queryKey: ["profile-completeness", membro?.id],
    enabled: !!membro?.id,
    staleTime: 2 * 60 * 1000, // 2 minutos de cache
    queryFn: async () => {
      const [membroRes, atuacoesRes] = await Promise.all([
        anyDb
          .from("membros")
          .select("sexo, comunidade_id, perfil_completo")
          .eq("id", membro!.id)
          .single(),
        anyDb
          .from("membro_atuacoes")
          .select("id")
          .eq("membro_id", membro!.id)
          .limit(1),
      ]);
      // Se o banco confirma que o perfil foi completado, confiar nele
      // independentemente do estado das queries de membro_atuacoes (que pode
      // retornar vazio por RLS antes de auth_user_id estar vinculado)
      if (membroRes.data?.perfil_completo === true) {
        return { complete: true, percentage: 100, missingFields: [] as string[] };
      }
      return checkProfileCompleteness({
        nome: membro!.nome,
        telefone: membro!.telefone,
        data_nascimento: membro!.data_nascimento,
        sexo: membroRes.data?.sexo ?? null,
        comunidade_id: membroRes.data?.comunidade_id ?? null,
        has_atuacao: (atuacoesRes.data ?? []).length > 0,
      });
    },
  });

  // Redirect automático para completar cadastro quando perfil incompleto
  useEffect(() => {
    if (
      completenessLoaded &&
      profileCompleteness &&
      !profileCompleteness.complete &&
      pathname !== COMPLETAR_CADASTRO_PATH
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: COMPLETAR_CADASTRO_PATH } as any);
    }
  }, [completenessLoaded, profileCompleteness, pathname, navigate]);

  const { data: urgentNotifs = [] } = useQuery<{ id: string; titulo: string; mensagem: string | null }[]>({
    queryKey: ["urgent-notifs", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data } = await anyDb.rpc("portal_get_notif_urgentes_nao_lidas");
      return data ?? [];
    },
  });

  const { data: unreadCount = 0 } = useQuery<number>({
    queryKey: ["notif-unread-count", membro?.id],
    enabled: !!membro?.id,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await anyDb.rpc("portal_count_notif_nao_lidas");
      return (data as number) ?? 0;
    },
  });

  // Realtime global: score muda → invalida ranking queries
  useEffect(() => {
    if (!membro?.paroquia_id) return;
    const ch = supabase
      .channel(`pm-layout-ranking-rt-${membro.paroquia_id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "membros",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-full"] });
        qc.invalidateQueries({ queryKey: ["ranking-top"] });
        qc.invalidateQueries({ queryKey: ["ranking-pos"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [membro?.paroquia_id, qc]);

  // Realtime global: nova notificação → atualiza badge e queries (único canal no layout)
  useEffect(() => {
    if (!membro?.paroquia_id) return;
    const ch = supabase
      .channel(`pm-layout-notif-rt-${membro.paroquia_id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "notificacoes",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
        qc.invalidateQueries({ queryKey: ["urgent-notifs"] });
        qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [membro?.paroquia_id, qc]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/membro/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && !linking && user && membro === null) {
      console.warn("[portal-membro] membro não encontrado após loading completo", {
        user_id: user.id, email: user.email,
        motivo_do_bloqueio: "membro === null após loadMembro()",
      });
      navigate({ to: "/membro/login" as any });
    }
  }, [loading, linking, user, membro, navigate]);

  // Guard: conta não ativada → /membro/primeiro-acesso (sem token: usa sessão ativa)
  useEffect(() => {
    if (!loading && !linking && membro && !membro.conta_ativada) {
      console.warn("[portal-membro] conta não ativada — redirecionando para primeiro-acesso", {
        membro_id: membro.id, email: membro.email,
        paroquia_id: membro.paroquia_id, status_membro: membro.conta_ativada,
        motivo_do_bloqueio: "conta_ativada === false",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/membro/primeiro-acesso" as any });
    }
  }, [loading, linking, membro, navigate]);

  useEffect(() => {
    if (pathname === "/portal-membro" || pathname === "/portal-membro/") navigate({ to: "/portal-membro/home" });
  }, [pathname, navigate]);

  const hasUnread = unreadCount > 0;

  if (loading || linking || !user || !membro) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/membro/login" });
  }

  return (
    <div className="flex flex-col bg-background/70 lg:flex-row lg:h-screen lg:overflow-hidden">

      {/* ── Popup avisos urgentes ── */}
      {!urgentDismissed && urgentNotifs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl border border-destructive/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-semibold">Avisos Urgentes</h2>
                <p className="text-xs text-muted-foreground">
                  {urgentNotifs.length} aviso{urgentNotifs.length !== 1 ? "s" : ""} não lido{urgentNotifs.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="space-y-2.5 mb-5 max-h-56 overflow-y-auto">
              {urgentNotifs.map((n) => (
                <div key={n.id} className="rounded-xl bg-destructive/5 border border-destructive/15 p-3">
                  <p className="text-sm font-semibold">{n.titulo}</p>
                  {n.mensagem && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{n.mensagem}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={dismissUrgent}
                className="flex-1 rounded-xl bg-muted px-4 py-2.5 text-sm font-medium hover:bg-muted/80 transition"
              >
                Fechar
              </button>
              <Link
                to="/portal-membro/notificacoes"
                onClick={dismissUrgent}
                className="flex-1 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white text-center hover:bg-destructive/90 transition"
              >
                Ver todos
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar desktop ── */}
      <aside className="hidden lg:flex flex-col w-56 bg-sidebar/95 text-sidebar-foreground border-r border-sidebar-border/60 shrink-0 shadow-altar lg:h-screen lg:overflow-y-auto">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border/60 shrink-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-gold shadow-gold">
            <Flame className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold truncate text-sidebar-foreground leading-tight">{membro.paroquia_nome}</p>
            <p className="text-[10px] text-sidebar-foreground/40 leading-tight">Portal do Servidor</p>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {NAV_SIDEBAR.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const isBell = item.icon === Bell;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] transition-all duration-150 press-scale ${
                  active
                    ? "bg-sidebar-accent text-sidebar-primary font-semibold"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground font-medium"
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-sidebar-primary" />}
                <span className={`relative shrink-0 h-7 w-7 rounded-lg flex items-center justify-center transition-all duration-150 ${
                  active ? "bg-sidebar-primary/20" : "bg-sidebar-foreground/8"
                }`}>
                  <item.icon className={`h-3.5 w-3.5 ${active ? "text-sidebar-primary" : "text-sidebar-foreground/60"}`} />
                  {isBell && hasUnread && (
                    <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-destructive ring-1 ring-sidebar" />
                  )}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {isBell && hasUnread && (
                  <span className="h-4 min-w-[1rem] flex items-center justify-center rounded-full bg-destructive text-white text-[9px] font-bold px-1 shrink-0">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border/60 p-2.5 space-y-1 shrink-0">
          {profileCompleteness && !profileCompleteness.complete && (
            <Link
              to={COMPLETAR_CADASTRO_PATH as any}
              className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-2.5 py-2 hover:bg-amber-500/15 transition mb-1"
            >
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 leading-tight">
                  Perfil {profileCompleteness.percentage}% completo
                </p>
              </div>
            </Link>
          )}
          <Link
            to="/portal-membro/perfil"
            className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-sidebar-accent/50 transition group"
          >
            <div className="h-7 w-7 rounded-lg bg-sidebar-foreground/10 flex items-center justify-center text-[10px] font-bold text-sidebar-foreground shrink-0">
              {membro.nome.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-sidebar-foreground/90 truncate leading-tight">{membro.nome.split(" ")[0]}</p>
              <p className="text-[10px] text-sidebar-foreground/40 truncate">{membro.email}</p>
            </div>
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair da conta
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 pb-[68px] lg:pb-0 lg:h-screen lg:overflow-y-auto">

        {/* ── Cabeçalho desktop ── */}
        <header className="hidden lg:block sticky top-0 z-20 border-b border-border/70 bg-card/90 backdrop-blur px-6 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Portal do Servidor</p>
              <h1 className="mt-1 text-xl font-serif text-foreground">Bem-vindo, {membro.nome.split(" ")[0]}</h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {liturgy && (
                <Link
                  to="/portal-membro/liturgia"
                  className="hidden xl:inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: LITURGICAL_COLOR_HEX[liturgy.color] ?? "#16a34a" }}
                  />
                  <span className="font-medium truncate max-w-[140px]">{liturgy.name}</span>
                </Link>
              )}
              <Link
                to="/portal-membro/notificacoes"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
                {hasUnread && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
                )}
              </Link>
            </div>
          </div>
        </header>

        {/* ── Cabeçalho mobile ── */}
        <header className="lg:hidden sticky top-0 z-20 glass border-b border-border/50 shrink-0">
          {liturgy && (
            <div
              className="h-0.5 w-full"
              style={{ background: `linear-gradient(to right, ${LITURGICAL_COLOR_HEX[liturgy.color] ?? "#16a34a"}cc, ${LITURGICAL_COLOR_HEX[liturgy.color] ?? "#16a34a"}33)` }}
            />
          )}
          <div className="flex items-center gap-3 px-4 h-12">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-gold shadow-sm">
              <Flame className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                {membro.paroquia_nome}
              </p>
              {liturgy ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: LITURGICAL_COLOR_HEX[liturgy.color] }} />
                  <span className="text-[10px] text-muted-foreground truncate">{liturgy.name}</span>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">{membro.nome.split(" ")[0]}</p>
              )}
            </div>
            <Link
              to="/portal-membro/notificacoes"
              className="relative btn-icon shrink-0"
              aria-label="Notificações"
            >
              <Bell className="h-4 w-4" />
              {hasUnread && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive ring-1 ring-card" />
              )}
            </Link>
          </div>
        </header>

        <main
          ref={mainRef}
          className="flex-1 overflow-auto"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {refreshing && (
            <div className="flex justify-center py-3 animate-fade-in">
              <div className="flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 shadow-md">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Atualizando...</span>
              </div>
            </div>
          )}
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>

      <WelcomeGuide />

      {/* ── Drawer "Mais" ── */}
      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerHeader className="pb-3 border-b border-border/60">
            <DrawerTitle className="font-serif text-lg">Menu do Servidor</DrawerTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{membro.nome} · {membro.paroquia_nome}</p>
          </DrawerHeader>

          <div className="px-4 py-4 overflow-y-auto">
            <div className="grid grid-cols-3 gap-3">
              {DRAWER_ITEMS.map((item, i) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <Link
                    key={`${item.to}-${i}`}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={`flex flex-col items-center gap-2.5 rounded-2xl px-2 py-4 text-center transition-all active:scale-[0.93] ${
                      active
                        ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                        : "bg-muted/40 text-foreground/70 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                      active ? "bg-primary/15" : item.color
                    }`}>
                      <item.icon className={`h-5 w-5 ${active ? "text-primary" : "text-white"}`} />
                    </div>
                    <span className="text-xs font-medium leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <DrawerFooter className="pt-0 pb-5">
            <button
              onClick={() => { setMenuOpen(false); logout(); }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/15 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* ── Bottom nav mobile — FAB "Mais" centralizado ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-border/50 safe-area-pb" style={{ boxShadow: "0 -1px 0 0 var(--color-border), 0 -8px 24px rgba(0,0,0,0.07)" }}>
        <div className="flex items-stretch h-[58px]">

          {/* ── 2 itens esquerda: Início, Escalas ── */}
          {NAV_BOTTOM.slice(0, 2).map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 pb-1 min-w-0 relative tap-highlight transition-colors duration-150 active:scale-[0.88] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {active && <span className="nav-active-pip" />}
                <div className={`relative mt-2 transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                  <div className={`absolute inset-[-6px] rounded-xl transition-all duration-200 ${active ? "bg-primary/10" : "bg-transparent"}`} />
                  <item.icon className={`h-[19px] w-[19px] shrink-0 relative transition-all duration-200 ${active ? "stroke-[2.3]" : "stroke-[1.6]"}`} />
                </div>
                <span className={`text-[9px] leading-none truncate max-w-full px-1 mt-0.5 transition-all duration-150 ${active ? "font-bold" : "font-medium"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}

          {/* ── Centro: FAB "Mais" ── */}
          <div className="flex-1 relative flex flex-col items-center justify-end pb-1.5">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`absolute -top-5 h-[54px] w-[54px] rounded-full bg-primary text-primary-foreground
                flex items-center justify-center tap-highlight
                shadow-[0_8px_28px_oklch(0.22_0.03_260/0.45)]
                transition-all duration-200 active:scale-90
                ${menuOpen ? "scale-95 rotate-90" : "scale-100 hover:scale-105"}`}
              aria-label="Menu"
            >
              {menuOpen
                ? <X className="h-[22px] w-[22px] transition-all duration-200" />
                : <Flame className="h-[22px] w-[22px] transition-all duration-200" />
              }
            </button>
            <span className={`text-[9px] font-semibold leading-none transition-colors duration-150 ${menuOpen ? "text-primary" : "text-muted-foreground"}`}>
              Mais
            </span>
          </div>

          {/* ── 2 itens direita: Notificações, Perfil ── */}
          {NAV_BOTTOM.slice(2).map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const isBell = item.icon === Bell;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 pb-1 min-w-0 relative tap-highlight transition-colors duration-150 active:scale-[0.88] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {active && <span className="nav-active-pip" />}
                <div className={`relative mt-2 transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                  <div className={`absolute inset-[-6px] rounded-xl transition-all duration-200 ${active ? "bg-primary/10" : "bg-transparent"}`} />
                  <item.icon className={`h-[19px] w-[19px] shrink-0 relative transition-all duration-200 ${active ? "stroke-[2.3]" : "stroke-[1.6]"}`} />
                  {isBell && hasUnread && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card animate-bounce-in" />
                  )}
                </div>
                <span className={`text-[9px] leading-none truncate max-w-full px-1 mt-0.5 transition-all duration-150 ${active ? "font-bold" : "font-medium"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}

        </div>
      </nav>
    </div>
  );
}
