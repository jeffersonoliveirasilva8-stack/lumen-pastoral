import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Church, Users, CreditCard,
  Settings, Shield, Webhook, LogOut,
  ChevronLeft, Menu, X, KeyRound
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/superadmin")({
  component: SuperAdminLayout,
});

const NAV = [
  { to: "/superadmin/dashboard",    label: "Dashboard",   icon: LayoutDashboard },
  { to: "/superadmin/paroquias",    label: "Paróquias",   icon: Church },
  { to: "/superadmin/usuarios",     label: "Usuários",    icon: Users },
  { to: "/superadmin/financeiro",   label: "Financeiro",  icon: CreditCard },
  { to: "/superadmin/planos",       label: "Planos",      icon: Settings },
  { to: "/superadmin/credenciais",  label: "Credenciais", icon: KeyRound },
  { to: "/superadmin/auditoria",    label: "Auditoria",   icon: Shield },
  { to: "/superadmin/webhooks",     label: "Webhooks",    icon: Webhook },
];

function SidebarContent({
  pathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-white/10 flex-shrink-0">
        <div className="w-7 h-7 rounded bg-blue-600 grid place-items-center text-xs font-bold">LP</div>
        <div>
          <div className="text-xs font-semibold text-white/90 leading-none">Lumen Pastoral</div>
          <div className="text-[10px] text-white/40 mt-0.5">Super Admin</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
                active
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-white/10">
        <Link
          to="/painel"
          onClick={onNavigate}
          className="flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:text-white/70 rounded-md hover:bg-white/5"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Voltar ao sistema
        </Link>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:text-red-400 rounded-md hover:bg-white/5"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </>
  );
}

function SuperAdminLayout() {
  const { isSuperAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !isSuperAdmin) navigate({ to: "/painel" });
  }, [loading, isSuperAdmin]);

  if (loading) return <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">Carregando…</div>;
  if (!isSuperAdmin) return null;

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex h-screen bg-[#0B1525] text-white overflow-hidden">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-[220px] flex-shrink-0 flex-col border-r border-white/10 bg-[#0F1E33]">
        <SidebarContent pathname={pathname} onNavigate={() => {}} onLogout={handleLogout} />
      </aside>

      {/* Sidebar — mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[220px] flex flex-col border-r border-white/10 bg-[#0F1E33] transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          onLogout={handleLogout}
        />
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto bg-[#0B1525]">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-white/10 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-white/60 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-blue-600 grid place-items-center text-[10px] font-bold">LP</div>
            <span className="text-xs font-medium text-white/70">Super Admin</span>
          </div>
          {mobileOpen && (
            <button
              onClick={() => setMobileOpen(false)}
              className="ml-auto text-white/60 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
