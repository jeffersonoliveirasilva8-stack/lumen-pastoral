import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, UserCog, ShieldCheck, Shield, User, Trash2, Search,
  CheckCircle, XCircle, Eye,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModuleTabBar } from "@/components/ui/module-tab-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase;

export const Route = createFileRoute("/_authenticated/configuracoes/administradores")({
  component: AdministradoresPage,
  head: () => ({ meta: [{ title: "Coordenação — Lumen Pastoral" }] }),
});

type AdminUser = {
  id: string;
  user_id: string;
  role: "admin" | "coordenador" | "auxiliar";
  created_at: string;
  perfil: { nome: string; email: string | null } | null;
};

// Mapa visual e de permissões por cargo
const ROLE_CONFIG: Record<string, {
  label: string;
  desc: string;
  color: string;
  bgSection: string;
  icon: React.ElementType;
  permissions: string[];
  restrictions: string[];
}> = {
  admin: {
    label: "Coordenador",
    desc: "Controle total da pastoral",
    color: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
    bgSection: "border-red-100 dark:border-red-900/40",
    icon: ShieldCheck,
    permissions: [
      "Gerenciar membros e aprovações",
      "Criar e publicar escalas",
      "Configurar regras e ministérios",
      "Adicionar/remover coordenadores",
      "Visualizar auditoria",
      "Exportar relatórios",
    ],
    restrictions: [],
  },
  coordenador: {
    label: "Vice-Coordenador",
    desc: "Gestão de escalas e membros",
    color: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
    bgSection: "border-blue-100 dark:border-blue-900/40",
    icon: Shield,
    permissions: [
      "Criar e publicar escalas",
      "Gerenciar membros",
      "Registrar presenças",
      "Visualizar configurações",
    ],
    restrictions: [
      "Sem acesso a configurações avançadas",
      "Não gerencia outros coordenadores",
    ],
  },
  auxiliar: {
    label: "Secretário",
    desc: "Visualização e confirmações",
    color: "text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/20 dark:border-teal-800",
    bgSection: "border-teal-100 dark:border-teal-900/40",
    icon: User,
    permissions: [
      "Visualizar escalas",
      "Confirmar presenças",
      "Acessar portal do membro",
    ],
    restrictions: [
      "Sem criação ou edição de escalas",
      "Sem acesso ao painel admin",
    ],
  },
};

