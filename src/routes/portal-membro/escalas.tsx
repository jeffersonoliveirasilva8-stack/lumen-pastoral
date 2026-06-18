import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, Calendar, MapPin, CheckCircle2, XCircle,
  CalendarOff, History, ChevronDown, ChevronUp, Plus, X,
  Shield, Users, AlertTriangle, Save, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

import { nomeExibicao } from "@/lib/nome";

export const Route = createFileRoute("/portal-membro/escalas")({
  component: PortalMembroEscalas,
  head: () => ({ meta: [{ title: "Escalas — Portal do Servidor" }] }),
});

type IndispItem = {
  id: string; data: string; motivo: string | null;
  tipo: string; hora_inicio: string | null; hora_fim: string | null;
  cancelada: boolean;
};

type HistoricoItem = {
  escala_membro_id: string;
  status: string;
  titulo: string;
  data: string;
  ministerio_nome: string;
  ministerio_cor: string;
  pontos: number | null;
  cancelada?: boolean;
};

type MembroEscalado = {
  id: string;
  membro_id: string;
  ministerio_id: string;
  ministerio_nome: string;
  ministerio_cor: string;
  ministerio_categoria: string | null;
  nome: string;
  status: string;
  justificativa: string | null;
};

type EscalaPublicada = {
  id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  solene: boolean;
  tem_adoracao: boolean;
  observacoes: string | null;
  membrosEscalados: MembroEscalado[];
};

type CoordMembro = {
  escala_membro_id: string;
  membro_id: string;
  nome: string;
  status: string;
};

type CoordEscala = {
  escala_id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  membros: CoordMembro[];
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Aguardando",
  confirmado: "Confirmado",
  recusado: "Recusado",
  ausente: "Ausente",
  presente: "Presente",
  faltou: "Faltou",
  justificou: "Justificou",
  atrasado: "Atrasado",
};

const TIPOS_OCORRENCIA = [
  { value: "atraso",                label: "Atraso" },
  { value: "ausencia",              label: "Ausência injustificada" },
  { value: "comportamento",         label: "Comportamento inadequado" },
  { value: "troca_funcao",          label: "Troca de função" },
  { value: "problema_liturgico",    label: "Problema litúrgico" },
  { value: "observacao_pastoral",   label: "Observação pastoral" },
];

// Group members by categoria → ministerio for the portal card
type GroupedCategoria = {
  categoria: string | null;
  ministerios: { ministerio_nome: string; ministerio_cor: string; membros: MembroEscalado[] }[];
};

function groupByCategoria(membros: MembroEscalado[]): GroupedCategoria[] {
  const catMap = new Map<string, Map<string, { cor: string; membros: MembroEscalado[] }>>();
  for (const m of membros) {
    const cat = m.ministerio_categoria ?? "";
    const min = m.ministerio_nome;
    if (!catMap.has(cat)) catMap.set(cat, new Map());
    const minMap = catMap.get(cat)!;
    if (!minMap.has(min)) minMap.set(min, { cor: m.ministerio_cor, membros: [] });
    minMap.get(min)!.membros.push(m);
  }
  return Array.from(catMap.entries()).map(([cat, minMap]) => ({
    categoria: cat || null,
    ministerios: Array.from(minMap.entries()).map(([nome, { cor, membros }]) => ({
      ministerio_nome: nome,
      ministerio_cor: cor,
      membros,
    })),
  }));
}

