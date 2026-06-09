import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, Church, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Phone, Mail, MapPin, User,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/admin/paroquias")({
  component: AdminParoquiasPage,
  head: () => ({ meta: [{ title: "Solicitações de Paróquias — Lumen" }] }),
});

type Solicitacao = {
  id: string;
  nome_paroquia: string;
  diocese: string;
  cidade: string;
  estado: string;
  responsavel: string;
  telefone: string;
  email: string;
  mensagem: string | null;
  status: "pendente" | "em_analise" | "aprovada" | "rejeitada";
  analisado_em: string | null;
  motivo_rejeicao: string | null;
  created_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pendente:    { label: "Pendente",     color: "text-amber-700 bg-amber-50 border-amber-200",   icon: <Clock className="h-3 w-3" /> },
  em_analise:  { label: "Em análise",   color: "text-blue-700 bg-blue-50 border-blue-200",       icon: <AlertTriangle className="h-3 w-3" /> },
  aprovada:    { label: "Aprovada",     color: "text-green-700 bg-green-50 border-green-200",    icon: <CheckCircle2 className="h-3 w-3" /> },
  rejeitada:   { label: "Rejeitada",    color: "text-red-700 bg-red-50 border-red-200",          icon: <XCircle className="h-3 w-3" /> },
};

function AdminParoquiasPage() {
  const { profile, isAdmin, roles } = useAuth();
  const isSuperAdmin = roles.includes("super_admin");
  const qc = useQueryClient();

  const [statusFiltro, setStatusFiltro] = useState("pendente");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Solicitacao | null>(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState("");

  const canAccess = isAdmin || isSuperAdmin;

  const { data: solicitacoes = [], isLoading } = useQuery<Solicitacao[]>({
    queryKey: ["admin-solicitacoes-paroquia", statusFiltro],
    enabled: canAccess,
    queryFn: async () => {
      let q = anyDb
        .from("solicitacoes_paroquia")
        .select("*")
        .order("created_at", { ascending: false });
      if (statusFiltro !== "todas") q = q.eq("status", statusFiltro);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
  });

  const atualizarMutation = useMutation({
    mutationFn: async (args: { id: string; status: string; motivo_rejeicao?: string }) => {
      const { error } = await anyDb
        .from("solicitacoes_paroquia")
        .update({
          status: args.status,
          motivo_rejeicao: args.motivo_rejeicao ?? null,
          analisado_por: profile?.id,
          analisado_em: new Date().toISOString(),
        })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-solicitacoes-paroquia"] });
      const statusLabel = STATUS_CONFIG[vars.status]?.label ?? vars.status;
      toast.success(`Solicitação marcada como: ${statusLabel}`);
      setExpandedId(null);
      setRejectTarget(null);
      setMotivoRejeicao("");
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });

  if (!canAccess) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Acesso restrito.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto space-y-6 pb-24 lg:pb-10">

      <div>
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Administração</p>
        <h1 className="mt-2 font-serif text-2xl sm:text-3xl">Solicitações de Paróquias</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Analise e aprove solicitações de cadastro de novas paróquias.
        </p>
      </div>

      {/* Filtro */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
        {[
          { value: "pendente",   label: "Pendentes" },
          { value: "em_analise", label: "Em análise" },
          { value: "aprovada",   label: "Aprovadas" },
          { value: "rejeitada",  label: "Rejeitadas" },
          { value: "todas",      label: "Todas" },
        ].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFiltro(f.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              statusFiltro === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : solicitacoes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <Church className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-foreground/70">Nenhuma solicitação</p>
          <p className="text-sm text-muted-foreground mt-1">
            Nenhuma solicitação com status "{STATUS_CONFIG[statusFiltro]?.label ?? statusFiltro}".
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {solicitacoes.map((sol) => {
            const cfg = STATUS_CONFIG[sol.status] ?? STATUS_CONFIG.pendente;
            const expanded = expandedId === sol.id;

            return (
              <div key={sol.id} className="rounded-2xl border border-border bg-card shadow-altar overflow-hidden">
                {/* Cabeçalho */}
                <button
                  className="w-full text-left px-5 py-4"
                  onClick={() => setExpandedId(expanded ? null : sol.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Church className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <p className="text-sm font-semibold leading-snug truncate">{sol.nome_paroquia}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{sol.diocese} · {sol.cidade}/{sol.estado}</p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Enviado em {format(new Date(sol.created_at), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                      {expanded
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </div>
                  </div>
                </button>

                {/* Detalhes expandidos */}
                {expanded && (
                  <div className="border-t border-border/50 px-5 py-5 space-y-5">

                    {/* Dados do responsável */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-start gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</p>
                          <p className="text-sm font-medium mt-0.5">{sol.responsavel}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Telefone</p>
                          <p className="text-sm font-medium mt-0.5">{sol.telefone}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">E-mail</p>
                          <p className="text-sm font-medium mt-0.5 break-all">{sol.email}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Localização</p>
                          <p className="text-sm font-medium mt-0.5">{sol.cidade} — {sol.estado}</p>
                        </div>
                      </div>
                    </div>

                    {sol.mensagem && (
                      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Mensagem</p>
                        <p className="text-sm text-foreground/80 leading-relaxed">{sol.mensagem}</p>
                      </div>
                    )}

                    {sol.motivo_rejeicao && (
                      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3">
                        <p className="text-[10px] uppercase tracking-wider text-red-600 mb-1">Motivo da rejeição</p>
                        <p className="text-sm text-red-800 dark:text-red-200">{sol.motivo_rejeicao}</p>
                      </div>
                    )}

                    {/* Ações — só para pendente/em_analise */}
                    {(sol.status === "pendente" || sol.status === "em_analise") && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {sol.status === "pendente" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={atualizarMutation.isPending}
                            onClick={() => atualizarMutation.mutate({ id: sol.id, status: "em_analise" })}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Iniciar análise
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          disabled={atualizarMutation.isPending}
                          onClick={() => atualizarMutation.mutate({ id: sol.id, status: "aprovada" })}
                        >
                          {atualizarMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <CheckCircle2 className="h-3.5 w-3.5" />
                          }
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={atualizarMutation.isPending}
                          onClick={() => { setRejectTarget(sol); setMotivoRejeicao(""); }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog de rejeição */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              Informe o motivo da rejeição. O solicitante poderá ser notificado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            rows={3}
            placeholder="Motivo da rejeição (obrigatório)…"
            value={motivoRejeicao}
            onChange={(e) => setMotivoRejeicao(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring resize-none"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={!motivoRejeicao.trim() || atualizarMutation.isPending}
              onClick={() =>
                rejectTarget && atualizarMutation.mutate({
                  id: rejectTarget.id,
                  status: "rejeitada",
                  motivo_rejeicao: motivoRejeicao.trim(),
                })
              }
            >
              {atualizarMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
