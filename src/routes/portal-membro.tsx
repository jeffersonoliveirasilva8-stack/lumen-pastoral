import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Home, Calendar, Trophy, User, LogOut, Sparkles, CalendarDays, MessageSquare, Bell, BookOpen } from "lucide-react";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { getLiturgicalDays } from "@/lib/liturgical-calendar";

const LITURGICAL_COLOR_HEX: Record<string, string> = {
  branco: "#d1d5db", roxo: "#9333ea", vermelho: "#dc2626",
  verde: "#16a34a", preto: "#374151", dourado: "#f59e0b", rosa: "#ec4899",
};

export const Route = createFileRoute("/portal-membro")({
  component: PortalMembroLayout,
});

// Nav principal — sidebar desktop + bottom nav mobile (sem Ocorrências e Notificações, que ficam no cabeçalho)
const NAV = [
  { to: "/portal-membro/home",     label: "Início",   icon: Home },
  { to: "/portal-membro/escalas",  label: "Escalas",  icon: Calendar },
  { to: "/portal-membro/eventos",  label: "Eventos",  icon: CalendarDays },
  { to: "/portal-membro/liturgia", label: "Liturgia", icon: BookOpen },
  { to: "/portal-membro/ranking",  label: "Ranking",  icon: Trophy },
  { to: "/portal-membro/perfil",   label: "Perfil",   icon: User },
] as const;

function PortalMembroLayout() {
  const { user, membro, loading, linking, isAdministrador } = useMembroAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const today = useMemo(() => new Date(), []);
  const liturgy = useMemo(() => {
    const days = getLiturgicalDays(today.getFullYear());
    const key = format(today, "yyyy-MM-dd");
    return days.find((d) => format(d.date, "yyyy-MM-dd") === key);
  }, [today]);

  // Realtime global: score muda → invalida todas as queries de ranking
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

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/membro/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && !linking && user && membro === null) navigate({ to: "/membro/primeiro-acesso" });
  }, [loading, linking, user, membro, navigate]);

  useEffect(() => {
    if (pathname === "/portal-membro" || pathname === "/portal-membro/") navigate({ to: "/portal-membro/home" });
  }, [pathname, navigate]);

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
      {/* ── Sidebar desktop ── */}
      <aside className="hidden lg:flex flex-col w-64 bg-sidebar/95 text-sidebar-foreground border-r border-sidebar-border shrink-0 shadow-altar lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2 p-5 border-b border-sidebar-border">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-gold">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="font-serif text-sm leading-tight truncate">{membro.paroquia_nome}</p>
            <p className="text-[10px] text-sidebar-foreground/40 leading-tight">Portal do Servidor</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-primary border-l-2 border-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-semibold truncate">{membro.nome}</p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate">{membro.email}</p>
            {isAdministrador && (
              <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-400/30 font-medium">
                Administrador
              </span>
            )}
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0 lg:h-screen lg:overflow-y-auto">

        {/* ── Cabeçalho desktop ── */}
        <header className="hidden lg:block sticky top-0 z-20 border-b border-border/70 bg-card/90 backdrop-blur px-6 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Portal do Servidor</p>
              <h1 className="mt-1 text-xl font-serif text-foreground">Bem-vindo, {membro.nome.split(" ")[0]}</h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Liturgia pill */}
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
              {/* Ícones de ação */}
              {isAdministrador && (
                <Link
                  to="/portal-membro/ocorrencias"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                  title="Ocorrências"
                >
                  <MessageSquare className="h-4 w-4" />
                </Link>
              )}
              <Link
                to="/portal-membro/notificacoes"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </header>

        {/* ── Cabeçalho mobile ── */}
        <header className="lg:hidden sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
          {liturgy && (
            <div
              className="h-[3px] w-full transition-colors duration-700"
              style={{ background: LITURGICAL_COLOR_HEX[liturgy.color] ?? "#16a34a" }}
            />
          )}
          <div className="flex items-center justify-between px-5 py-4">
            {/* Identidade da paróquia */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground leading-none">Portal do Servidor</p>
                <p className="font-serif text-base leading-tight truncate max-w-[180px] mt-0.5">
                  {membro.paroquia_nome}
                </p>
              </div>
            </div>
            {/* Ações */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isAdministrador && (
                <Link
                  to="/portal-membro/ocorrencias"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition"
                  title="Ocorrências"
                >
                  <MessageSquare className="h-5 w-5" />
                </Link>
              )}
              <Link
                to="/portal-membro/notificacoes"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition"
                title="Notificações"
              >
                <Bell className="h-5 w-5" />
              </Link>
              <button
                onClick={logout}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition"
                title="Sair"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* ── Bottom tab bar mobile ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card/98 backdrop-blur border-t border-border/80 safe-area-pb shadow-[0_-1px_8px_rgba(0,0,0,0.06)]">
        <div className="flex items-stretch h-[60px]">
          {NAV.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors min-w-0 ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className={`h-[22px] w-[22px] shrink-0 ${active ? "stroke-[2.2]" : "stroke-[1.6]"}`} />
                <span className={`text-[10px] leading-none truncate px-0.5 ${active ? "font-bold" : "font-medium"}`}>
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
