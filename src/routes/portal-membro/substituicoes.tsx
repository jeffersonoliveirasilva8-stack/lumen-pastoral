import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, ArrowLeftRight, Calendar, CheckCircle2,
  AlertTriangle, Plus, X, ChevronDown, ChevronUp,
  HandHelping,
} from "lucide-react";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/substituicoes")({
  component: PortalMembroSubstituicoes,
  head: () => ({ meta: [{ title: "Substituições — Portal do Servidor" }] }),
});

type Substituicao = {
  id: string;
  status: string;
  motivo_solicitacao: string | null;
  motivo_rejeicao: string | null;
  created_at: string;
  updated_at: string;
  tipo: "solicitante" | "voluntario";
  escala_titulo: string;
  escala_data: string;
  ministerio_nome: string;
  ministerio_cor: string;
  solicitante_nome: string;
  substituto_nome: string | null;
};

type EscalaDisponivel = {
  escala_membro_id: string;
  escala_titulo: string;
  escala_data: string;
  ministerio_nome: string;
  ministerio_cor: string;
};

type SubstAberta = {
  id: string;
  status: string;
  motivo_solicitacao: string | null;
  created_at: string;
  escala_titulo: string;
  escala_data: string;
  ministerio_nome: string;
  ministerio_cor: string;
  solicitante_nome: string;
};


