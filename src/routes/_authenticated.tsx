import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Loader2, LogOut, LayoutDashboard, Settings, Calendar, Users,
  Flame, BookOpen, Bell, UserCircle, X, Church, Leaf,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { PageTransition } from "@/components/ui/page-transition";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;
import { getLiturgicalDays } from "@/lib/liturgical-calendar";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const LITURGICAL_COLOR_HEX: Record<string, string> = {
  branco: "#d1d5db", roxo: "#9333ea", vermelho: "#dc2626",
  verde: "#16a34a", preto: "#374151", dourado: "#f59e0b", rosa: "#ec4899",
};

const LITURGICAL_COLOR_LABEL: Record<string, string> = {
  branco: "Branco", roxo: "Roxo", verde: "Verde",
  vermelho: "Vermelho", rosa: "Rosa", preto: "Preto", dourado: "Dourado",
};

const LITURGICAL_SEASON_LABEL: Record<string, string> = {
  advento: "Advento", natal: "Natal", comum: "Tempo Comum",
  quaresma: "Quaresma", triduo: "Tríduo", pascoa: "Páscoa",
};

// Mapeia qualquer rota para o módulo principal correspondente
function getActiveModule(pathname: string): string {
  if (pathname.startsWith("/escalas") || pathname.startsWith("/substituicoes") || pathname.startsWith("/sacristia") || pathname.startsWith("/relatorios")) return "/escalas";
  if (pathname.startsWith("/membros") || pathname.startsWith("/ranking")) return "/membros";
  if (pathname.startsWith("/ocorrencias")) return "/formacoes";
  if (pathname.startsWith("/espiritualidade")) return "/espiritualidade";
  if (pathname.startsWith("/formacoes")) return "/formacoes";
  if (pathname.startsWith("/configuracoes") || pathname.startsWith("/auditoria")) return "/configuracoes/paroquia";
  if (pathname.startsWith("/painel")) return "/painel";
  return pathname;
}

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, profile, loading, isServidor, hasAdminAccess, roles, isAdmin, isCoordenador } = useAuth();
  const isLimitedCoord = isCoordenador && !isAdmin;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const today = new Date();
  const year = today.getFullYear();

  const { data: paroquia } = useQuery({
    queryKey: ["header-paroquia", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!profile?.paroquia_id) return null;
      const { data } = await supabase
        .from("paroquias")
        .select("nome, diocese")
        .eq("id", profile.paroquia_id)
        .maybeSingle();
      return data;
    },
  });

  const liturgy = useMemo(() => {
    const days = getLiturgicalDays(year);
    const todayKey = format(today, "yyyy-MM-dd");
    return days.find((d) => format(d.date, "yyyy-MM-dd") === todayKey);
  }, [today, year]);

  // Badge de solicitações pendentes em Membros
  const { data: solicitacoesPendentes = 0 } = useQuery<number>({
    queryKey: ["solicitacoes-pendentes-count", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id && !isLimitedCoord,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const { count } = await anyDb
        .from("solicitacoes_membros")
        .select("id", { count: "exact", head: true })
        .eq("paroquia_id", profile!.paroquia_id)
        .eq("status", "pendente");
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && user && isServidor) {
      navigate({ to: "/portal-membro/home" });
    }
  }, [loading, user, isServidor, navigate]);

  useEffect(() => {
    if (!loading && user && roles.length === 0) {
      navigate({ to: "/membro/login" });
    }
  }, [loading, user, roles, navigate]);

  useEffect(() => {
    if (!loading && user && roles.length > 0 && !hasAdminAccess && !isServidor) {
      navigate({ to: "/acesso-negado" });
    }
  }, [loading, user, roles, hasAdminAccess, isServidor, navigate]);

  useEffect(() => {
    if (loading || !user || !hasAdminAccess || isServidor) return;

    const mfaToken = sessionStorage.getItem("admin_mfa_token");
    if (!mfaToken) {
      navigate({ to: "/auth/admin-mfa" });
      return;
    }

    supabase
      .rpc("check_admin_mfa_session", { p_session_token: mfaToken })
      .then(({ data }) => {
        if (!data?.valid) {
          sessionStorage.removeItem("admin_mfa_token");
          navigate({ to: "/auth/admin-mfa" });
        }
      });
  }, [loading, user, hasAdminAccess, isServidor, navigate]);

  useEffect(() => {
    if (!loading && user && profile && !profile.paroquia_id && pathname !== "/onboarding" && hasAdminAccess) {
      navigate({ to: "/onboarding" });
    }
  }, [loading, user, profile, pathname, hasAdminAccess, navigate]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem("sidebar-collapsed") === "true"
  );
  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pathname === "/onboarding") return <Outlet />;

  // ── Fonte única de navegação ─────────────────────────────────────────
  type NavItem = { to: string; label: string; icon: React.ElementType; badge?: number; color?: string };

  const isSuperAdmin = roles.includes("super_admin");
  const activeModule = getActiveModule(pathname);

  // 6 módulos principais
  const mainNav: NavItem[] = [
    { to: "/painel",               label: "Painel",         icon: LayoutDashboard, color: "bg-slate-600" },
    { to: "/escalas",              label: "Escalas",         icon: Calendar,        color: "bg-blue-600" },
    ...(!isLimitedCoord ? [{ to: "/membros", label: "Membros", icon: Users, badge: solicitacoesPendentes, color: "bg-emerald-600" }] : []),
    { to: "/espiritualidade",      label: "Liturgia",        icon: BookOpen,        color: "bg-violet-600" },
    { to: "/formacoes",            label: "Pastoral",        icon: Leaf,            color: "bg-teal-600" },
    { to: "/configuracoes/paroquia", label: "Configurações", icon: Settings,        color: "bg-indigo-600" },
  ];

  // Itens secundários para o drawer "Mais"
  const drawerItems: NavItem[] = [
    { to: "/notificacoes",   label: "Notificações",    icon: Bell,            color: "bg-rose-500" },
    { to: "/minha-conta",    label: "Minha Conta",     icon: UserCircle,      color: "bg-slate-500" },
    ...(isSuperAdmin ? [{ to: "/admin/paroquias", label: "Paróquias", icon: Church, color: "bg-stone-600" }] : []),
  ];

  async function logout() {
    sessionStorage.removeItem("admin_mfa_token");
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col bg-sidebar/95 text-sidebar-foreground border-r border-sidebar-border/70 shrink-0 shadow-altar overflow-hidden transition-all duration-[260ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${sidebarCollapsed ? "w-16" : "w-56"}`}>
        {/* Logo */}
        <div className={`flex h-20 items-center border-b border-sidebar-border/70 ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-5"}`}>
          <Link to="/painel" className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-gold transition-transform duration-200 hover:scale-105">
              <Flame className="h-5 w-5" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 animate-fade-in">
                <p className="text-sm font-semibold truncate">Lumen Pastoral</p>
                <p className="text-[11px] text-sidebar-foreground/60 truncate">Painel Pastoral</p>
              </div>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className={`flex-1 py-4 space-y-1 overflow-y-auto ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {mainNav.map((item) => {
            const active = activeModule === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`group relative flex items-center rounded-2xl py-2.5 text-sm font-semibold transition-all duration-150 press-scale tap-highlight ${
                  sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"
                } ${
                  active
                    ? "bg-sidebar-accent/90 text-sidebar-primary shadow-gold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />}
                <item.icon className={`shrink-0 transition-all duration-150 ${active ? "h-[18px] w-[18px]" : "h-4 w-4"}`} />
                {!sidebarCollapsed && (
                  <span className="truncate flex-1 animate-fade-in">{item.label}</span>
                )}
                {!sidebarCollapsed && (item.badge ?? 0) > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1 shrink-0 animate-bounce-in">
                    {item.badge}
                  </span>
                )}
                {sidebarCollapsed && (item.badge ?? 0) > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
                )}
                {sidebarCollapsed && (
                  <span className="absolute left-full ml-2 z-50 hidden group-hover:flex items-center rounded-lg bg-popover border border-border px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg whitespace-nowrap pointer-events-none">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border/70 ${sidebarCollapsed ? "p-2 space-y-2" : "p-4 space-y-2"}`}>
          {!sidebarCollapsed && (
            <div className="rounded-2xl border border-border/70 bg-background/90 p-3 animate-fade-in">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground truncate">Conectado como</p>
              <p className="mt-1.5 text-sm font-semibold text-foreground truncate">{profile?.nome_completo}</p>
              <p className="text-[11px] text-muted-foreground truncate">{profile?.email}</p>
            </div>
          )}
          <Link
            to="/minha-conta"
            title="Minha Conta"
            className={`w-full inline-flex items-center rounded-2xl bg-muted/60 text-sm font-semibold text-foreground/70 transition hover:bg-muted hover:text-foreground press-scale tap-highlight ${sidebarCollapsed ? "justify-center p-2.5" : "gap-2 px-3 py-2.5"}`}
          >
            <UserCircle className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="animate-fade-in">Minha Conta</span>}
          </Link>
          <button
            onClick={logout}
            title="Sair"
            className={`w-full inline-flex items-center rounded-2xl bg-destructive/10 text-sm font-semibold text-destructive transition hover:bg-destructive/15 press-scale tap-highlight ${sidebarCollapsed ? "justify-center p-2.5" : "gap-2 px-3 py-2.5"}`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="animate-fade-in">Sair</span>}
          </button>
          {/* Toggle colapso */}
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            className={`w-full inline-flex items-center rounded-2xl bg-muted/40 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground press-scale tap-highlight ${sidebarCollapsed ? "justify-center p-2.5" : "gap-2 px-3 py-2"}`}
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="h-4 w-4 shrink-0" />
              : <><PanelLeftClose className="h-4 w-4 shrink-0" /><span className="animate-fade-in">Recolher</span></>
            }
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-sm shadow-sm">
          <div className="mx-auto flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8 max-w-7xl w-full">
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground leading-none">Painel Pastoral</p>
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <h1 className="text-[15px] font-semibold text-foreground truncate leading-snug">
                  {paroquia?.nome ?? "Sua paróquia"}
                </h1>
                {paroquia?.diocese && (
                  <span className="hidden md:inline text-xs text-muted-foreground truncate shrink-0">
                    {paroquia.diocese}
                  </span>
                )}
              </div>
              {liturgy && (
                <div className="hidden lg:flex items-center gap-1.5 mt-0.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: LITURGICAL_COLOR_HEX[liturgy.color] }}
                  />
                  <span className="text-[10px] text-muted-foreground truncate">
                    {liturgy.name} · {LITURGICAL_COLOR_LABEL[liturgy.color]} · {LITURGICAL_SEASON_LABEL[(liturgy.season as string) ?? "comum"]}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  to="/notificacoes"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Notificações"
                >
                  <Bell className="h-4 w-4" />
                </Link>
                <Link
                  to="/minha-conta"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Minha conta"
                >
                  <UserCircle className="h-4 w-4" />
                </Link>
                <button
                  onClick={logout}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-destructive/10 px-3 text-sm font-semibold text-destructive transition hover:bg-destructive/15"
                >
                  Sair
                </button>
              </div>
              {/* Mobile: ícones de notificações e perfil no header */}
              <Link
                to="/notificacoes"
                className="sm:hidden relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                aria-label="Notificações"
              >
                <Bell className="h-5 w-5" />
              </Link>
              <button
                onClick={() => setMenuOpen(true)}
                className="sm:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                aria-label="Mais opções"
              >
                <BookOpen className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 w-full">
          <div className="mx-auto max-w-7xl px-4 pt-6 pb-32 sm:px-6 lg:px-8 lg:pb-10 min-w-0 w-full overflow-hidden">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </div>
        </main>

        {/* Drawer "Mais" — perfil + itens secundários */}
        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerContent className="max-h-[70vh]">
            <DrawerHeader className="px-5 pt-5 pb-4 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0 ring-2 ring-primary/20">
                  {(profile?.nome_completo ?? "?").split(" ").filter(Boolean).slice(0, 2).map((n: string) => n[0]).join("").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <DrawerTitle className="font-semibold text-sm leading-tight truncate">{profile?.nome_completo}</DrawerTitle>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{profile?.email}</p>
                </div>
                <Link
                  to="/minha-conta"
                  onClick={() => setMenuOpen(false)}
                  className="shrink-0 rounded-xl bg-muted/70 px-3 py-1.5 text-xs font-semibold text-foreground/70 hover:bg-muted hover:text-foreground transition"
                >
                  Editar
                </Link>
              </div>
            </DrawerHeader>

            <div className="px-4 py-4 overflow-y-auto">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground mb-3 px-1">Acesso rápido</p>
              <div className="grid grid-cols-3 gap-2.5">
                {drawerItems.map((item, i) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + "/");
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      style={{ animationDelay: `${i * 30}ms` }}
                      className={`relative flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition-all duration-150 active:scale-[0.93] animate-slide-up ${
                        active
                          ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "bg-muted/40 text-foreground/70 hover:bg-muted hover:text-foreground hover:scale-[1.03]"
                      }`}
                    >
                      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                        active ? "bg-primary/15" : (item.color ?? "bg-slate-500")
                      }`}>
                        <item.icon className={`h-5 w-5 ${active ? "text-primary" : "text-white"}`} />
                      </div>
                      <span className="text-xs font-medium leading-tight">{item.label}</span>
                      {(item.badge ?? 0) > 0 && (
                        <span className="absolute top-2 right-2 h-4 min-w-[1rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[8px] font-bold px-0.5">
                          {(item.badge ?? 0) > 9 ? "9+" : item.badge}
                        </span>
                      )}
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

        {/* ── Mobile bottom navigation — 6 módulos principais ───────── */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-border/60 safe-area-pb shadow-[0_-1px_12px_rgba(0,0,0,0.08)]">
          <div className="flex items-stretch h-[62px]">
            {mainNav.map((item) => {
              const active = activeModule === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 pb-1 min-w-0 relative tap-highlight transition-colors duration-150 active:scale-[0.88] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {active && (
                    <span className="nav-active-pip" />
                  )}
                  <div className={`relative mt-2 transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <div className={`absolute inset-[-6px] rounded-xl transition-all duration-200 ${active ? "bg-primary/10" : "bg-transparent"}`} />
                    <item.icon className={`h-[19px] w-[19px] shrink-0 transition-all duration-200 relative ${active ? "stroke-[2.3]" : "stroke-[1.6]"}`} />
                    {(item.badge ?? 0) > 0 && (
                      <span className="absolute -top-1 -right-2 h-3.5 min-w-[0.875rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[8px] font-bold leading-none px-0.5 animate-bounce-in">
                        {(item.badge ?? 0) > 9 ? "9+" : item.badge}
                      </span>
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
    </div>
  );
}
