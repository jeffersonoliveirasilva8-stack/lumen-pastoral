import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Loader2, LogOut, LayoutDashboard, Settings, Calendar, Users,
  Sparkles, BookOpen, CalendarRange, Bell, MoreHorizontal, Trophy, UserCircle, Church,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

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

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, profile, loading, isServidor, hasAdminAccess, roles, isAdmin, isCoordenador } = useAuth();
  // Coordenador sem admin pleno: acesso operacional (escalas + agenda), sem membros e personalização
  const isLimitedCoord = isCoordenador && !isAdmin;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const today = new Date();
  const year = today.getFullYear();

  const { data: paroquia } = useQuery({
    queryKey: ["header-paroquia", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
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

  // Contagem de solicitações pendentes para o badge da sidebar
  const { data: solicitacoesPendentes = 0 } = useQuery<number>({
    queryKey: ["solicitacoes-pendentes-count", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id && !isLimitedCoord,
    refetchInterval: 60_000,
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
    if (!loading && user && profile && !profile.paroquia_id && pathname !== "/onboarding" && hasAdminAccess) {
      navigate({ to: "/onboarding" });
    }
  }, [loading, user, profile, pathname, hasAdminAccess, navigate]);

  const [menuOpen, setMenuOpen] = useState(false);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pathname === "/onboarding") return <Outlet />;

  // ── Fonte única de navegação ─────────────────────────────────────────
  // Desktop sidebar e drawer mobile consomem a mesma lista.
  // Bottom nav mobile = primeiros 4 itens marcados com inBottom.
  type NavItem = { to: string; label: string; icon: React.ElementType; badge?: number };

  const allNav: NavItem[] = [
    { to: "/painel",                  label: "Painel",          icon: LayoutDashboard },
    { to: "/escalas",                 label: "Escalas",         icon: Calendar },
    { to: "/formacoes",               label: "Agenda Pastoral", icon: CalendarRange },
    { to: "/espiritualidade",         label: "Liturgia",        icon: BookOpen },
    { to: "/sacristia",               label: "Sacristia",       icon: Church },
    { to: "/calendario",              label: "Calendário",      icon: BookOpen },
    ...(!isLimitedCoord ? [{ to: "/membros", label: "Membros", icon: Users, badge: solicitacoesPendentes }] : []),
    { to: "/ranking",                 label: "Ranking",         icon: Trophy },
    { to: "/notificacoes",            label: "Notificações",    icon: Bell },
    ...(!isLimitedCoord ? [{ to: "/configuracoes/paroquia", label: "Personalização", icon: Settings }] : []),
  ];

  // Sidebar desktop = todos os itens (exceto Notificações, já no header)
  const sidebarNav = allNav.filter(i => i.to !== "/notificacoes");

  // Drawer mobile = todos os itens + Minha Conta
  const drawerNav = [...allNav, { to: "/minha-conta", label: "Minha Conta", icon: UserCircle }];

  // Bottom nav = 4 itens prioritários
  const BOTTOM_ROUTES = isLimitedCoord
    ? ["/painel", "/escalas", "/formacoes", "/espiritualidade"]
    : ["/painel", "/escalas", "/formacoes", "/membros"];
  const bottomNav = allNav.filter(i => BOTTOM_ROUTES.includes(i.to));

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-sidebar/95 text-sidebar-foreground border-r border-sidebar-border/70 shrink-0 shadow-altar overflow-y-auto">
        <div className="flex h-20 items-center gap-3 px-5 border-b border-sidebar-border/70">
          <Link to="/painel" className="flex items-center gap-3 min-w-0">
            <div className="grid h-12 w-12 place-items-center rounded-3xl bg-primary text-white shadow-gold">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Lumen Pastoral</p>
              <p className="text-[11px] text-sidebar-foreground/60 truncate">Painel Pastoral</p>
            </div>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {sidebarNav.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`group flex items-center gap-3 rounded-3xl px-3 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-sidebar-accent/90 text-sidebar-primary shadow-gold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0 transition-colors" />
                <span className="truncate flex-1">{item.label}</span>
                {item.badge > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1 shrink-0">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border/70">
          <div className="rounded-3xl border border-border/70 bg-background/90 p-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground truncate">Conectado como</p>
            <p className="mt-2 text-sm font-semibold text-foreground truncate">{profile?.nome_completo}</p>
            <p className="text-[11px] text-muted-foreground truncate">{profile?.email}</p>
          </div>
          <Link
            to="/minha-conta"
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-3xl bg-muted/60 px-3 py-2.5 text-sm font-semibold text-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <UserCircle className="h-4 w-4" />
            Minha Conta
          </Link>
          <button
            onClick={logout}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-3xl bg-destructive/10 px-3 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/15"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-sm shadow-sm">
          <div className="mx-auto flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8 max-w-7xl w-full">
            {/* Identidade — flex-1 garante que trunca antes de empurrar os ícones */}
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
              {/* Desktop quick actions — only Calendário e Notificações (Escalas e Agenda já estão no sidebar) */}
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  to="/calendario"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Calendário litúrgico"
                >
                  <BookOpen className="h-4 w-4" />
                </Link>
                <Link
                  to="/notificacoes"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Notificações"
                >
                  <Bell className="h-4 w-4" />
                  {solicitacoesPendentes > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                      {solicitacoesPendentes > 9 ? "9+" : solicitacoesPendentes}
                    </span>
                  )}
                </Link>
                <button
                  onClick={logout}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-destructive/10 px-3 text-sm font-semibold text-destructive transition hover:bg-destructive/15"
                >
                  Sair
                </button>
              </div>
              {/* Mobile: ícone de notificações no header */}
              <Link
                to="/notificacoes"
                className="sm:hidden relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                aria-label="Notificações"
              >
                <Bell className="h-5 w-5" />
                {solicitacoesPendentes > 0 && (
                  <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-500 border-2 border-card" />
                )}
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">
            <Outlet />
          </div>
        </main>

        {/* "Mais" drawer — acessível pelo botão Mais no nav mobile */}
        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle className="font-serif">Mais opções</DrawerTitle>
            </DrawerHeader>
            <nav className="px-4 pb-2 space-y-1">
              {drawerNav.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {(item as NavItem).badge != null && (item as NavItem).badge! > 0 && (
                      <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 shrink-0">
                        {(item as NavItem).badge! > 9 ? "9+" : (item as NavItem).badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <DrawerFooter>
              <div className="rounded-2xl border border-border/70 bg-muted/40 p-3 mb-2">
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Conectado como</p>
                <p className="mt-1 text-sm font-semibold text-foreground truncate">{profile?.nome_completo}</p>
                <p className="text-[11px] text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/15"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        {/* Mobile bottom navigation — fonte única: bottomNav derivado de allNav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card/98 backdrop-blur supports-[backdrop-filter]:bg-card/90 border-t border-border/80 safe-area-pb shadow-[0_-1px_8px_rgba(0,0,0,0.06)]">
          <div className="flex items-stretch h-[60px]">
            {bottomNav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 min-w-0 transition-colors relative ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="relative">
                    <item.icon className={`h-5 w-5 shrink-0 ${active ? "stroke-[2.2]" : "stroke-[1.7]"}`} />
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -top-1 -right-1.5 h-3.5 min-w-[0.875rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[8px] font-bold leading-none px-0.5">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] leading-none truncate max-w-full px-0.5 mt-0.5 ${active ? "font-semibold" : "font-medium"}`}>
                    {item.label === "Agenda Pastoral" ? "Agenda" : item.label}
                  </span>
                </Link>
              );
            })}
            {/* Mais — abre drawer com navegação completa */}
            <button
              onClick={() => setMenuOpen(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 min-w-0 transition-colors ${
                drawerNav.some(i => (pathname === i.to || pathname.startsWith(i.to + "/")) && !BOTTOM_ROUTES.includes(i.to))
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MoreHorizontal className="h-5 w-5 shrink-0 stroke-[1.7]" />
              <span className="text-[10px] leading-none font-medium mt-0.5">Mais</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
