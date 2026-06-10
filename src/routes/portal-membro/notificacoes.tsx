import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BellOff, Info, AlertTriangle, Zap, Settings2, CheckCheck, Loader2,
  Clock, History, ChevronDown, ChevronUp, Trash2,
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
  lida: boolean;
  created_at: string;
  link_referencia: string | null;
};

const TIPO_CONFIG: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = {
  aviso:   { label: "Aviso",   icon: Info,          color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800" },
  alerta:  { label: "Alerta",  icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" },
  urgente: { label: "Urgente", icon: Zap,           color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" },
  sistema: { label: "Sistema", icon: Settings2,     color: "text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-950/30 dark:border-slate-800" },
};

function PortalMembroNotificacoes() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: notifs = [], isLoading } = useQuery<Notificacao[]>({
    queryKey: ["pm-notificacoes", membro?.paroquia_id, membro?.id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      // Tenta com filtro de destinatário; cai no fallback se a coluna não existir
      const { data, error } = await anyDb
        .from("notificacoes")
        .select("id, titulo, mensagem, tipo, lida, created_at, link_referencia")
        .eq("paroquia_id", membro!.paroquia_id)
        .in("tipo", ["aviso", "alerta", "urgente", "sistema"])
        .or(`destinatario_id.is.null,destinatario_id.eq.${membro!.id}`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        // destinatario_id ainda não existe — fallback sem filtro de destinatário
        if (error.message?.toLowerCase().includes("destinatario_id") || error.code === "42703") {
          const { data: d2, error: e2 } = await anyDb
            .from("notificacoes")
            .select("id, titulo, mensagem, tipo, lida, created_at, link_referencia")
            .eq("paroquia_id", membro!.paroquia_id)
            .in("tipo", ["aviso", "alerta", "urgente", "sistema"])
            .order("created_at", { ascending: false })
            .limit(50);
          if (e2) throw e2;
          return d2 ?? [];
        }
        throw error;
      }
      return data ?? [];
    },
  });

  // Realtime: INSERT, UPDATE e DELETE de notificações
  useEffect(() => {
    if (!membro?.paroquia_id) return;
    const ch = supabase
      .channel(`pm-notif-rt-${membro.paroquia_id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "notificacoes",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [membro?.paroquia_id, qc]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb.from("notificacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
      setDeleteId(null);
      toast.success("Notificação removida.");
    },
    onError: (e: Error) => toast.error("Erro ao remover: " + e.message),
  });

  const marcarLidaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyDb
        .from("notificacoes")
        .update({ lida: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  const marcarTodasMutation = useMutation({
    mutationFn: async () => {
      const ids = notifs.filter((n) => !n.lida).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await anyDb
        .from("notificacoes")
        .update({ lida: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-notificacoes"] });
      toast.success("Todas as notificações marcadas como lidas.");
      setHistoricoOpen(true);
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  const pendentes = notifs.filter((n) => !n.lida);
  const lidas = notifs.filter((n) => n.lida);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-24 space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
          <h1 className="mt-1.5 font-serif text-3xl flex items-center gap-2">
            Notificações
            {pendentes.length > 0 && (
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold px-2">
                {pendentes.length}
              </span>
            )}
          </h1>
        </div>
        {pendentes.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => marcarTodasMutation.mutate()}
            disabled={marcarTodasMutation.isPending}
            className="self-start sm:shrink-0 sm:mt-1"
          >
            {marcarTodasMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCheck className="h-3.5 w-3.5" />
            }
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── PENDENTES ──────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/60">Pendentes</h2>
              {pendentes.length > 0 && (
                <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                  {pendentes.length}
                </span>
              )}
            </div>

            {pendentes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                <CheckCheck className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Você está em dia! Nenhuma pendência.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendentes.map((n) => {
                  const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
                  const Icon = cfg.icon;
                  return (
                    <div key={n.id} className={`flex items-stretch rounded-2xl border shadow-sm ${cfg.color}`}>
                      <button
                        type="button"
                        onClick={() => {
                          marcarLidaMutation.mutate(n.id);
                          if (n.link_referencia?.startsWith("/portal-membro/")) {
                            navigate({ to: n.link_referencia as never });
                          }
                        }}
                        disabled={marcarLidaMutation.isPending}
                        className="flex-1 text-left px-4 py-4 transition active:scale-[0.99]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 mt-0.5 rounded-full p-1.5">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold leading-snug">{n.titulo}</p>
                              <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                            </div>
                            {n.mensagem && (
                              <p className="text-xs mt-1 leading-relaxed text-foreground/80">{n.mensagem}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] font-medium text-foreground/50">{cfg.label}</span>
                              <span className="text-[10px] text-foreground/40">·</span>
                              <span className="text-[10px] capitalize text-foreground/50">
                                {format(parseISO(n.created_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[11px] text-foreground/50 underline underline-offset-2">
                              {n.link_referencia ? "Toque para abrir" : "Toque para marcar como lida"}
                            </p>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(n.id)}
                        className="px-3 border-l border-current/20 rounded-r-2xl hover:bg-black/10 transition shrink-0"
                        title="Remover notificação"
                      >
                        <Trash2 className="h-3.5 w-3.5 opacity-40 hover:opacity-80" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── HISTÓRICO ──────────────────────────────────────────────── */}
          {lidas.length > 0 && (
            <section>
              <button
                type="button"
                className="flex items-center gap-2 mb-3 w-full group"
                onClick={() => setHistoricoOpen((o) => !o)}
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 group-hover:text-foreground/60 transition">
                  Histórico
                </h2>
                <span className="text-xs text-muted-foreground/50 bg-muted rounded-full px-2 py-0.5">
                  {lidas.length}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {historicoOpen
                    ? <ChevronUp className="h-3.5 w-3.5" />
                    : <ChevronDown className="h-3.5 w-3.5" />
                  }
                </span>
              </button>

              {historicoOpen && (
                <div className="space-y-2">
                  {lidas.map((n) => {
                    const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={n.id}
                        className="flex items-stretch rounded-2xl border border-border bg-card/50 opacity-60"
                      >
                        <div className="flex-1 flex items-start gap-3 px-4 py-3">
                          <div className="shrink-0 mt-0.5 rounded-full p-1.5 bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground/70 leading-snug">{n.titulo}</p>
                            {n.mensagem && (
                              <p className="text-xs mt-0.5 leading-relaxed text-muted-foreground line-clamp-2">
                                {n.mensagem}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-muted-foreground/60">{cfg.label}</span>
                              <span className="text-[10px] text-muted-foreground/40">·</span>
                              <span className="text-[10px] capitalize text-muted-foreground/60">
                                {format(parseISO(n.created_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeleteId(n.id)}
                          className="px-3 border-l border-border/50 rounded-r-2xl hover:bg-destructive/10 hover:text-destructive transition shrink-0"
                          title="Remover notificação"
                        >
                          <Trash2 className="h-3.5 w-3.5 opacity-50" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Estado vazio total */}
          {notifs.length === 0 && (
            <div className="rounded-[1.75rem] border border-dashed border-border p-14 text-center">
              <BellOff className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma notificação ainda.</p>
            </div>
          )}
        </div>
      )}

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