function PortalMembroSubstituicoes() {
  const { membro } = useMembroAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedEscala, setSelectedEscala] = useState("");
  const [motivo, setMotivo] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [showHistorico, setShowHistorico] = useState(false);

  const { data: confirmacaoAtiva } = useQuery<boolean>({
    queryKey: ["pm-config-substituicao", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquia_config_escalas")
        .select("substituicao_ativa")
        .eq("paroquia_id", membro!.paroquia_id)
        .maybeSingle();
      // Se não há config, assume ativa (paróquias sem config não devem bloquear voluntários)
      return (data?.substituicao_ativa as boolean) ?? true;
    },
  });

  const { data: substituicoes = [], isLoading } = useQuery<Substituicao[]>({
    queryKey: ["pm-substituicoes", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("portal_get_substituicoes_membro");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: abertasParaVoluntariar = [] } = useQuery<SubstAberta[]>({
    queryKey: ["pm-substituicoes-abertas", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("portal_get_substituicoes_abertas");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: escalasDisponiveis = [] } = useQuery<EscalaDisponivel[]>({
    queryKey: ["pm-escalas-para-subst", membro?.id],
    enabled: !!membro?.id && showForm,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("escala_membros")
        .select(`
          id,
          escalas!inner(titulo, data, status),
          ministerios(nome, cor)
        `)
        .eq("membro_id", membro!.id)
        .eq("escalas.status", "publicada")
        .gte("escalas.data", new Date().toISOString().slice(0, 10));
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((row: any) => ({
          escala_membro_id: row.id,
          escala_titulo: row.escalas?.titulo ?? "—",
          escala_data: row.escalas?.data ?? "",
          ministerio_nome: row.ministerios?.nome ?? "—",
          ministerio_cor: row.ministerios?.cor ?? "#6B7280",
        }))
        .sort((a, b) => a.escala_data.localeCompare(b.escala_data));
    },
  });

  const solicitarMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await anyDb.rpc("portal_solicitar_substituicao", {
        p_escala_membro_id: selectedEscala,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Erro ao solicitar substituição");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pm-substituicoes", membro!.id] });
      toast.success("Solicitação enviada para aprovação.");
      setShowForm(false);
      setSelectedEscala("");
      setMotivo("");
    },
    onError: (e: Error) => {
      const msg = e.message === "confirmacao_desativada"
        ? "A coordenação desativou confirmações e substituições."
        : e.message === "prazo_expirado"
        ? "Prazo encerrado: a coordenação exige mais dias de antecedência para pedir substituto."
        : e.message === "substituicao_ja_ativa"
        ? "Já existe uma solicitação ativa para esta escala."
        : e.message === "escala_passada"
        ? "Não é possível solicitar substituição para escalas passadas."
        : e.message === "motivo_obrigatorio"
        ? "Informe o motivo da solicitação."
        : e.message;
      toast.error(msg);
    },
  });

  const voluntariarMutation = useMutation({
    mutationFn: async (substituicaoId: string) => {
      const { data, error } = await anyDb.rpc("portal_voluntariar_substituicao", {
        p_substituicao_id: substituicaoId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Erro ao se voluntariar");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-substituicoes", membro!.id] });
      toast.success("Você se voluntariou! Aguardando aprovação da coordenação.");
    },
    onError: (e: Error) => {
      const msg = e.message === "confirmacao_desativada"
        ? "A coordenação desativou confirmações e substituições."
        : e.message === "proprio_solicitante"
        ? "Você não pode se voluntariar para sua própria substituição."
        : e.message === "substituicao_nao_disponivel"
        ? "Esta substituição não está mais disponível."
        : e.message;
      toast.error(msg);
    },
  });

  const cancelarMutation = useMutation({
    mutationFn: async (substituicaoId: string) => {
      const { data, error } = await anyDb.rpc("portal_cancelar_substituicao", {
        p_substituicao_id: substituicaoId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Erro ao cancelar");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-substituicoes", membro!.id] });
      toast.success("Solicitação cancelada.");
      setCancelId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativas = substituicoes.filter((s) => !["cancelada", "rejeitada"].includes(s.status));
  const historico = substituicoes.filter((s) => ["cancelada", "rejeitada", "aprovada"].includes(s.status));

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 lg:px-6 space-y-6">

      {/* Header */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Portal do Servidor</p>
        <h1 className="mt-1 font-serif text-2xl">Substituições</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Solicite ou aceite substituições em escalas publicadas.
        </p>
      </div>

      {/* Aviso quando confirmação está desativada */}
      {confirmacaoAtiva === false && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Confirmação desativada</p>
            <p className="text-xs text-amber-700 mt-0.5">
              A paróquia desativou o sistema de confirmação e substituições. Entre em contato com a coordenação se precisar de uma troca.
            </p>
          </div>
        </div>
      )}

      {/* Botão nova solicitação — oculto quando confirmação desativada */}
      {confirmacaoAtiva && (
      <Button
        onClick={() => { setShowForm((v) => !v); setSelectedEscala(""); setMotivo(""); }}
        className="w-full rounded-xl"
        variant={showForm ? "outline" : "default"}
      >
        {showForm ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
        {showForm ? "Cancelar" : "Nova solicitação"}
      </Button>
      )}

      {/* Formulário */}
      {showForm && confirmacaoAtiva && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <p className="text-sm font-semibold">Solicitar substituição</p>

          {escalasDisponiveis.length === 0 ? (
            <div className="text-center py-6">
              <Calendar className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma escala futura encontrada.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Escala <span className="text-destructive">*</span></label>
                <select
                  value={selectedEscala}
                  onChange={(e) => setSelectedEscala(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
                >
                  <option value="">Selecione a escala…</option>
                  {escalasDisponiveis.map((esc) => (
                    <option key={esc.escala_membro_id} value={esc.escala_membro_id}>
                      {esc.escala_titulo} — {format(new Date(esc.escala_data + "T12:00:00"), "d MMM", { locale: ptBR })} · {esc.ministerio_nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Motivo <span className="text-destructive">*</span></label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex: compromisso familiar, viagem, problema de saúde…"
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none"
                />
                <p className="text-[11px] text-muted-foreground">Informe o motivo para que a coordenação possa avaliar.</p>
              </div>

              <Button
                className="w-full rounded-xl"
                disabled={!selectedEscala || !motivo.trim() || solicitarMutation.isPending}
                onClick={() => solicitarMutation.mutate()}
              >
                {solicitarMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}
                Solicitar substituição
              </Button>
            </>
          )}
        </div>
      )}

      {/* Lista de ativas */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : ativas.length === 0 && !showForm ? (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center">
          <ArrowLeftRight className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma substituição ativa.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Use o botão acima para solicitar uma troca.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ativas.map((s) => (
            <SubstCard
              key={s.id}
              subst={s}
              membroId={membro?.id ?? ""}
              onCancelar={() => setCancelId(s.id)}
              onVoluntariar={() => voluntariarMutation.mutate(s.id)}
              savingVoluntariar={voluntariarMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Disponíveis para voluntariar — só quando confirmação ativa */}
      {confirmacaoAtiva && abertasParaVoluntariar.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <HandHelping className="h-4 w-4 text-violet-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Disponíveis para você ({abertasParaVoluntariar.length})
            </p>
            <div className="flex-1 h-px bg-border/50" />
          </div>
          <div className="space-y-3">
            {abertasParaVoluntariar.map((s) => (
              <SubstAbertaCard
                key={s.id}
                subst={s}
                onVoluntariar={() => voluntariarMutation.mutate(s.id)}
                saving={voluntariarMutation.isPending && voluntariarMutation.variables === s.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Histórico colapsável */}
      {historico.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistorico((v) => !v)}
            className="w-full flex items-center justify-between px-0 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            <span className="uppercase tracking-wider">Histórico ({historico.length})</span>
            {showHistorico ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showHistorico && (
            <div className="space-y-3 mt-2">
              {historico.map((s) => (
                <SubstCard
                  key={s.id}
                  subst={s}
                  membroId={membro?.id ?? ""}
                  onCancelar={() => {}}
                  onVoluntariar={() => {}}
                  savingVoluntariar={false}
                  readonly
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm cancel dialog */}
      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              A solicitação será encerrada e você continuará escalado normalmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelId && cancelarMutation.mutate(cancelId)}
            >
              {cancelarMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Cancelar solicitação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── SubstAbertaCard ───────────────────────────────────────────
// Card para substituições abertas de outros membros que o usuário pode assumir

function SubstAbertaCard({
  subst, onVoluntariar, saving,
}: {
  subst: SubstAberta;
  onVoluntariar: () => void;
  saving: boolean;
}) {
  const dateObj = new Date(subst.escala_data + "T12:00:00");

  return (
    <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-card overflow-hidden">
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: subst.ministerio_cor }} />
          <span className="text-xs font-semibold" style={{ color: subst.ministerio_cor }}>
            {subst.ministerio_nome}
          </span>
        </div>
        <p className="text-sm font-semibold leading-snug">{subst.escala_titulo}</p>
        <p className="text-xs text-muted-foreground capitalize">
          {format(dateObj, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </p>
        <p className="text-xs text-muted-foreground">
          Solicitante: <span className="font-medium text-foreground">{subst.solicitante_nome}</span>
        </p>
      </div>
      <div className="border-t border-border/40 px-4 py-3">
        <Button
          size="sm"
          className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
          disabled={saving}
          onClick={onVoluntariar}
        >
          {saving
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            : <HandHelping className="h-3.5 w-3.5 mr-1.5" />}
          Me voluntariar para substituir
        </Button>
      </div>
    </div>
  );
}

// ── SubstCard ─────────────────────────────────────────────────

function SubstCard({
  subst, membroId, onCancelar, onVoluntariar, savingVoluntariar, readonly = false,
}: {
  subst: Substituicao;
  membroId: string;
  onCancelar: () => void;
  onVoluntariar: () => void;
  savingVoluntariar: boolean;
  readonly?: boolean;
}) {
  const dateObj = new Date(subst.escala_data + "T12:00:00");
  const isSolicitante = subst.tipo === "solicitante";
  const canCancel = isSolicitante && ["solicitada", "com_voluntario"].includes(subst.status) && !readonly;
  const canVoluntariar = !isSolicitante && subst.status === "solicitada" && !readonly;

  return (
    <div
      className={`rounded-2xl border bg-card overflow-hidden ${
        subst.status === "aprovada" ? "border-green-200 dark:border-green-800" :
        subst.status === "rejeitada" ? "border-red-200 dark:border-red-800" :
        subst.status === "com_voluntario" ? "border-blue-200 dark:border-blue-800" :
        "border-border"
      }`}
    >
      <div className="p-4 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: subst.ministerio_cor }}
              />
              <span className="text-xs font-semibold" style={{ color: subst.ministerio_cor }}>
                {subst.ministerio_nome}
              </span>
              <span className="text-xs text-muted-foreground/50">·</span>
              <span className="text-xs text-muted-foreground">
                {isSolicitante ? "Você solicitou" : "Solicitado por " + subst.solicitante_nome}
              </span>
            </div>
            <p className="text-sm font-semibold leading-snug">{subst.escala_titulo}</p>
            <p className="text-xs text-muted-foreground capitalize mt-0.5">
              {format(dateObj, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
          <StatusBadge status={subst.status} type="substituicao" showDot />
        </div>

        {/* Detalhes */}

        {subst.status === "com_voluntario" && subst.substituto_nome && (
          <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-500/10 rounded-lg px-3 py-2">
            <HandHelping className="h-3.5 w-3.5 shrink-0" />
            <span><strong>{subst.substituto_nome}</strong> se voluntariou · aguardando aprovação</span>
          </div>
        )}

        {subst.status === "aprovada" && subst.substituto_nome && isSolicitante && (
          <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span><strong>{subst.substituto_nome}</strong> irá no seu lugar</span>
          </div>
        )}

        {subst.status === "rejeitada" && subst.motivo_rejeicao && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            Motivo: {subst.motivo_rejeicao}
          </p>
        )}
      </div>

      {/* Ações */}
      {(canCancel || canVoluntariar) && (
        <div className="border-t border-border/40 px-4 py-3 flex gap-2">
          {canVoluntariar && (
            <Button
              size="sm"
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              disabled={savingVoluntariar}
              onClick={onVoluntariar}
            >
              {savingVoluntariar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandHelping className="h-3.5 w-3.5" />}
              Quero substituir
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={onCancelar}
            >
              <X className="h-3.5 w-3.5" />
              Cancelar pedido
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