// Ordem de exibição dos cargos
const ROLE_ORDER = ["admin", "coordenador", "auxiliar"] as const;

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function AdminCard({ a, isMe, isAdmin: canDelete, onRemove }: {
  a: AdminUser;
  isMe: boolean;
  isAdmin: boolean;
  onRemove: (a: AdminUser) => void;
}) {
  const cfg = ROLE_CONFIG[a.role] ?? ROLE_CONFIG.auxiliar;
  const Icon = cfg.icon;

  return (
    <div className={`flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 transition-shadow hover:shadow-sm ${isMe ? "border-primary/30 bg-primary/[0.02]" : "border-border"}`}>
      {/* Avatar */}
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm ${cfg.color}`}>
        {initials(a.perfil?.nome ?? "?")}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm truncate">{a.perfil?.nome ?? "—"}</p>
          {isMe && (
            <span className="text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">
              você
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{a.perfil?.email ?? "—"}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Desde {format(new Date(a.created_at), "d MMM yyyy", { locale: ptBR })}
        </p>
      </div>

      {/* Cargo + ação */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-semibold ${cfg.color}`}>
          <Icon className="h-3 w-3" />
          {cfg.label}
        </span>
        {canDelete && !isMe && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
            onClick={() => onRemove(a)}
            title={`Remover acesso de ${a.perfil?.nome}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function RolePermissionsCard({ role }: { role: keyof typeof ROLE_CONFIG }) {
  const cfg = ROLE_CONFIG[role];
  const Icon = cfg.icon;
  return (
    <div className={`rounded-xl border p-4 ${cfg.bgSection} bg-card/50`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold ${cfg.color}`}>
          <Icon className="h-3 w-3" />
          {cfg.label}
        </span>
        <span className="text-xs text-muted-foreground">{cfg.desc}</span>
      </div>
      <div className="grid gap-1">
        {cfg.permissions.map((p) => (
          <div key={p} className="flex items-start gap-2 text-xs text-foreground/80">
            <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
            {p}
          </div>
        ))}
        {cfg.restrictions.map((r) => (
          <div key={r} className="flex items-start gap-2 text-xs text-muted-foreground">
            <XCircle className="h-3 w-3 text-muted-foreground/50 shrink-0 mt-0.5" />
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdministradoresPage() {
  const { profile, isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  const { data: admins = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["admins-lista", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("user_roles")
        .select("id, user_id, role, created_at, profiles!user_roles_user_id_fkey(nome, email)")
        .eq("paroquia_id", profile!.paroquia_id!)
        .order("role")
        .order("created_at");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        perfil: r.profiles ?? null,
      })) as AdminUser[];
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admins-lista"] });
      toast.success("Acesso removido com sucesso.");
      setRemoveTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const filtered = admins.filter((a) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (a.perfil?.nome ?? "").toLowerCase().includes(s) ||
      (a.perfil?.email ?? "").toLowerCase().includes(s)
    );
  });

  // Agrupa por cargo na ordem definida
  const grouped = ROLE_ORDER.map((role) => ({
    role,
    items: filtered.filter((a) => a.role === role),
  })).filter((g) => g.items.length > 0);

  if (!isAdmin) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Acesso restrito a coordenadores.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      <ModuleTabBar tabs={[
        { label: "Geral",       to: "/configuracoes/paroquia",        isActive: false },
        { label: "Motor",       to: "/configuracoes-escalas",         isActive: false },
        { label: "Coordenação", to: "/configuracoes/administradores", isActive: true  },
        { label: "Auditoria",   to: "/auditoria",                     isActive: false },
      ]} />

      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-bold tracking-[0.2em] uppercase text-gold">Configurações</p>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">Equipe de coordenação</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {admins.length === 0 ? "Nenhum membro na equipe ainda." : `${admins.length} pessoa${admins.length !== 1 ? "s" : ""} com acesso ao painel`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 text-xs"
            onClick={() => setShowPermissions(!showPermissions)}
          >
            <Eye className="h-3.5 w-3.5" />
            {showPermissions ? "Ocultar" : "Cargos"}
          </Button>
        </div>
      </div>

      {/* Painel de permissões por cargo */}
      {showPermissions && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 animate-fade-in">
          {ROLE_ORDER.map((role) => (
            <RolePermissionsCard key={role} role={role} />
          ))}
        </div>
      )}

      {/* Busca */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail…"
          className="pl-9"
        />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4">
              <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-3 w-56 rounded" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title={search.trim() ? "Nenhum resultado" : "Nenhum membro na equipe"}
          description={
            search.trim()
              ? `Nenhum coordenador corresponde a "${search}".`
              : "Adicione coordenadores pelo perfil de um membro em Membros → Definir acesso."
          }
          action={search.trim() ? { label: "Limpar busca", onClick: () => setSearch("") } : undefined}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ role, items }) => {
            const cfg = ROLE_CONFIG[role];
            const Icon = cfg.icon;
            return (
              <div key={role}>
                {/* Label do grupo */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border font-bold ${cfg.color}`}>
                    <Icon className="h-2.5 w-2.5" />
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{cfg.desc}</span>
                  <span className="ml-auto text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {items.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {items.map((a) => (
                    <AdminCard
                      key={a.id}
                      a={a}
                      isMe={a.user_id === user?.id}
                      isAdmin={isAdmin}
                      onRemove={setRemoveTarget}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog de confirmação de remoção */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso ao painel?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.perfil?.nome}</strong> perderá o acesso ao painel desta paróquia
              e não poderá mais gerenciar escalas ou membros. Esta ação pode ser desfeita a qualquer
              momento reconfigurando o acesso nas configurações de membros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              {removeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Remover acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
