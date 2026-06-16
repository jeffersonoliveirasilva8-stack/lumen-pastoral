import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2, XCircle, Clock, MapPin, Users, Loader2, FileText,
  AlertCircle, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModuleTabBar } from "@/components/ui/module-tab-bar";

export const Route = createFileRoute("/_authenticated/sacristia")({
  component: SacristiaPage,
  head: () => ({ meta: [{ title: "Sacristia — Lumen Pastoral" }] }),
});

type MembroEscala = {
  id: string;
  membro_id: string;
  ministerio_id: string;
  escala_id: string;
  status: string;
  membro: { id: string; nome: string; telefone: string | null };
  ministerio: { id: string; nome: string; cor: string };
};

type EscalaItem = {
  id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string | null;
  solene: boolean;
  status: string;
};

type Tab = "pendentes" | "em_andamento" | "concluidas";

const STATUS_FINAIS = ["presente", "faltou", "atrasado", "justificou"];

function SacristiaPage() {
  const { profile, user, isAdministrador } = useAuth();
  const qc = useQueryClient();
  const hojeStr = format(new Date(), "yyyy-MM-dd");
  const [presencaMap, setPresencaMap] = useState<Record<string, "presente" | "faltou" | "atrasado" | "justificou" | "pendente">>({});
  const [savingEscalaId, setSavingEscalaId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("em_andamento");

  // Para auxiliares: descobre o membro_id do usuário logado para filtrar escalas
  const { data: meupMembroId } = useQuery<string | null>({
    queryKey: ["meu-membro-id-sacristia", profile?.paroquia_id, user?.id],
    enabled: !!profile?.paroquia_id && !!user?.id && !!isAdministrador,
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id")
        .eq("paroquia_id", profile!.paroquia_id!)
        .eq("auth_user_id", user!.id)
        .maybeSingle();
      return data?.id ?? null;
    },
  });

  // Busca escalas dos últimos 90 dias + hoje
  const desde = format(subDays(new Date(), 90), "yyyy-MM-dd");

  const { data: todasEscalas = [], isLoading } = useQuery<EscalaItem[]>({
    queryKey: ["sacristia-todas", profile?.paroquia_id, hojeStr],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, hora_fim, local, solene, status")
        .eq("paroquia_id", profile!.paroquia_id!)
        .gte("data", desde)
        .lte("data", hojeStr)
        .neq("status", "arquivada")
        .order("data", { ascending: false })
        .order("hora_inicio", { ascending: false });
      return (data ?? []) as EscalaItem[];
    },
  });

  const escalaIds = useMemo(() => todasEscalas.map((e) => e.id), [todasEscalas]);

  const { data: membrosEscala = [], isLoading: isLoadingMembros } = useQuery<MembroEscala[]>({
    queryKey: ["sacristia-membros-todos", escalaIds],
    enabled: escalaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, escala_id, status, membros(id, nome, telefone), ministerios(id, nome, cor)")
        .in("escala_id", escalaIds);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        membro: r.membros,
        ministerio: r.ministerios,
      })) as MembroEscala[];
    },
  });

  // Categoriza as escalas por estado de presença
  const { pendentes, em_andamento, concluidas } = useMemo(() => {
    const pendentes: EscalaItem[] = [];
    const em_andamento: EscalaItem[] = [];
    const concluidas: EscalaItem[] = [];

    todasEscalas.forEach((escala) => {
      const membros = membrosEscala.filter((m) => m.escala_id === escala.id);
      const isHoje = escala.data === hojeStr;

      if (membros.length === 0) {
        if (isHoje) em_andamento.push(escala);
        else pendentes.push(escala);
        return;
      }

      const finais = membros.filter((m) => STATUS_FINAIS.includes(m.status)).length;
      const total = membros.length;

      if (finais === total) {
        concluidas.push(escala);
      } else if (finais > 0 || isHoje) {
        em_andamento.push(escala);
      } else {
        pendentes.push(escala);
      }
    });

    return { pendentes, em_andamento, concluidas };
  }, [todasEscalas, membrosEscala, hojeStr]);

  const concluidasIds = useMemo(() => new Set(concluidas.map((e) => e.id)), [concluidas]);

  const historicoStats = useMemo(() => {
    const mc = membrosEscala.filter((m) => concluidasIds.has(m.escala_id));
    const presentes  = mc.filter((m) => m.status === "presente").length;
    const atrasados  = mc.filter((m) => m.status === "atrasado").length;
    const justificou = mc.filter((m) => m.status === "justificou").length;
    const faltou     = mc.filter((m) => m.status === "faltou").length;
    const total      = mc.length;
    const taxa = total > 0 ? Math.round(((presentes + atrasados + justificou) / total) * 100) : 0;
    return { presentes, atrasados, justificou, faltou, total, taxa, escalas: concluidas.length };
  }, [membrosEscala, concluidasIds, concluidas]);

  // Filtro para auxiliares
  function filtrarParaUsuario(escalas: EscalaItem[]) {
    if (!isAdministrador || !meupMembroId || membrosEscala.length === 0) return escalas;
    const minhasEscalaIds = new Set(
      membrosEscala.filter((m) => m.membro_id === meupMembroId).map((m) => m.escala_id)
    );
    return escalas.filter((e) => minhasEscalaIds.has(e.id));
  }

  const escalasExibidas = useMemo(() => {
    const lista = tab === "pendentes" ? pendentes : tab === "em_andamento" ? em_andamento : concluidas;
    return filtrarParaUsuario(lista);
  }, [tab, pendentes, em_andamento, concluidas, meupMembroId, membrosEscala, isAdministrador]);

  const salvarPresencasMutation = useMutation({
    mutationFn: async (escalaId: string) => {
      const membrosDestaEscala = membrosEscala.filter((m: any) => m.escala_id === escalaId);
      await Promise.all(
        membrosDestaEscala.map((m: MembroEscala) =>
          supabase.from("escala_membros").update({ status: presencaMap[m.id] ?? m.status }).eq("id", m.id)
        )
      );
    },
    onMutate: (escalaId) => setSavingEscalaId(escalaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sacristia-membros-todos"] });
      qc.invalidateQueries({ queryKey: ["sacristia-todas"] });
      qc.invalidateQueries({ queryKey: ["escala-membros"] });
      qc.invalidateQueries({ queryKey: ["escala-historico"] });
      qc.invalidateQueries({ queryKey: ["pm-escalas"] });
      qc.invalidateQueries({ queryKey: ["pm-todas-escalas"] });
      qc.invalidateQueries({ queryKey: ["portal-home-escalas"] });
      toast.success("Presenças salvas.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
    onSettled: () => setSavingEscalaId(null),
  });

  function togglePresenca(id: string, status: "presente" | "faltou" | "atrasado" | "justificou") {
    setPresencaMap((prev) => ({
      ...prev,
      [id]: prev[id] === status ? "pendente" : status,
    }));
  }

  // Inicializa presencaMap com o status atual do banco ao carregar a aba em_andamento
  useMemo(() => {
    const initial: Record<string, any> = {};
    membrosEscala.forEach((m) => {
      if (STATUS_FINAIS.includes(m.status) && !presencaMap[m.id]) {
        initial[m.id] = m.status;
      }
    });
    if (Object.keys(initial).length > 0) {
      setPresencaMap((prev) => ({ ...initial, ...prev }));
    }
  }, [membrosEscala]);

  const loading = isLoading || isLoadingMembros;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-2xl mx-auto pb-24">
      {/* Abas do módulo Escalas — Sacristia como central operacional */}
      <ModuleTabBar tabs={[
        { label: "Escalas",       to: "/escalas",                         isActive: false },
        { label: "Sacristia",     onClick: () => {},                      isActive: true  },
        { label: "Indisponib.",   to: "/escalas?view=indisponibilidades", isActive: false },
        { label: "Substituições", to: "/substituicoes",                   isActive: false },
      ]} />

      {/* Sub-abas da Sacristia */}
      <div className="flex gap-1 border-b border-border/60 pb-0 mb-4 -mt-2">
        {[
          { id: "pendentes" as Tab, label: `Pendentes${pendentes.length > 0 ? ` (${pendentes.length})` : ""}` },
          { id: "em_andamento" as Tab, label: "Em andamento" },
          { id: "concluidas" as Tab, label: "Concluídas" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Operacional</p>
        <h1 className="mt-2 font-serif text-2xl sm:text-4xl">Sacristia</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2 mt-4">
                {[1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : escalasExibidas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">
            {tab === "pendentes" && "Nenhuma missa aguardando conferência."}
            {tab === "em_andamento" && "Nenhuma missa em andamento."}
            {tab === "concluidas" && "Nenhuma missa concluída nos últimos 90 dias."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {tab === "concluidas" && historicoStats.escalas > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Resumo — últimos 90 dias
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{historicoStats.taxa}%</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Comparecimento</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{historicoStats.escalas}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Escalas</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{historicoStats.presentes + historicoStats.atrasados + historicoStats.justificou}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Presentes</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-500">{historicoStats.faltou}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Faltas</p>
                </div>
              </div>
            </div>
          )}
          {escalasExibidas.map((escala) => {
            const membros = membrosEscala.filter((m: any) => m.escala_id === escala.id);
            const finais = membros.filter((m: MembroEscala) => {
              const s = presencaMap[m.id] ?? m.status;
              return STATUS_FINAIS.includes(s);
            }).length;
            const isSaving = savingEscalaId === escala.id;
            const isHoje = escala.data === hojeStr;
            const d = new Date(escala.data + "T00:00:00");

            // Agrupa por ministério
            const grupos: { ministerio: { id: string; nome: string; cor: string }; membros: MembroEscala[] }[] = [];
            membros.forEach((m: MembroEscala) => {
              const g = grupos.find((x) => x.ministerio.id === m.ministerio.id);
              if (g) g.membros.push(m);
              else grupos.push({ ministerio: m.ministerio, membros: [m] });
            });

            return (
              <div key={escala.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                {/* Header da escala */}
                <div className="px-5 py-4 border-b border-border bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {isHoje && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Hoje</span>
                        )}
                        {!isHoje && (
                          <span className="text-[10px] text-muted-foreground">
                            {format(d, "dd/MM", { locale: ptBR })}
                          </span>
                        )}
                      </div>
                      <h2 className="font-semibold text-base truncate">{escala.titulo}</h2>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {escala.hora_inicio && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {escala.hora_inicio.slice(0, 5)}{escala.hora_fim ? `–${escala.hora_fim.slice(0, 5)}` : ""}
                          </span>
                        )}
                        {escala.local && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {escala.local}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {finais}/{membros.length} registrados
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {tab === "pendentes" && membros.length === 0 && (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      )}
                      {escala.solene && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                          Solene
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lista de membros */}
                <div className="p-4 space-y-4">
                  {membros.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum membro atribuído.</p>
                  ) : (
                    grupos.map((grupo) => (
                      <div key={grupo.ministerio.id}>
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
                          style={{ color: grupo.ministerio.cor }}
                        >
                          {grupo.ministerio.nome}
                        </p>
                        <div className="space-y-2">
                          {grupo.membros.map((m) => {
                            const status = presencaMap[m.id] ?? m.status;
                            const statusFinal = STATUS_FINAIS.includes(status) ? status : "pendente";
                            return (
                              <div
                                key={m.id}
                                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border transition-all ${
                                  statusFinal === "presente"
                                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                                    : statusFinal === "faltou"
                                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                                    : statusFinal === "atrasado"
                                    ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30"
                                    : statusFinal === "justificou"
                                    ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                                    : "border-border bg-background"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{m.membro.nome}</p>
                                  {m.membro.telefone && (
                                    <p className="text-[11px] text-muted-foreground">{m.membro.telefone}</p>
                                  )}
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "presente")}
                                    title="Marcar presente"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      statusFinal === "presente"
                                        ? "bg-emerald-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                                    }`}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "atrasado")}
                                    title="Marcar atrasado"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      statusFinal === "atrasado"
                                        ? "bg-orange-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-orange-100 hover:text-orange-700"
                                    }`}
                                  >
                                    <Clock className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "justificou")}
                                    title="Justificativa"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      statusFinal === "justificou"
                                        ? "bg-blue-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                                    }`}
                                  >
                                    <FileText className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => togglePresenca(m.id, "faltou")}
                                    title="Marcar falta"
                                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                                      statusFinal === "faltou"
                                        ? "bg-red-500 text-white"
                                        : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"
                                    }`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}

                  {membros.length > 0 && tab !== "concluidas" && (
                    <Button
                      className="w-full mt-2"
                      disabled={isSaving}
                      onClick={() => salvarPresencasMutation.mutate(escala.id)}
                    >
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Salvar presenças
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
