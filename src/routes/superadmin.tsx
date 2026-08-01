import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import {
  LayoutDashboard, Church, Users, CreditCard,
  FileText, Settings, Shield, Webhook, LogOut,
  ChevronLeft, Activity, AlertTriangle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/superadmin")({
  component: SuperAdminLayout,
});

const NAV = [
  { to: "/superadmin/dashboard",  label: "Dashboard",   icon: LayoutDashboard },
  { to: "/superadmin/paroquias",  label: "Paróquias",   icon: Church },
  { to: "/superadmin/usuarios",   label: "Usuários",    icon: Users },
  { to: "/superadmin/financeiro", label: "Financeiro",  icon: CreditCard },
  { to: "/superadmin/planos",     label: "Planos",      icon: Settings },
  { to: "/superadmin/auditoria",  label: "Auditoria",   icon: Shield },
  { to: "/superadmin/webhooks",   label: "Webhooks",    icon: Webhook },
];

function SuperAdminLayout() {
  const { isSuperAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";

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
      {/* Sidebar */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-white/10 bg-[#0F1E33]">
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
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:text-white/70 rounded-md hover:bg-white/5"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Voltar ao sistema
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:text-red-400 rounded-md hover:bg-white/5"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto bg-[#0B1525]">
        <Outlet />
      </main>
    </div>
  );
}
