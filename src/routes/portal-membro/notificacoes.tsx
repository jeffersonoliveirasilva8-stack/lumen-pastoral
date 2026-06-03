import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BellOff, Info, AlertTriangle, Zap, Settings2, CheckCheck, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

  const { data: notifs = [], isLoading } = useQuery<Notificacao[]>({
    queryKey: ["pm-notificacoes", membro?.paroquia_id, membro?.id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("notificacoes")
        .select("id, titulo, mensagem, tipo, lida, created_at, link_referencia")
        .eq("paroquia_id", membro!.paroquia_id)
        // Membros recebem: aviso (nova escala, evento) + urgente (comunicados críticos)
        // Tipo 'alerta' e 'sistema' são exclusivos da coordenação
        .in("tipo", ["aviso", "urgente"])
        // destinatario_id referencia membros(id) — usa membro.id, não auth.uid()
        .or(`destinatario_id.is.null,destinatario_id.eq.${membro!.id}`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime: novas notificações
  useEffect(() => {
    if (!membro?.paroquia_id) return;
    const ch = supabase
      .channel(`pm-notif-rt-${membro.paroquia_id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notificacoes",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["pm-notificacoes", membro.paroquia_id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [membro?.paroquia_id, qc]);

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
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  const naoLidas = notifs.filter((n) => !n.lida).length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-24 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
          <h1 className="mt-1.5 font-serif text-3xl flex items-center gap-2">
            Notificações
            {naoLidas > 0 && (
              <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold px-2">
                {naoLidas}
              </span>
            )}
          </h1>
        </div>
        {naoLidas > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => marcarTodasMutation.mutate()}
            disabled={marcarTodasMutation.isPending}
            className="shrink-0 mt-1"
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
      ) : notifs.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-border p-14 text-center">
          <BellOff className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma notificação ainda.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifs.map((n) => {
            const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.aviso;
            const Icon = cfg.icon;
            return (
              <button
                key={n.id}
                onClick={() => { if (!n.lida) marcarLidaMutation.mutate(n.id); }}
                className={`w-full text-left rounded-2xl border px-4 py-4 transition ${
                  n.lida
                    ? "border-border bg-card opacity-70"
                    : `${cfg.color} shadow-sm`
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 mt-0.5 rounded-full p-1.5 ${n.lida ? "bg-muted" : ""}`}>
                    <Icon className={`h-4 w-4 ${n.lida ? "text-muted-foreground" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-semibold leading-snug ${n.lida ? "text-foreground/70" : ""}`}>
                        {n.titulo}
                      </p>
                      {!n.lida && (
                        <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                      )}
                    </div>
                    {n.mensagem && (
                      <p className={`text-xs mt-1 leading-relaxed ${n.lida ? "text-muted-foreground" : "text-foreground/80"}`}>
                        {n.mensagem}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] font-medium ${n.lida ? "text-muted-foreground/60" : "text-foreground/50"}`}>
                        {cfg.label}
                      </span>
                      <span className={`text-[10px] ${n.lida ? "text-muted-foreground/40" : "text-foreground/40"}`}>·</span>
                      <span className={`text-[10px] capitalize ${n.lida ? "text-muted-foreground/60" : "text-foreground/50"}`}>
                        {format(parseISO(n.created_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