function PortalMembroEscalas() {
  const { membro, isAdministrador } = useMembroAuth();
  const qc = useQueryClient();
  const [somenteMinha, setSomenteMinha] = useState(false);

  // ── Realtime ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!membro?.id || !membro?.paroquia_id) return;

    const channel = supabase
      .channel(`pm-escalas-rt-${membro.id}`)
      // Qualquer alteração em escala_membros (qualquer membro) → atualiza lista completa
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "escala_membros",
      }, () => {
        qc.invalidateQueries({ queryKey: ["pm-todas-escalas", membro.paroquia_id] });
        qc.invalidateQueries({ queryKey: ["pm-historico", membro.id] });
        qc.invalidateQueries({ queryKey: ["portal-home-escalas", membro.id] });
      })
      // Alterações nas escalas da paróquia (status, criação, exclusão)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "escalas",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["pm-todas-escalas", membro.paroquia_id] });
        qc.invalidateQueries({ queryKey: ["pm-coord-escalas", membro.id] });
        qc.invalidateQueries({ queryKey: ["portal-home-escalas", membro.id] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [membro?.id, membro?.paroquia_id, qc]);

  // ── Regras da paróquia ────────────────────────────────────────────────
  const { data: paroquiaRegras } = useQuery<{ confirmacaoAtiva: boolean; diasAntecedencia: number }>({
    queryKey: ["pm-config-regras", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("paroquias")
        .select("regras_escala")
        .eq("id", membro!.paroquia_id)
        .maybeSingle();
      const regras = (data?.regras_escala as Record<string, unknown>) ?? {};
      return {
        confirmacaoAtiva: (regras.confirmacao_escala_ativa as boolean) ?? false,
        diasAntecedencia: (regras.dias_antecedencia_indisp as number) ?? 0,
      };
    },
  });
  const confirmacaoAtiva = paroquiaRegras?.confirmacaoAtiva ?? false;
  const diasAntecedencia = paroquiaRegras?.diasAntecedencia ?? 0;

  // ── Todas as escalas publicadas da paróquia ───────────────────────────
  const { data: todasEscalas = [], isLoading: loadingTodas } = useQuery<EscalaPublicada[]>({
    queryKey: ["pm-todas-escalas", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("escalas")
        .select(`
          id, titulo, data, hora_inicio, hora_fim, local, solene, tem_adoracao, observacoes,
          escala_membros(id, status, justificativa, membro_id, ministerio_id, membros(nome), ministerios(nome, cor, categoria))
        `)
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("status", "publicada")
        .order("data", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any): EscalaPublicada => ({
        id: row.id,
        titulo: row.titulo,
        data: row.data,
        hora_inicio: row.hora_inicio,
        hora_fim: row.hora_fim,
        local: row.local,
        solene: row.solene ?? false,
        tem_adoracao: row.tem_adoracao ?? false,
        observacoes: row.observacoes ?? null,
        membrosEscalados: (row.escala_membros ?? []).map((em: any): MembroEscalado => ({
          id: em.id,
          membro_id: em.membro_id,
          ministerio_id: em.ministerio_id ?? "",
          ministerio_nome: em.ministerios?.nome ?? "—",
          ministerio_cor: em.ministerios?.cor ?? "#6B7280",
          ministerio_categoria: em.ministerios?.categoria ?? null,
          nome: em.membros?.nome ?? "—",
          status: em.status,
          justificativa: em.justificativa ?? null,
        })),
      }));
    },
  });

  const { data: indisps = [], isLoading: loadingIndisps } = useQuery<IndispItem[]>({
    queryKey: ["pm-indisps", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("indisponibilidades")
        .select("id, data, motivo, tipo, hora_inicio, hora_fim, cancelada")
        .eq("membro_id", membro!.id)
        .eq("cancelada", false)
        .gte("data", new Date().toISOString().slice(0, 10))
        .order("data");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, data: r.data, motivo: r.motivo,
        tipo: r.tipo ?? "dia", hora_inicio: r.hora_inicio ?? null,
        hora_fim: r.hora_fim ?? null, cancelada: r.cancelada ?? false,
      }));
    },
  });

  const { data: historico = [], isLoading: loadingHistorico } = useQuery<HistoricoItem[]>({
    queryKey: ["pm-historico", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("escala_membros")
        .select(`
          id, status,
          escalas!inner(titulo, data, status),
          ministerios(nome, cor),
          historico_participacoes(pontos)
        `)
        .eq("membro_id", membro!.id)
        .eq("escalas.status", "publicada")
        .lt("escalas.data", new Date().toISOString().slice(0, 10))
        .order("escalas.data", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        escala_membro_id: row.id,
        status: row.status,
        titulo: row.escalas.titulo,
        data: row.escalas.data,
        ministerio_nome: row.ministerios?.nome ?? "—",
        ministerio_cor: row.ministerios?.cor ?? "#6B7280",
        pontos: row.historico_participacoes?.[0]?.pontos ?? null,
      }));
    },
  });

  const { data: escalasCanceladas = [] } = useQuery<HistoricoItem[]>({
    queryKey: ["pm-escalas-canceladas", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("escala_membros")
        .select(`id, status, escalas!inner(titulo, data, status), ministerios(nome, cor)`)
        .eq("membro_id", membro!.id)
        .eq("escalas.status", "cancelada")
        .order("escalas.data", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        escala_membro_id: row.id,
        status: row.status,
        titulo: row.escalas.titulo,
        data: row.escalas.data,
        ministerio_nome: row.ministerios?.nome ?? "—",
        ministerio_cor: row.ministerios?.cor ?? "#6B7280",
        pontos: null,
        cancelada: true,
      }));
    },
  });

  // ── Coordenação / Administrador ───────────────────────────────────────
  // isAdministrador vem do hook (role "auxiliar" — Nível 2).
  // Também verifica tabela coordenadores para membros designados manualmente.
  const { data: isInCoordTable = false } = useQuery<boolean>({
    queryKey: ["pm-is-coord-table", membro?.id, membro?.paroquia_id],
    enabled: !!membro?.id && !!membro?.paroquia_id && !isAdministrador,
    queryFn: async () => {
      const { data } = await anyDb
        .from("coordenadores")
        .select("id")
        .eq("membro_id", membro!.id)
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .maybeSingle();
      return !!data;
    },
  });

  const isCoordinator = isAdministrador || isInCoordTable;

  const { data: coordEscalas = [], isLoading: loadingCoord } = useQuery<CoordEscala[]>({
    queryKey: ["pm-coord-escalas", membro?.id],
    enabled: isCoordinator && !!membro?.id,
    queryFn: async () => {
      // Passo 1 — escalas em que este membro está escalado (sem filtro embedded)
      const { data: memRows, error: e1 } = await anyDb
        .from("escala_membros")
        .select("id, escala_id")
        .eq("membro_id", membro!.id);
      if (e1) throw e1;
      if (!memRows?.length) return [];

      const escalaIds: string[] = memRows.map((r: any) => r.escala_id);

      // Passo 2 — dados das escalas: publicadas, dos últimos 30 dias até futuro
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data: escalasData, error: e2 } = await anyDb
        .from("escalas")
        .select("id, titulo, data, hora_inicio")
        .in("id", escalaIds)
        .eq("status", "publicada")
        .gte("data", thirtyDaysAgo.toISOString().slice(0, 10))
        .order("data", { ascending: false });
      if (e2) throw e2;
      if (!escalasData?.length) return [];

      const escalaIdsPublicadas: string[] = escalasData.map((e: any) => e.id);

      // Passo 3 — todos os membros dessas escalas
      const { data: allRows, error: e3 } = await anyDb
        .from("escala_membros")
        .select("id, status, membro_id, escala_id, membros(id, nome)")
        .in("escala_id", escalaIdsPublicadas);
      if (e3) throw e3;

      return (escalasData ?? []).map((esc: any): CoordEscala => ({
        escala_id: esc.id,
        titulo: esc.titulo,
        data: esc.data,
        hora_inicio: esc.hora_inicio,
        membros: (allRows ?? [])
          .filter((r: any) => r.escala_id === esc.id)
          .map((r: any): CoordMembro => ({
            escala_membro_id: r.id,
            membro_id: r.membro_id,
            nome: r.membros?.nome ?? "—",
            status: r.status,
          }))
          .sort((a: CoordMembro, b: CoordMembro) => a.nome.localeCompare(b.nome, "pt-BR")),
      }));
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────
  const responderMutation = useMutation({
    mutationFn: async (args: { escala_membro_id: string; status: string; justificativa?: string }) => {
      if (args.status === "recusado") {
        // Usa RPC com SECURITY DEFINER para garantir persistência e criar substituição
        const { data, error } = await anyDb.rpc("portal_recusar_escala", {
          p_escala_membro_id: args.escala_membro_id,
          p_motivo: args.justificativa ?? "",
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error ?? "Erro ao registrar recusa");
        // Dispara notificação de e-mail em background (não bloqueia nem exibe erro para o membro)
        if (data?.substituicao_id) {
          anyDb.functions
            .invoke("notificar-substituicao", { body: { substituicao_id: data.substituicao_id } })
            .catch(() => {});
        }
      } else {
        // Confirmação e volta para pendente: direct update
        const { error } = await anyDb
          .from("escala_membros")
          .update({ status: args.status, justificativa: args.justificativa ?? null })
          .eq("id", args.escala_membro_id)
          .eq("membro_id", membro!.id);
        if (error) throw error;
      }
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas", membro!.paroquia_id] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas", membro!.id] });
      qc.invalidateQueries({ queryKey: ["pm-substituicoes", membro!.id] });
      toast.success(args.status === "recusado" ? "Recusa registrada." : "Resposta registrada.");
    },
    onError: (e: Error) => {
      const msg = e.message === "confirmacao_desativada"
        ? "A coordenação desativou o sistema de confirmação."
        : e.message === "motivo_obrigatorio"
        ? "Informe o motivo da recusa antes de confirmar."
        : e.message === "prazo_expirado"
        ? "O prazo para informar a recusa expirou."
        : e.message;
      toast.error(msg);
    },
  });

  const addIndispMutation = useMutation({
    mutationFn: async (args: { data: string; motivo: string; tipo: string; hora_inicio: string | null; hora_fim: string | null }) => {
      const { error } = await anyDb
        .from("indisponibilidades")
        .insert({
          paroquia_id: membro!.paroquia_id,
          membro_id: membro!.id,
          data: args.data,
          motivo: args.motivo || null,
          tipo: args.tipo,
          hora_inicio: args.hora_inicio || null,
          hora_fim: args.hora_fim || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-indisps", membro!.id] });
      qc.invalidateQueries({ queryKey: ["indisponibilidades", membro!.paroquia_id] });
      toast.success("Indisponibilidade registrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeIndispMutation = useMutation({
    mutationFn: async (indispId: string) => {
      const { error } = await anyDb
        .from("indisponibilidades")
        .delete()
        .eq("id", indispId)
        .eq("membro_id", membro!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-indisps", membro!.id] });
      qc.invalidateQueries({ queryKey: ["indisponibilidades", membro!.paroquia_id] });
      toast.success("Indisponibilidade removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMembroStatusMutation = useMutation({
    mutationFn: async (args: { escala_membro_id: string; status: string }) => {
      const { error } = await anyDb
        .from("escala_membros")
        .update({ status: args.status })
        .eq("id", args.escala_membro_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-coord-escalas", membro!.id] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas", membro!.paroquia_id] });
      toast.success("Presença atualizada.");
    },
    onError: (e: Error) => toast.error("Erro ao atualizar presença: " + e.message),
  });

  const addOcorrenciaMutation = useMutation({
    mutationFn: async (args: { escala_id: string; tipo: string; descricao: string }) => {
      const { error } = await anyDb
        .from("escala_ocorrencias")
        .insert({
          escala_id: args.escala_id,
          registrado_por: membro!.id,
          tipo: args.tipo,
          descricao: args.descricao,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-ocorrencias", membro!.id] });
      toast.success("Ocorrência registrada.");
    },
    onError: (e: Error) => toast.error("Erro ao registrar ocorrência: " + e.message),
  });

  const pendentes = todasEscalas.filter((esc) =>
    esc.membrosEscalados.some((m) => m.membro_id === membro?.id && m.status === "pendente")
  ).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 lg:px-6">
      <Tabs defaultValue={isCoordinator ? "coordenacao" : "escalas"}>
        <TabsList className="w-full mb-5 h-auto p-1 gap-0.5 bg-muted/60 rounded-xl overflow-x-auto flex-nowrap">
          {isCoordinator && (
            <TabsTrigger value="coordenacao" className="flex-1 min-w-[80px] rounded-lg py-1.5 text-xs sm:text-sm flex items-center gap-1 whitespace-nowrap">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Gestão</span>
              <span className="sm:hidden">Gestão</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="escalas" className="flex-1 min-w-[70px] rounded-lg py-1.5 text-xs sm:text-sm whitespace-nowrap">
            Escalas
            {pendentes > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1.5">
                {pendentes}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="indisponivel" className="flex-1 min-w-[80px] rounded-lg py-1.5 text-xs sm:text-sm whitespace-nowrap">Indisponível</TabsTrigger>
          <TabsTrigger value="historico" className="flex-1 min-w-[70px] rounded-lg py-1.5 text-xs sm:text-sm whitespace-nowrap">Histórico</TabsTrigger>
        </TabsList>

        {/* ── Tab: Coordenação ── */}
        {isCoordinator && (
          <TabsContent value="coordenacao">
            <CoordinatorTab
              coordEscalas={coordEscalas}
              loading={loadingCoord}
              membroId={membro?.id ?? ""}
              savingStatus={updateMembroStatusMutation.isPending}
              savingOcorrencia={addOcorrenciaMutation.isPending}
              onUpdateMemberStatus={(id, status) =>
                updateMembroStatusMutation.mutate({ escala_membro_id: id, status })
              }
              onAddOcorrencia={(escala_id, tipo, descricao) =>
                addOcorrenciaMutation.mutate({ escala_id, tipo, descricao })
              }
            />
          </TabsContent>
        )}

        {/* ── Tab: Escalas ── */}
        <TabsContent value="escalas" className="space-y-3">
          {/* Filtro de escalas */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setSomenteMinha(false)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition ${
                !somenteMinha
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Todas as escalas
            </button>
            <button
              type="button"
              onClick={() => setSomenteMinha(true)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition ${
                somenteMinha
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Minhas escalas
            </button>
          </div>

          {loadingTodas ? (
            <div className="space-y-2.5 mt-2">
              {[1,2,3].map(i => (
                <div key={i} className="h-24 rounded-2xl bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : todasEscalas.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Calendar className="h-5 w-5" /></div>
              <p className="empty-state-title">Nenhuma escala publicada</p>
              <p className="empty-state-desc">As escalas publicadas pela coordenação aparecerão aqui.</p>
            </div>
          ) : (() => {
            const escalasVisiveis = somenteMinha
              ? todasEscalas.filter((esc) =>
                  esc.membrosEscalados.some((m) => m.membro_id === membro?.id)
                )
              : todasEscalas;

            if (somenteMinha && escalasVisiveis.length === 0) {
              return (
                <div className="rounded-3xl border border-dashed border-border p-10 text-center">
                  <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">Você não está escalado em nenhuma escala publicada.</p>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {escalasVisiveis.map((esc) => (
                  <EscalaPortalCard
                    key={esc.id}
                    escala={esc}
                    confirmacaoAtiva={confirmacaoAtiva}
                    membroId={membro!.id}
                    isAdministrador={isCoordinator}
                    onResponder={(escala_membro_id, status, justificativa) =>
                      responderMutation.mutate({ escala_membro_id, status, justificativa })
                    }
                    onUpdateMemberStatus={(id, status) =>
                      updateMembroStatusMutation.mutate({ escala_membro_id: id, status })
                    }
                    saving={responderMutation.isPending}
                    savingStatus={updateMembroStatusMutation.isPending}
                  />
                ))}
              </div>
            );
          })()}
        </TabsContent>

        {/* ── Tab: Indisponível ── */}
        <TabsContent value="indisponivel">
          <IndisponibilidadeTab
            indisps={indisps}
            loading={loadingIndisps}
            diasAntecedencia={diasAntecedencia}
            onAdd={(data, motivo, tipo, hora_inicio, hora_fim) =>
              addIndispMutation.mutate({ data, motivo, tipo, hora_inicio, hora_fim })
            }
            onRemove={(id) => removeIndispMutation.mutate(id)}
            saving={addIndispMutation.isPending}
          />
        </TabsContent>

        {/* ── Tab: Histórico ── */}
        <TabsContent value="historico">
          <HistoricoTab historico={historico} canceladas={escalasCanceladas} loading={loadingHistorico} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── EscalaPortalCard ──────────────────────────────────────────────────

function EscalaPortalCard({
  escala, confirmacaoAtiva, membroId, isAdministrador,
  onResponder, onUpdateMemberStatus, saving, savingStatus,
}: {
  escala: EscalaPublicada;
  confirmacaoAtiva: boolean;
  membroId: string;
  isAdministrador: boolean;
  onResponder: (escala_membro_id: string, status: string, justificativa?: string) => void;
  onUpdateMemberStatus: (escala_membro_id: string, status: string) => void;
  saving: boolean;
  savingStatus: boolean;
}) {
  const [recusando, setRecusando] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [showPresenca, setShowPresenca] = useState(false);
  const [showMembros, setShowMembros] = useState(false);

  const myMembro = escala.membrosEscalados.find((m) => m.membro_id === membroId);
  const isAssigned   = !!myMembro;
  const isPendente   = myMembro?.status === "pendente";
  const isConfirmado = myMembro?.status === "confirmado";
  const isRecusado   = myMembro?.status === "recusado";

  const dateObj    = new Date(escala.data + "T12:00:00");
  const dayNum     = format(dateObj, "d");
  const monthStr   = format(dateObj, "MMM", { locale: ptBR });
  const weekdayStr = format(dateObj, "EEEE", { locale: ptBR });

  const minColor = myMembro?.ministerio_cor ?? null;
  const grouped  = groupByCategoria(escala.membrosEscalados);

  const PRESENCE_STATUSES = [
    { value: "presente",   label: "Presente",   active: "bg-green-500 text-white border-green-500",  idle: "text-green-700 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 border-green-400/30" },
    { value: "faltou",     label: "Faltou",     active: "bg-red-500 text-white border-red-500",      idle: "text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border-red-400/30" },
    { value: "atrasado",   label: "Atrasou",    active: "bg-orange-500 text-white border-orange-500",idle: "text-orange-700 dark:text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border-orange-400/30" },
    { value: "justificou", label: "Justificou", active: "bg-amber-500 text-white border-amber-500",  idle: "text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border-amber-400/30" },
  ] as const;

  function isActivePresence(s: string, current: string) {
    if (s === "presente")   return current === "presente"   || current === "confirmado";
    if (s === "faltou")     return current === "faltou"     || current === "ausente";
    if (s === "atrasado")   return current === "atrasado";
    if (s === "justificou") return current === "justificou" || current === "recusado";
    return false;
  }

  return (
    <div
      className={`rounded-2xl border bg-card overflow-hidden transition ${
        isAssigned
          ? isPendente
            ? "border-amber-300/50 dark:border-amber-600/40"
            : "border-border"
          : "border-border/40 opacity-80"
      }`}
      style={isAssigned && minColor ? { borderLeftColor: minColor, borderLeftWidth: "4px" } : {}}
    >
      {/* ── Header ── */}
      <div className="p-4">
        <div className="flex items-start gap-3">

          {/* Bolha de data */}
          <div
            className="flex flex-col items-center justify-center rounded-xl shrink-0 px-3 py-2 min-w-[52px] text-center"
            style={isAssigned && minColor
              ? { backgroundColor: minColor + "20" }
              : { backgroundColor: "hsl(var(--muted))" }}
          >
            <span
              className="text-2xl font-bold leading-none font-serif"
              style={isAssigned && minColor ? { color: minColor } : {}}
            >{dayNum}</span>
            <span
              className="text-[10px] uppercase tracking-wide capitalize mt-0.5"
              style={isAssigned && minColor ? { color: minColor } : { color: "var(--muted-foreground)" }}
            >{monthStr}</span>
          </div>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  {escala.solene && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/25 font-medium">Solene</span>
                  )}
                  {escala.tem_adoracao && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 border border-purple-500/25 font-medium">Adoração</span>
                  )}
                </div>
                <p className="font-semibold text-sm leading-snug">{escala.titulo}</p>
                <p className="text-xs text-muted-foreground capitalize mt-0.5">
                  {weekdayStr}
                  {escala.hora_inicio && ` · ${escala.hora_inicio.slice(0, 5)}`}
                  {escala.hora_fim && `–${escala.hora_fim.slice(0, 5)}`}
                </p>
                {escala.local && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />{escala.local}
                  </p>
                )}
              </div>

              {myMembro && (
                <Badge
                  variant={
                    myMembro.status === "confirmado" ? "default"
                    : myMembro.status === "recusado" ? "destructive"
                    : myMembro.status === "ausente"  ? "outline"
                    : "secondary"
                  }
                  className="text-xs whitespace-nowrap shrink-0"
                >
                  {STATUS_LABEL[myMembro.status] ?? myMembro.status}
                </Badge>
              )}
            </div>

            {/* Minha função */}
            {myMembro && (
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: myMembro.ministerio_cor }} />
                <span className="text-muted-foreground/70">Função:</span>
                <span className="font-semibold" style={{ color: myMembro.ministerio_cor }}>
                  {myMembro.ministerio_nome}
                </span>
              </div>
            )}

            {/* Rodapé: progress bar + contagem + botão de presença */}
            <div className="mt-3 space-y-2">
              {/* Progress bar de presenças confirmadas */}
              {escala.membrosEscalados.length > 0 && (() => {
                const confirmados = escala.membrosEscalados.filter(
                  (m) => m.status === "confirmado" || m.status === "presente"
                ).length;
                const total = escala.membrosEscalados.length;
                const pct = total > 0 ? confirmados / total : 0;
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct >= 1 ? "bg-green-500" : pct >= 0.5 ? "bg-amber-400" : "bg-muted-foreground/30"}`}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {confirmados}/{total}
                    </span>
                    {isAdministrador && isAssigned && (
                      <button
                        onClick={() => setShowPresenca(v => !v)}
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border transition ${
                          showPresenca
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/50"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Presenças
                        {showPresenca ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirmar / Recusar ── */}
      {myMembro && isPendente && confirmacaoAtiva && !recusando && (
        <div className="border-t border-border/40 px-4 py-3 flex gap-2">
          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl"
            disabled={saving}
            onClick={() => onResponder(myMembro.id, "confirmado")}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirmar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
            onClick={() => setRecusando(true)}
          >
            <XCircle className="h-3.5 w-3.5" />
            Recusar
          </Button>
        </div>
      )}

      {myMembro && isPendente && recusando && confirmacaoAtiva && (
        <div className="border-t border-border/40 px-4 py-3 space-y-2">
          <p className="text-xs text-muted-foreground">Informe o motivo da recusa. <span className="text-destructive">Obrigatório.</span></p>
          <textarea
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none"
            placeholder="Ex: compromisso de trabalho, viagem em família…"
            rows={2}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            autoFocus
          />
          {justificativa.trim().length > 0 && justificativa.trim().length < 10 && (
            <p className="text-[11px] text-destructive">Digite ao menos 10 caracteres.</p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
              disabled={saving || justificativa.trim().length < 10}
              onClick={() => { onResponder(myMembro.id, "recusado", justificativa.trim()); setRecusando(false); }}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar recusa
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setRecusando(false); setJustificativa(""); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {myMembro && (isConfirmado || isRecusado) && confirmacaoAtiva && (
        <div className="border-t border-border/40 px-4 py-2.5">
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-muted-foreground text-xs h-8 rounded-xl"
            disabled={saving}
            onClick={() => onResponder(myMembro.id, "pendente")}
          >
            {isConfirmado ? "Cancelar confirmação" : "Mudar resposta"}
          </Button>
        </div>
      )}

      {/* ── Lista de membros — colapsável, grid estilo admin ── */}
      {!showPresenca && escala.membrosEscalados.length > 0 && (
        <div className="border-t border-border/40">
          <button
            type="button"
            onClick={() => setShowMembros((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition"
          >
            <span className="font-medium">
              {showMembros ? "Ocultar escalados" : `Ver escalados (${escala.membrosEscalados.length})`}
            </span>
            {showMembros
              ? <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {showMembros && (
            <div className="bg-muted/20 px-4 pb-4 pt-2 space-y-3">
              {grouped.map(({ categoria, ministerios }) => (
                <div key={categoria ?? "__sem__"}>
                  {categoria && (
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">{categoria}</p>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    {ministerios.map(({ ministerio_nome, ministerio_cor, membros: ms }) => {
                      const STATUS_DOT: Record<string, string> = {
                        confirmado: "#22c55e", presente: "#22c55e",
                        pendente: "#f59e0b",
                        recusado: "#ef4444", faltou: "#ef4444", ausente: "#ef4444",
                      };
                      return (
                        <div
                          key={ministerio_nome}
                          className="rounded-xl border border-border bg-background px-2.5 py-2"
                          style={{ borderLeftColor: ministerio_cor, borderLeftWidth: "3px" }}
                        >
                          <p className="text-[11px] font-semibold truncate mb-1.5" style={{ color: ministerio_cor }}>
                            {ministerio_nome}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {ms.map((m) => {
                              const isMe = m.membro_id === membroId;
                              return (
                                <span
                                  key={m.id}
                                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                    isMe
                                      ? "bg-primary/15 text-primary border border-primary/30"
                                      : "bg-muted/60 text-foreground/70"
                                  }`}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: STATUS_DOT[m.status] ?? "#9ca3af" }}
                                  />
                                  {isMe ? "Você" : nomeExibicao(m.nome)}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Painel de presença (Admin escalado) ── */}
      {showPresenca && isAdministrador && isAssigned && (
        <div className="border-t border-border/40 bg-blue-500/5 dark:bg-blue-950/20">
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-blue-200/40 dark:border-blue-800/40">
            <Shield className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
              Gestão de escala
            </p>
          </div>

          {escala.membrosEscalados.map((m) => (
            <div key={m.id} className="px-4 py-3 border-t border-border/40 first:border-t-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {nomeExibicao(m.nome)}
                    {m.membro_id === membroId && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">(você)</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: m.ministerio_cor }} />
                    {m.ministerio_nome}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">{STATUS_LABEL[m.status] ?? m.status}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESENCE_STATUSES.map(({ value, label, active, idle }) => (
                  <button
                    key={value}
                    disabled={savingStatus}
                    onClick={() => onUpdateMemberStatus(
                      m.id,
                      isActivePresence(value, m.status) ? "pendente" : value,
                    )}
                    className={`text-xs px-2 py-2.5 rounded-xl font-semibold border transition min-h-[44px] ${
                      isActivePresence(value, m.status) ? active : idle
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {escala.observacoes && (
            <div className="px-4 py-2.5 border-t border-border/40">
              <p className="text-xs text-muted-foreground italic">{escala.observacoes}</p>
            </div>
          )}
        </div>
      )}

      {/* Observações (sem painel de presença aberto) */}
      {escala.observacoes && !showPresenca && (
        <div className="border-t border-border/40 px-4 py-2.5">
          <p className="text-xs text-muted-foreground italic">{escala.observacoes}</p>
        </div>
      )}
    </div>
  );
}

// ── CoordinatorTab ────────────────────────────────────────────────────

type CoordinatorTabProps = {
  coordEscalas: CoordEscala[];
  loading: boolean;
  membroId: string;
  savingStatus: boolean;
  savingOcorrencia: boolean;
  onUpdateMemberStatus: (escala_membro_id: string, status: string) => void;
  onAddOcorrencia: (escala_id: string, tipo: string, descricao: string) => void;
};

function CoordinatorTab({
  coordEscalas, loading, membroId,
  savingStatus, savingOcorrencia,
  onUpdateMemberStatus, onAddOcorrencia,
}: CoordinatorTabProps) {
  if (loading) {
    return (
      <div className="space-y-2.5">
        {[1,2,3].map(i => <div key={i} className="h-28 rounded-2xl bg-muted/50 animate-pulse" />)}
      </div>
    );
  }

  if (coordEscalas.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Shield className="h-5 w-5" /></div>
        <p className="empty-state-title">Nenhuma escala recente</p>
        <p className="empty-state-desc">Nenhuma escala publicada nos últimos 30 dias.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-4 py-3">
        <div className="flex items-start gap-2">
          <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Gestão de escala</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              Confirme a presença de cada membro e registre ocorrências da celebração.
            </p>
          </div>
        </div>
      </div>

      {coordEscalas.map((escala) => (
        <EscalaCoordCard
          key={escala.escala_id}
          escala={escala}
          membroId={membroId}
          savingStatus={savingStatus}
          savingOcorrencia={savingOcorrencia}
          onUpdateMemberStatus={onUpdateMemberStatus}
          onAddOcorrencia={onAddOcorrencia}
        />
      ))}
    </div>
  );
}

// ── EscalaCoordCard ───────────────────────────────────────────────────

type EscalaCoordCardProps = {
  escala: CoordEscala;
  membroId: string;
  savingStatus: boolean;
  savingOcorrencia: boolean;
  onUpdateMemberStatus: (escala_membro_id: string, status: string) => void;
  onAddOcorrencia: (escala_id: string, tipo: string, descricao: string) => void;
};

function EscalaCoordCard({
  escala, membroId, savingStatus, savingOcorrencia,
  onUpdateMemberStatus, onAddOcorrencia,
}: EscalaCoordCardProps) {
  const [showOcorrencia, setShowOcorrencia] = useState(false);
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState("atraso");
  const [ocorrenciaDescricao, setOcorrenciaDescricao] = useState("");
  const dateObj = new Date(escala.data + "T12:00:00");

  const presentes   = escala.membros.filter((m) => m.status === "presente" || m.status === "confirmado").length;
  const faltaram    = escala.membros.filter((m) => m.status === "faltou"   || m.status === "ausente").length;
  const atrasados   = escala.membros.filter((m) => m.status === "atrasado").length;
  const justificaram= escala.membros.filter((m) => m.status === "justificou" || m.status === "recusado").length;
  const pendentes   = escala.membros.filter((m) => m.status === "pendente").length;

  return (
    <div className="rounded-3xl border border-border bg-card shadow-altar overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-base leading-snug">{escala.titulo}</p>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">
            {format(dateObj, "EEEE, d 'de' MMMM", { locale: ptBR })}
            {escala.hora_inicio && ` · ${escala.hora_inicio.slice(0, 5)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 shrink-0 text-xs">
          {presentes > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 font-medium">{presentes} ✓</span>
          )}
          {faltaram > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 font-medium">{faltaram} ✗</span>
          )}
          {atrasados > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-400 font-medium">{atrasados} ⏰</span>
          )}
          {justificaram > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium">{justificaram} J</span>
          )}
          {pendentes > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{pendentes} ?</span>
          )}
        </div>
      </div>

      {/* Lista de membros */}
      <div className="border-t border-border">
        <div className="px-4 py-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{escala.membros.length} membro{escala.membros.length !== 1 ? "s" : ""} escalado{escala.membros.length !== 1 ? "s" : ""}</span>
        </div>
        {escala.membros.map((m) => (
          <div key={m.escala_membro_id} className="px-4 py-3 border-t border-border/60 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.nome}
                  {m.membro_id === membroId && (
                    <span className="ml-2 text-[10px] text-muted-foreground font-normal">(você)</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground capitalize">{STATUS_LABEL[m.status] ?? m.status}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(["presente", "faltou", "justificou", "atrasado"] as const).map((s) => {
                // Mapeia o status atual para o botão correspondente
                const isActive =
                  s === "presente"   ? m.status === "presente"   || m.status === "confirmado"
                  : s === "faltou"   ? m.status === "faltou"     || m.status === "ausente"
                  : s === "justificou" ? m.status === "justificou" || m.status === "recusado"
                  : m.status === "atrasado";

                const colors: Record<string, string> = {
                  presente:  isActive
                    ? "bg-green-500 text-white"
                    : "bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/20",
                  faltou:    s === "faltou" && isActive
                    ? "bg-red-500 text-white"
                    : "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20",
                  justificou: s === "justificou" && isActive
                    ? "bg-amber-500 text-white"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20",
                  atrasado:  s === "atrasado" && isActive
                    ? "bg-orange-500 text-white"
                    : "bg-orange-500/10 text-orange-700 dark:text-orange-400 hover:bg-orange-500/20",
                };
                const label: Record<string, string> = {
                  presente: "Presente", faltou: "Faltou",
                  justificou: "Justificou", atrasado: "Atrasado",
                };
                return (
                  <button
                    key={s}
                    disabled={savingStatus}
                    onClick={() => onUpdateMemberStatus(m.escala_membro_id, isActive ? "pendente" : s)}
                    className={`text-xs px-2 py-2.5 rounded-xl font-semibold transition min-h-[44px] ${colors[s]}`}
                  >
                    {label[s]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Registrar ocorrência */}
      <div className="border-t border-border px-4 py-3">
        <button
          onClick={() => setShowOcorrencia((v) => !v)}
          className="w-full flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition rounded-lg px-2 py-2.5 -mx-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Registrar ocorrência</span>
          {showOcorrencia ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showOcorrencia && (
          <div className="mt-3 space-y-2">
            <select
              value={ocorrenciaTipo}
              onChange={(e) => setOcorrenciaTipo(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              {TIPOS_OCORRENCIA.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <textarea
              value={ocorrenciaDescricao}
              onChange={(e) => setOcorrenciaDescricao(e.target.value)}
              placeholder="Descreva o que ocorreu…"
              rows={3}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none"
            />
            <Button
              size="sm"
              disabled={savingOcorrencia || !ocorrenciaDescricao.trim()}
              onClick={() => {
                onAddOcorrencia(escala.escala_id, ocorrenciaTipo, ocorrenciaDescricao.trim());
                setOcorrenciaDescricao("");
                setShowOcorrencia(false);
              }}
              className="w-full"
            >
              {savingOcorrencia ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Registrar ocorrência
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── IndisponibilidadeTab ──────────────────────────────────────────────

function IndisponibilidadeTab({
  indisps, loading, diasAntecedencia, onAdd, onRemove, saving,
}: {
  indisps: IndispItem[];
  loading: boolean;
  diasAntecedencia: number;
  onAdd: (data: string, motivo: string, tipo: string, hora_inicio: string | null, hora_fim: string | null) => void;
  onRemove: (id: string) => void;
  saving: boolean;
}) {
  const [newData, setNewData] = useState("");
  const [newMotivo, setNewMotivo] = useState("");
  const [newTipo, setNewTipo] = useState<"dia" | "periodo">("dia");
  const [newHoraInicio, setNewHoraInicio] = useState("");
  const [newHoraFim, setNewHoraFim] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const minDate = diasAntecedencia > 0
    ? (() => { const d = new Date(); d.setDate(d.getDate() + diasAntecedencia); return d.toISOString().slice(0, 10); })()
    : new Date().toISOString().slice(0, 10);

  const canAdd = !!newData && !!newMotivo.trim() && (newTipo === "dia" || !!newHoraInicio);

  function handleAdd() {
    if (!canAdd) return;
    if (indisps.some((i) => i.data === newData && i.tipo === "dia")) {
      toast.error("Essa data já está bloqueada.");
      return;
    }
    onAdd(
      newData,
      newMotivo.trim(),
      newTipo,
      newTipo === "periodo" ? (newHoraInicio || null) : null,
      newTipo === "periodo" ? (newHoraFim || null) : null,
    );
    setNewData("");
    setNewMotivo("");
    setNewHoraInicio("");
    setNewHoraFim("");
    setNewTipo("dia");
  }

  // Agrupa por mês (key = "2026-06")
  const byMonth: Record<string, IndispItem[]> = {};
  for (const ind of indisps) {
    const key = ind.data.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(ind);
  }

  const deleteTarget = indisps.find((i) => i.id === deleteConfirmId);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <p className="section-label mb-2">Escalas</p>
        <h2 className="page-header-title">Indisponibilidades</h2>
        <p className="page-header-sub">
          Registre as datas em que não poderá servir. O motor de escalas vai respeitá-las.
        </p>
      </div>

      {/* Regra de antecedência */}
      {diasAntecedencia > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Regra de antecedência</p>
            <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5">
              Registre com pelo menos{" "}
              <strong>{diasAntecedencia} dia{diasAntecedencia !== 1 ? "s" : ""}</strong>{" "}
              de antecedência. Datas mais próximas estão bloqueadas pelo calendário.
            </p>
          </div>
        </div>
      )}

      {/* Formulário */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nova indisponibilidade</p>

        {/* Data + Tipo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground/70">Data <span className="text-destructive">*</span></label>
            <input
              type="date"
              value={newData}
              min={minDate}
              onChange={(e) => setNewData(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground/70">Tipo</label>
            <div className="flex gap-1.5">
              {(["dia", "periodo"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewTipo(t)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    newTipo === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:border-ring"
                  }`}
                >
                  {t === "dia" ? "Dia inteiro" : "Horário"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Horário (só para tipo periodo) */}
        {newTipo === "periodo" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground/70">De <span className="text-destructive">*</span></label>
              <input
                type="time"
                value={newHoraInicio}
                onChange={(e) => setNewHoraInicio(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground/70">Até <span className="text-muted-foreground/40">(opcional)</span></label>
              <input
                type="time"
                value={newHoraFim}
                onChange={(e) => setNewHoraFim(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
              />
            </div>
          </div>
        )}

        {/* Motivo + Botão */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground/70">
              Motivo <span className="text-destructive">*</span>
            </label>
            <input
              placeholder="Ex: viagem, compromisso familiar, trabalho…"
              value={newMotivo}
              onChange={(e) => setNewMotivo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
            />
          </div>
          <Button
            size="sm"
            disabled={!canAdd || saving}
            onClick={handleAdd}
            className="h-[42px] px-4 shrink-0"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            <span className="ml-1">Registrar</span>
          </Button>
        </div>
      </div>

      {/* Lista */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarOff className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            Registradas{indisps.length > 0 ? ` (${indisps.length})` : ""}
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2].map(i => <div key={i} className="h-16 rounded-2xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : indisps.length === 0 ? (
          <div className="empty-state py-8">
            <div className="empty-state-icon"><CalendarOff className="h-5 w-5" /></div>
            <p className="empty-state-title">Nenhuma data bloqueada</p>
            <p className="empty-state-desc">
              Use o formulário acima para registrar suas indisponibilidades.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(byMonth).map(([monthKey, items]) => {
              const monthDate = new Date(monthKey + "-01T12:00:00");
              const monthLabel = format(monthDate, "MMMM 'de' yyyy", { locale: ptBR });
              return (
                <div key={monthKey}>
                  {/* Separador de mês */}
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0 capitalize">
                      {monthLabel}
                    </p>
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((ind) => {
                      const dateObj = new Date(ind.data + "T12:00:00");
                      const isToday = ind.data === new Date().toISOString().slice(0, 10);
                      return (
                        <div
                          key={ind.id}
                          className={`flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 ${
                            isToday
                              ? "border-amber-200 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-800"
                              : "border-border"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium capitalize leading-snug">
                              {format(dateObj, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {ind.tipo === "periodo" && ind.hora_inicio ? (
                                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-md">
                                  {ind.hora_inicio.slice(0, 5)}{ind.hora_fim ? ` – ${ind.hora_fim.slice(0, 5)}` : ""}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/50">Dia inteiro</span>
                              )}
                              {ind.motivo && (
                                <span className="text-xs text-muted-foreground truncate">{ind.motivo}</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(ind.id)}
                            className="shrink-0 p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                            title="Remover data"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover indisponibilidade?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${format(new Date(deleteTarget.data + "T12:00:00"), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })} será liberada para escalas novamente.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmId) {
                  onRemove(deleteConfirmId);
                  setDeleteConfirmId(null);
                }
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── HistoricoTab ──────────────────────────────────────────────────────

function HistoricoTab({ historico, canceladas, loading }: { historico: HistoricoItem[]; canceladas: HistoricoItem[]; loading: boolean }) {
  const totalPontos = historico.reduce((s, h) => s + (h.pontos ?? 0), 0);
  const servidas = historico.filter((h) => h.status === "presente" || h.status === "confirmado" || h.status === "atrasado").length;

  if (loading) {
    return (
      <div className="p-4 pb-24">
        <PageSkeleton cards={4} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
      {historico.length === 0 && canceladas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <History className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma participação registrada ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {historico.map((h) => (
            <div key={h.escala_membro_id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="shrink-0">
                {(h.status === "presente" || h.status === "confirmado") ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : h.status === "atrasado" ? (
                  <CheckCircle2 className="h-4 w-4 text-orange-400" />
                ) : (h.status === "faltou" || h.status === "ausente") ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : h.status === "justificou" ? (
                  <XCircle className="h-4 w-4 text-amber-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{h.titulo}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: h.ministerio_cor }} />
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

          {canceladas.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase text-muted-foreground pt-2 pb-1">Escalas canceladas</p>
              {canceladas.map((h) => (
                <div key={h.escala_membro_id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 opacity-70">
                  <CalendarOff className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate line-through text-muted-foreground">{h.titulo}</p>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">Cancelada</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: h.ministerio_cor }} />
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(h.data + "T12:00:00"), "d MMM yyyy", { locale: ptBR })} · {h.ministerio_nome}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
