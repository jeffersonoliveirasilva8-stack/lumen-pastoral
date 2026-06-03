import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, Calendar, Clock, MapPin, CheckCircle2, XCircle,
  CalendarOff, History, User, ChevronDown, ChevronUp, Plus, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/membro/$token")({
  component: PortalMembroPage,
  head: () => ({ meta: [{ title: "Meu Portal — Liturgia" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type MinisterioInfo = { id: string; nome: string; cor: string };

type MembroPortal = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  score: number;
  data_ingresso: string | null;
  ministerios: MinisterioInfo[];
};

type EscalaItem = {
  escala_membro_id: string;
  status: string;
  justificativa: string | null;
  ministerio_id: string;
  escala_id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  tipo: string;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  observacoes: string | null;
  ministerio_nome: string;
  ministerio_cor: string;
};

type IndispItem = { id: string; data: string; motivo: string | null };

type HistoricoItem = {
  escala_membro_id: string;
  status: string;
  titulo: string;
  data: string;
  tipo: string;
  solene: boolean;
  ministerio_nome: string;
  ministerio_cor: string;
  presenca: string | null;
  pontos: number | null;
};

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pendente: "Aguardando confirmação",
  confirmado: "Confirmado",
  recusado: "Recusado",
  ausente: "Ausente",
};

const STATUS_COLOR: Record<string, string> = {
  pendente: "secondary",
  confirmado: "default",
  recusado: "destructive",
  ausente: "outline",
};

// ── Page ──────────────────────────────────────────────────────────────────────

function PortalMembroPage() {
  const { token } = Route.useParams();

  // ── Queries ──

  const { data: membro, isLoading: loadingMembro } = useQuery<MembroPortal | null>({
    queryKey: ["portal-membro", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_get_membro", { p_token: token });
      if (error) throw error;
      return data as MembroPortal | null;
    },
  });

  const { data: escalas = [], isLoading: loadingEscalas, refetch: refetchEscalas } = useQuery<EscalaItem[]>({
    queryKey: ["portal-escalas", token],
    enabled: !!membro,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_get_escalas_membro", { p_token: token });
      if (error) throw error;
      return (data as EscalaItem[]) ?? [];
    },
  });

  const { data: indisps = [], isLoading: loadingIndisps, refetch: refetchIndisps } = useQuery<IndispItem[]>({
    queryKey: ["portal-indisps", token],
    enabled: !!membro,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_get_indisponibilidades_membro", { p_token: token });
      if (error) throw error;
      return (data as IndispItem[]) ?? [];
    },
  });

  const { data: historico = [], isLoading: loadingHistorico } = useQuery<HistoricoItem[]>({
    queryKey: ["portal-historico", token],
    enabled: !!membro,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_get_historico_membro", { p_token: token });
      if (error) throw error;
      return (data as HistoricoItem[]) ?? [];
    },
  });

  // ── Mutations ──

  const responderMutation = useMutation({
    mutationFn: async (args: { escala_membro_id: string; status: string; justificativa?: string }) => {
      const { error } = await supabase.rpc("portal_responder_escala", {
        p_token: token,
        p_escala_membro_id: args.escala_membro_id,
        p_status: args.status,
        p_justificativa: args.justificativa ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => { refetchEscalas(); toast.success("Resposta registrada."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addIndispMutation = useMutation({
    mutationFn: async (args: { data: string; motivo?: string }) => {
      const { error } = await supabase.rpc("portal_add_indisponibilidade", {
        p_token: token,
        p_data: args.data,
        p_motivo: args.motivo ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => { refetchIndisps(); toast.success("Indisponibilidade registrada."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeIndispMutation = useMutation({
    mutationFn: async (indispId: string) => {
      const { error } = await supabase.rpc("portal_remove_indisponibilidade", {
        p_token: token,
        p_indisp_id: indispId,
      });
      if (error) throw error;
    },
    onSuccess: () => { refetchIndisps(); toast.success("Indisponibilidade removida."); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Loading / not found ──

  if (loadingMembro) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!membro) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-serif text-2xl mb-2">Link inválido</h1>
          <p className="text-sm text-muted-foreground">
            Este link não está mais ativo. Peça ao coordenador um novo link de acesso.
          </p>
        </div>
      </div>
    );
  }

  const pendentes = escalas.filter((e) => e.status === "pendente").length;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero Header ── */}
      <div className="bg-sidebar text-sidebar-foreground px-4 pt-7 pb-6">
        <div className="max-w-lg mx-auto">
          {/* Avatar + identity */}
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-sidebar-foreground/10 border border-sidebar-foreground/15 flex items-center justify-center shrink-0">
              <span className="font-serif text-2xl text-gold font-bold leading-none select-none">
                {membro.nome.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-sidebar-foreground/40 mb-0.5">
                Portal do Servidor
              </p>
              <h1 className="font-serif text-xl leading-tight">{membro.nome}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {membro.ministerios.map((m) => (
                  <span
                    key={m.id}
                    className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{ backgroundColor: m.cor + "22", borderColor: m.cor + "45", color: m.cor }}
                  >
                    {m.nome}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-sidebar-foreground/8 border border-sidebar-foreground/10 py-2.5">
              <p className="font-serif text-2xl leading-none text-sidebar-foreground">{membro.score}</p>
              <p className="text-[10px] mt-0.5 text-sidebar-foreground/40 uppercase tracking-wide">Pontos</p>
            </div>
            <div className="rounded-xl bg-sidebar-foreground/8 border border-sidebar-foreground/10 py-2.5">
              <p className="font-serif text-2xl leading-none text-sidebar-foreground">{escalas.length}</p>
              <p className="text-[10px] mt-0.5 text-sidebar-foreground/40 uppercase tracking-wide">Escalas</p>
            </div>
            <div className="rounded-xl bg-sidebar-foreground/8 border border-sidebar-foreground/10 py-2.5">
              <p className="font-serif text-2xl leading-none text-sidebar-foreground">{pendentes}</p>
              <p className="text-[10px] mt-0.5 text-sidebar-foreground/40 uppercase tracking-wide">Pendentes</p>
            </div>
          </div>

          {/* Pending alert */}
          {pendentes > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-500/15 border border-amber-400/25 px-3 py-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <p className="text-xs font-medium text-amber-300">
                {pendentes} escala{pendentes > 1 ? "s precisam" : " precisa"} de confirmação
              </p>
            </div>
          )}

          {/* Ingresso */}
          {membro.data_ingresso && (
            <p className="mt-3 text-[11px] text-sidebar-foreground/35 flex items-center gap-1.5">
              <Calendar className="h-3 w-3 opacity-60" />
              Servidor desde {format(new Date(membro.data_ingresso + "T12:00:00"), "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-lg mx-auto px-4 pt-5 pb-12">
        <Tabs defaultValue="escalas">
          <TabsList className="w-full grid grid-cols-3 h-auto p-1 rounded-xl mb-5">
            <TabsTrigger value="escalas" className="text-xs py-2 rounded-lg data-[state=active]:shadow-sm">
              Escalas
              {pendentes > 0 && (
                <span className="ml-1.5 h-4 w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                  {pendentes}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="indisponivel" className="text-xs py-2 rounded-lg data-[state=active]:shadow-sm">Indisponível</TabsTrigger>
            <TabsTrigger value="historico" className="text-xs py-2 rounded-lg data-[state=active]:shadow-sm">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Tab: Escalas ── */}
          <TabsContent value="escalas" className="space-y-3">
            {loadingEscalas ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : escalas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma escala próxima.</p>
              </div>
            ) : (
              escalas.map((esc) => (
                <EscalaCard
                  key={esc.escala_membro_id}
                  escala={esc}
                  onResponder={(status, justificativa) =>
                    responderMutation.mutate({ escala_membro_id: esc.escala_membro_id, status, justificativa })
                  }
                  saving={responderMutation.isPending}
                />
              ))
            )}
          </TabsContent>

          {/* ── Tab: Indisponível ── */}
          <TabsContent value="indisponivel">
            <IndisponibilidadeTab
              indisps={indisps}
              loading={loadingIndisps}
              onAdd={(data, motivo) => addIndispMutation.mutate({ data, motivo })}
              onRemove={(id) => removeIndispMutation.mutate(id)}
              saving={addIndispMutation.isPending}
            />
          </TabsContent>

          {/* ── Tab: Histórico ── */}
          <TabsContent value="historico">
            <HistoricoTab historico={historico} loading={loadingHistorico} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── EscalaCard ────────────────────────────────────────────────────────────────

function EscalaCard({
  escala,
  onResponder,
  saving,
}: {
  escala: EscalaItem;
  onResponder: (status: string, justificativa?: string) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [justificativa, setJustificativa] = useState("");

  const cardDate = new Date(escala.data + "T12:00:00");
  const isPendente = escala.status === "pendente";
  const isConfirmado = escala.status === "confirmado";
  const isRecusado = escala.status === "recusado";
  const hasDetails = !!(
    escala.observacoes || (escala.justificativa && isRecusado) || isConfirmado || isRecusado
  );

  return (
    <div className={`rounded-2xl border bg-card overflow-hidden transition-shadow ${
      isPendente
        ? "border-amber-300/50 shadow-md shadow-amber-50/80 dark:border-amber-600/30 dark:shadow-none"
        : "border-border"
    }`}>
      {/* Main row */}
      <div className="px-4 pt-3.5 pb-3 flex gap-3">
        {/* Date block */}
        <div className="shrink-0 w-11 text-center rounded-xl bg-muted/60 border border-border/60 py-2 px-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">
            {format(cardDate, "MMM", { locale: ptBR })}
          </p>
          <p className="text-xl font-serif leading-none mt-0.5">{format(cardDate, "d")}</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5 capitalize">
            {format(cardDate, "EEE", { locale: ptBR })}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Ministry + status chips */}
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium"
                  style={{ backgroundColor: escala.ministerio_cor + "1a", borderColor: escala.ministerio_cor + "40", color: escala.ministerio_cor }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: escala.ministerio_cor }} />
                  {escala.ministerio_nome}
                </span>
                {escala.solene && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-400">Solene</span>
                )}
                {escala.tem_adoracao && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200/60 dark:bg-purple-950/30 dark:text-purple-400">Adoração</span>
                )}
                {!isPendente && (
                  <Badge variant={STATUS_COLOR[escala.status] as any} className="text-[11px] h-4 px-1.5 py-0">
                    {STATUS_LABEL[escala.status] ?? escala.status}
                  </Badge>
                )}
              </div>
              <p className="font-semibold text-sm leading-snug">{escala.titulo}</p>
              {(escala.hora_inicio || escala.local) && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  {escala.hora_inicio && (
                    <><Clock className="h-3 w-3 shrink-0" />{escala.hora_inicio.slice(0, 5)}{escala.hora_fim && ` — ${escala.hora_fim.slice(0, 5)}`}</>
                  )}
                  {escala.hora_inicio && escala.local && <span className="opacity-30 mx-0.5">·</span>}
                  {escala.local && <><MapPin className="h-3 w-3 shrink-0" />{escala.local}</>}
                </p>
              )}
            </div>
            {hasDetails && !isPendente && (
              <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground p-0.5 shrink-0 mt-0.5">
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pending: prominent action buttons */}
      {isPendente && !recusando && (
        <div className="px-4 pb-4 pt-0.5 flex gap-2.5">
          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9 rounded-xl font-semibold"
            disabled={saving}
            onClick={() => onResponder("confirmado")}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Confirmar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 h-9 rounded-xl dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={() => setRecusando(true)}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Recusar
          </Button>
        </div>
      )}

      {isPendente && recusando && (
        <div className="px-4 pb-4 pt-0.5 space-y-2.5">
          <textarea
            className="w-full rounded-xl border border-input bg-muted/30 px-3 py-2 text-sm outline-none focus:border-ring resize-none placeholder:text-muted-foreground/50"
            placeholder="Motivo da recusa (opcional)..."
            rows={2}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-9 rounded-xl dark:border-red-900/50 dark:text-red-400"
              disabled={saving}
              onClick={() => {
                onResponder("recusado", justificativa || undefined);
                setRecusando(false);
              }}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1" />}
              Confirmar recusa
            </Button>
            <Button size="sm" variant="ghost" className="h-9 rounded-xl" onClick={() => setRecusando(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Expanded details */}
      {expanded && !isPendente && (
        <div className="border-t border-border/60 px-4 py-3.5 space-y-2.5 bg-muted/20">
          {escala.observacoes && (
            <p className="text-xs text-muted-foreground bg-card rounded-xl px-3 py-2 border border-border/50">
              {escala.observacoes}
            </p>
          )}
          {escala.justificativa && isRecusado && (
            <p className="text-xs text-muted-foreground italic">Motivo informado: {escala.justificativa}</p>
          )}
          {isConfirmado && (
            <Button size="sm" variant="outline" className="w-full h-8 text-xs text-muted-foreground rounded-xl" disabled={saving} onClick={() => onResponder("pendente")}>
              Cancelar confirmação
            </Button>
          )}
          {isRecusado && (
            <Button size="sm" variant="outline" className="w-full h-8 text-xs rounded-xl" disabled={saving} onClick={() => onResponder("pendente")}>
              Mudar resposta
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── IndisponibilidadeTab ──────────────────────────────────────────────────────

function IndisponibilidadeTab({
  indisps,
  loading,
  onAdd,
  onRemove,
  saving,
}: {
  indisps: IndispItem[];
  loading: boolean;
  onAdd: (data: string, motivo?: string) => void;
  onRemove: (id: string) => void;
  saving: boolean;
}) {
  const [newData, setNewData] = useState("");
  const [newMotivo, setNewMotivo] = useState("");

  function handleAdd() {
    if (!newData) return;
    onAdd(newData, newMotivo || undefined);
    setNewData("");
    setNewMotivo("");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Registre datas em que você não poderá servir. O sistema vai respeitá-las automaticamente ao gerar escalas.
      </p>

      {/* Add form */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Adicionar indisponibilidade
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={newData}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setNewData(e.target.value)}
            className="col-span-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <input
            placeholder="Motivo (opcional)"
            value={newMotivo}
            onChange={(e) => setNewMotivo(e.target.value)}
            className="col-span-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </div>
        <Button
          size="sm"
          disabled={!newData || saving}
          onClick={handleAdd}
          className="w-full"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Registrar
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : indisps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <CalendarOff className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma indisponibilidade registrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {indisps.map((ind) => (
            <div
              key={ind.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {format(new Date(ind.data + "T12:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}
                </p>
                {ind.motivo && (
                  <p className="text-xs text-muted-foreground mt-0.5">{ind.motivo}</p>
                )}
              </div>
              <button
                onClick={() => onRemove(ind.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── HistoricoTab ──────────────────────────────────────────────────────────────

function HistoricoTab({
  historico,
  loading,
}: {
  historico: HistoricoItem[];
  loading: boolean;
}) {
  function getHistoricoIcon(h: HistoricoItem) {
    if (h.presenca === "ausente" || h.status === "ausente")
      return <XCircle className="h-4 w-4 text-red-400" />;
    if (h.status === "recusado")
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
    if (h.presenca === "presente" || h.status === "confirmado")
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  }

  const totalPontos = historico.reduce((s, h) => s + (h.pontos ?? 0), 0);
  const servidas = historico.filter(
    (h) => (h.status === "confirmado" || h.presenca === "presente") && h.presenca !== "ausente"
  ).length;

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {historico.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-serif">{servidas}</p>
            <p className="text-xs text-muted-foreground mt-0.5">missas servidas</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-serif">{totalPontos}</p>
            <p className="text-xs text-muted-foreground mt-0.5">pontos acumulados</p>
          </div>
        </div>
      )}

      {/* List */}
      {historico.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <History className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma participação registrada ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {historico.map((h) => (
            <div
              key={h.escala_membro_id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="shrink-0">
                {getHistoricoIcon(h)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{h.titulo}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: h.ministerio_cor }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(h.data + "T12:00:00"), "d MMM yyyy", { locale: ptBR })} · {h.ministerio_nome}
                  </p>
                </div>
              </div>
              {h.pontos != null && h.pontos > 0 && (
                <span className="text-xs font-medium text-muted-foreground shrink-0">+{h.pontos}pts</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
