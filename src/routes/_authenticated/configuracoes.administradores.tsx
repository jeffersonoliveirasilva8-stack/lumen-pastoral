import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, UserCog, ShieldCheck, Shield, User, Trash2, Search,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModuleTabBar } from "@/components/ui/module-tab-bar";
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

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  admin: {
    label: "Coordenador",
    color: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
    icon: <ShieldCheck className="h-3 w-3" />,
  },
  coordenador: {
    label: "Vice-Coordenador",
    color: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
    icon: <Shield className="h-3 w-3" />,
  },
  auxiliar: {
    label: "Secretário",
    color: "text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/20 dark:border-teal-800",
    icon: <User className="h-3 w-3" />,
  },
};

function AdministradoresPage() {
  const { profile, isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);

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
      toast.success("Acesso removido.");
      setRemoveTarget(null);
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  const filtered = admins.filter((a) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (a.perfil?.nome ?? "").toLowerCase().includes(s) ||
      (a.perfil?.email ?? "").toLowerCase().includes(s) ||
      a.role.toLowerCase().includes(s)
    );
  });

  if (!isAdmin) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <ModuleTabBar tabs={[
        { label: "Geral",       to: "/configuracoes/paroquia",        isActive: false },
        { label: "Coordenação", to: "/configuracoes/administradores", isActive: true  },
        { label: "Auditoria",   to: "/auditoria",                     isActive: false },
      ]} />

      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Configurações</p>
        <h1 className="mt-2 font-serif text-2xl sm:text-4xl">Coordenação</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Membros da equipe de coordenação com acesso ao painel.
        </p>
      </div>

      {/* Busca */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail…"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <UserCog className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {search.trim() ? "Nenhum resultado para a busca." : "Nenhum administrador cadastrado."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const roleCfg = ROLE_CONFIG[a.role] ?? ROLE_CONFIG.auxiliar;
            const isMe = a.user_id === user?.id;
            return (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4"
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-primary">
                    {(a.perfil?.nome ?? "?").charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate">{a.perfil?.nome ?? "—"}</p>
                    {isMe && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                        você
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {a.perfil?.email ?? "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Desde {format(new Date(a.created_at), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${roleCfg.color}`}>
                    {roleCfg.icon}
                    {roleCfg.label}
                  </span>
                  {isAdmin && !isMe && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRemoveTarget(a)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.perfil?.nome}</strong> perderá o acesso ao painel desta paróquia.
              Esta ação pode ser desfeita convidando o usuário novamente.
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
