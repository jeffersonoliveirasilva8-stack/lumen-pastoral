import { createFileRoute } from "@tanstack/react-router";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, ArrowLeftRight, CheckCircle2, XCircle, Clock,
  AlertTriangle, Filter, HandHelping, ChevronDown, ChevronUp,
  Users, Search, BarChart3,
} from "lucide-react";
import { RelatoriosContent } from "@/routes/_authenticated/relatorios-substituicoes";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/substituicoes")({
  component: AdminSubstituicoes,
  head: () => ({ meta: [{ title: "Substituições — Lumen Pastoral" }] }),
});

type Substituicao = {
  id: string;
  status: string;
  motivo_solicitacao: string | null;
  motivo_rejeicao: string | null;
  aprovado_em: string | null;
  created_at: string;
  escala_id: string;
  escala_titulo: string;
  escala_data: string;
  ministerio_id: string;
  ministerio_nome: string;
  ministerio_cor: string;
  solicitante_nome: string;
  substituto_nome: string | null;
  aprovador_nome: string | null;
};

type Substituto = {
  membro_id: string;
  nome: string;
  score: number;
  tem_indisp: boolean;
};

const STATUS_FILTER = [
  { value: null, label: "Todas" },
  { value: "com_voluntario", label: "Com voluntário" },
  { value: "solicitada", label: "Aguardando" },
  { value: "aprovada", label: "Aprovadas" },
  { value: "rejeitada", label: "Rejeitadas" },
  { value: "cancelada", label: "Canceladas" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  solicitada:    { label: "Aguardando voluntário", color: "text-amber-600", bg: "bg-amber-500/15 border-amber-500/30" },
  com_voluntario:{ label: "Com voluntário",        color: "text-blue-600",  bg: "bg-blue-500/15 border-blue-500/30" },
  aprovada:      { label: "Aprovada",              color: "text-green-600", bg: "bg-green-500/15 border-green-500/30" },
  rejeitada:     { label: "Não aprovada",          color: "text-red-600",   bg: "bg-red-500/15 border-red-500/30" },
  cancelada:     { label: "Cancelada",             color: "text-muted-foreground", bg: "bg-muted/60 border-border" },
};

function AdminSubstituicoes() {
  const { profile, isAdmin, isCoordenador } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? null;
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"gestao" | "relatorios">("gestao");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [substitutosModal, setSubstitutosModal] = useState<{ substId: string; escalaId: string; ministerioId: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: configEscalas } = useQuery<{ substituicao_ativa: boolean } | null>({
    queryKey: ["config-escalas", paroquiaId],
    enabled: !!paroquiaId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquia_config_escalas")
        .select("substituicao_ativa")
        .eq("paroquia_id", paroquiaId)
        .maybeSingle();
      return data;
    },
  });

  const substituicaoAtiva = configEscalas?.substituicao_ativa ?? false;
  const isCoord = isAdmin || isCoordenador;

  const { data: substituicoes = [], isLoading, refetch } = useQuery<Substituicao[]>({
    queryKey: ["admin-substituicoes", paroquiaId, statusFilter],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("coord_get_substituicoes", {
        p_status: statusFilter ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: substitutos = [], isLoading: loadingSubstitutos } = useQuery<Substituto[]>({
    queryKey: ["admin-substitutos", substitutosModal?.escalaId, substitutosModal?.ministerioId],
    enabled: !!substitutosModal,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_buscar_substitutos", {
        p_escala_id:     substitutosModal!.escalaId,
        p_ministerio_id: substitutosModal!.ministerioId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const aprovarMutation = useMutation({
    mutationFn: async (substId: string) => {
      const { data, error } = await anyDb.rpc("coord_aprovar_substituicao", {
        p_substituicao_id: substId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Erro ao aprovar");
      return data;
    },
    onSuccess: (_data, substId) => {
      qc.invalidateQueries({ queryKey: ["admin-substituicoes"] });
      toast.success("Substituição aprovada. Escala atualizada.");
      anyDb.functions
        .invoke("notificar-substituicao", { body: { substituicao_id: substId, acao: "aprovada" } })
        .catch(() => {});
    },
    onError: (e: Error) => {
      const msg = e.message === "substituicao_sem_voluntario"
        ? "Esta substituição não tem voluntário ainda."
        : e.message === "sem_permissao"
        ? "Você não tem permissão para aprovar substituições."
        : e.message;
      toast.error(msg);
    },
  });

  const rejeitarMutation = useMutation({
    mutationFn: async ({ substId, motivo }: { substId: string; motivo: string }) => {
      const { data, error } = await anyDb.rpc("coord_rejeitar_substituicao", {
        p_substituicao_id: substId,
        p_motivo:          motivo.trim() || null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Erro ao rejeitar");
      return data;
    },
    onSuccess: (_data, { substId }) => {
      qc.invalidateQueries({ queryKey: ["admin-substituicoes"] });
      toast.success("Substituição rejeitada. Membro notificado.");
      anyDb.functions
        .invoke("notificar-substituicao", { body: { substituicao_id: substId, acao: "rejeitada" } })
        .catch(() => {});
      setRejectId(null);
      setRejectMotivo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = substituicoes.filter((s) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      s.solicitante_nome?.toLowerCase().includes(q) ||
      s.substituto_nome?.toLowerCase().includes(q) ||
      s.escala_titulo?.toLowerCase().includes(q) ||
      s.ministerio_nome?.toLowerCase().includes(q)
    );
  });

  const pendentes = substituicoes.filter((s) => ["com_voluntario", "solicitada"].includes(s.status)).length;
  const aprovadas = substituicoes.filter((s) => s.status === "aprovada").length;
  const rejeitadas = substituicoes.filter((s) => s.status === "rejeitada").length;
  const canceladas = substituicoes.filter((s) => s.status === "cancelada").length;

  useSetPageTabs([
    { label: "Planejamento",       to: "/escalas",                         isActive: false },
    { label: "Presença",           to: "/sacristia",                       isActive: false },
    { label: "Indisponibilidades", to: "/escalas?view=indisponibilidades", isActive: false },
    { label: "Substituições",      to: "/substituicoes",                   isActive: true  },
    { label: "Relatório",          to: "/relatorios-equilibrio",           isActive: false },
  ]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:px-6 space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-header-title">Substituições</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie solicitações de troca de escala da paróquia.
          </p>
        </div>
        {pendentes > 0 && activeTab === "gestao" && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{pendentes} pendente{pendentes !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* Banner: feature desabilitada — aviso informacional para coord, bloqueante para membros */}
      {!substituicaoAtiva && !isCoord && (
        <div className="rounded-2xl border border-border bg-muted/30 p-6 text-center space-y-3">
          <ArrowLeftRight className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <div>
            <p className="text-sm font-semibold text-foreground">Substituições desabilitadas</p>
            <p className="text-xs text-muted-foreground mt-1">
              As substituições estão desabilitadas para esta paróquia no momento.
            </p>
          </div>
        </div>
      )}

      {/* Aviso informacional para coordenador quando feature está desabilitada */}
      {!substituicaoAtiva && isCoord && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Substituições desabilitadas para membros.{" "}
            <a href="/configuracoes-escalas" className="font-semibold underline underline-offset-2">
              Ativar em Configurações → Escalas
            </a>
          </span>
        </div>
      )}

      {/* Indicadores de status — com dados */}
      {substituicoes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2.5 text-center">
            <p className="text-xl font-serif font-bold text-amber-600">{pendentes}</p>
            <p className="text-[10px] uppercase tracking-wide text-amber-700/70 mt-0.5">Pendentes</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-3 py-2.5 text-center">
            <p className="text-xl font-serif font-bold text-green-600">{aprovadas}</p>
            <p className="text-[10px] uppercase tracking-wide text-green-700/70 mt-0.5">Aprovadas</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-3 py-2.5 text-center">
            <p className="text-xl font-serif font-bold text-red-600">{rejeitadas}</p>
            <p className="text-[10px] uppercase tracking-wide text-red-700/70 mt-0.5">Rejeitadas</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-xl font-serif font-bold text-muted-foreground">{canceladas}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mt-0.5">Canceladas</p>
          </div>
        </div>
      )}

      {/* Abas: Gestão | Relatórios */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("gestao")}
          className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "gestao"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 inline mr-1.5" />
          Gestão
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("relatorios")}
          className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "relatorios"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />
          Relatórios
        </button>
      </div>

      <>
      {/* Aba Relatórios */}
      {activeTab === "relatorios" && <RelatoriosContent />}

      {/* Aba Gestão — Filtros */}
      {activeTab === "gestao" && <>

      {/* Filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTER.map((f) => (
            <button
              key={String(f.value)}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                statusFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            placeholder="Buscar por membro ou escala…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-input bg-background text-sm outline-none focus:border-ring"
          />
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center">
          <ArrowLeftRight className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {searchTerm ? "Nenhum resultado encontrado." : "Nenhuma substituição encontrada."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <SubstAdminCard
              key={s.id}
              subst={s}
              onAprovar={() => aprovarMutation.mutate(s.id)}
              onRejeitar={() => setRejectId(s.id)}
              onBuscarSubstitutos={(escalaId, ministerioId) =>
                setSubstitutosModal({ substId: s.id, escalaId, ministerioId })
              }
              saving={aprovarMutation.isPending || rejeitarMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Dialog: rejeitar */}
      <Dialog open={!!rejectId} onOpenChange={(o) => { if (!o) { setRejectId(null); setRejectMotivo(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar substituição</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">
              Informe o motivo. <span className="text-destructive font-medium">Obrigatório</span> — o solicitante será notificado.
            </p>
            <textarea
              value={rejectMotivo}
              onChange={(e) => setRejectMotivo(e.target.value)}
              placeholder="Ex: o voluntário não tem a qualificação necessária para este ministério…"
              rows={3}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none"
            />
            {rejectMotivo.trim().length > 0 && rejectMotivo.trim().length < 15 && (
              <p className="text-[11px] text-destructive">Digite ao menos 15 caracteres para que o motivo seja claro.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectMotivo(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={rejeitarMutation.isPending || rejectMotivo.trim().length < 15}
              onClick={() => rejectId && rejeitarMutation.mutate({ substId: rejectId, motivo: rejectMotivo })}
            >
              {rejeitarMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Confirmar rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: buscar substitutos */}
      <Dialog open={!!substitutosModal} onOpenChange={(o) => !o && setSubstitutosModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Membros disponíveis para substituir
            </DialogTitle>
          </DialogHeader>
          {loadingSubstitutos ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : substitutos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum membro disponível com essa função.
            </p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {substitutos.map((s) => (
                <div
                  key={s.membro_id}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                    s.tem_indisp
                      ? "border-amber-200 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-800"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.nome}</p>
                    {s.tem_indisp && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                        <AlertTriangle className="h-3 w-3" />
                        Tem indisponibilidade nessa data
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{s.score}pts</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubstitutosModal(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </>}
      </>
    </div>
  );
}

// ── SubstAdminCard ────────────────────────────────────────────

function SubstAdminCard({
  subst, onAprovar, onRejeitar, onBuscarSubstitutos, saving,
}: {
  subst: Substituicao;
  onAprovar: () => void;
  onRejeitar: () => void;
  onBuscarSubstitutos: (escalaId: string, ministerioId: string) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(subst.status === "com_voluntario");
  const cfg = STATUS_CONFIG[subst.status] ?? STATUS_CONFIG.cancelada;
  const dateObj = new Date(subst.escala_data + "T12:00:00");
  const isUrgent = subst.status === "com_voluntario";
  const canAct = ["solicitada", "com_voluntario"].includes(subst.status);

  return (
    <div
      className={`rounded-2xl border bg-card overflow-hidden ${
        isUrgent ? "border-blue-200 dark:border-blue-800 shadow-sm" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
      >
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}
                >
                  {cfg.label}
                </span>
                {isUrgent && (
                  <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 animate-pulse">
                    ⚡ Aguarda aprovação
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold leading-snug">{subst.escala_titulo}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                {format(dateObj, "EEEE, d 'de' MMMM", { locale: ptBR })}
                {" · "}
                <span style={{ color: subst.ministerio_cor }}>{subst.ministerio_nome}</span>
              </p>
            </div>
            {expanded
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3">
          {/* Pessoas envolvidas */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground/70 mb-0.5">Solicitante</p>
              <p className="font-semibold">{subst.solicitante_nome}</p>
            </div>
            {subst.substituto_nome && (
              <div>
                <p className="text-muted-foreground/70 mb-0.5">
                  {subst.status === "aprovada" ? "Substituto confirmado" : "Voluntário"}
                </p>
                <p className="font-semibold text-blue-700 dark:text-blue-400">
                  <HandHelping className="h-3 w-3 inline mr-1" />
                  {subst.substituto_nome}
                </p>
              </div>
            )}
          </div>

          {subst.motivo_solicitacao && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
              "{subst.motivo_solicitacao}"
            </p>
          )}

          {subst.status === "aprovada" && subst.aprovador_nome && (
            <p className="text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3 inline mr-1" />
              Aprovado por {subst.aprovador_nome}
              {subst.aprovado_em && " · " + format(new Date(subst.aprovado_em), "d/MM/yyyy HH:mm")}
            </p>
          )}

          {subst.status === "rejeitada" && subst.motivo_rejeicao && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              Motivo da rejeição: {subst.motivo_rejeicao}
            </p>
          )}

          {/* Ações */}
          {canAct && (
            <div className="flex flex-wrap gap-2 pt-1">
              {subst.status === "com_voluntario" && (
                <Button
                  size="sm"
                  className="rounded-xl bg-green-600 hover:bg-green-700 text-white"
                  disabled={saving}
                  onClick={onAprovar}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Aprovar troca
                </Button>
              )}
              {subst.status === "solicitada" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={saving}
                  onClick={() => onBuscarSubstitutos(subst.escala_id, subst.ministerio_id)}
                >
                  <Users className="h-3.5 w-3.5" />
                  Buscar substituto
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={saving}
                onClick={onRejeitar}
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
}
