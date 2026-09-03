import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionGate } from "@/components/billing/SubscriptionGate";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { ListSkeleton } from "@/components/ui/page-skeleton";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import {
  Loader2, History, ChevronRight, Search, X,
  Users, CheckCircle2, TrendingUp, AlertTriangle,
  ShieldAlert, Layers, LayoutList,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/ranking")({
  component: () => <SubscriptionGate feature="ranking"><AvaliacaoParticipacao /></SubscriptionGate>,
  head: () => ({ meta: [{ title: "Avaliação de Participação — Painel Pastoral" }] }),
});

type MinisterioInfo = { id: string; nome: string; cor: string; categoria: string | null };

type RankingCompleto = {
  id: string;
  nome: string;
  score: number;
  total_convocacoes: number;
  total_presencas: number;
  total_faltas: number;
  taxa_presenca: number;
  ministerios: MinisterioInfo[];
};

type HistoricoItem = {
  id: string;
  pontos: number;
  tipo_evento: string;
  escala_titulo: string;
  escala_data: string;
};

const TIPO_LABELS: Record<string, string> = {
  escala: "Missa", solene: "Missa solene", bispo: "Missa com bispo",
  formacao: "Formação", reuniao: "Reunião", retiro: "Retiro",
  adoracao: "Adoração", ensaio: "Ensaio", encontro: "Encontro",
  compromisso: "Compromisso pastoral", evento: "Evento especial",
};

type Filtro = "todos" | "sem_escalas" | "risco" | "alta_fidelidade";

function useRankingCompleto(paroquiaId: string | undefined) {
  return useQuery<RankingCompleto[]>({
    queryKey: ["ranking-completo", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("get_ranking_completo", { p_paroquia_id: paroquiaId });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        score: Number(r.score ?? 0),
        total_convocacoes: Number(r.total_convocacoes ?? 0),
        total_presencas: Number(r.total_presencas ?? 0),
        total_faltas: Number(r.total_faltas ?? 0),
        taxa_presenca: Number(r.taxa_presenca ?? 0),
        ministerios: Array.isArray(r.ministerios) ? r.ministerios : [],
      }));
    },
  });
}

// Coeficiente de Gini das convocações
function calcGini(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (!sum || n === 0) return 0;
  let num = 0;
  for (let i = 0; i < n; i++) num += (2 * (i + 1) - n - 1) * sorted[i];
  return Math.round((num / (n * sum)) * 100) / 100;
}

function statusMembro(m: RankingCompleto): "sem_escalas" | "risco" | "ok" {
  if (m.total_convocacoes === 0) return "sem_escalas";
  if (m.total_convocacoes >= 5 && m.taxa_presenca < 60) return "risco";
  return "ok";
}

function AvaliacaoParticipacao() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: membros = [], isLoading } = useRankingCompleto(profile?.paroquia_id ?? undefined);
  const [selectedMembro, setSelectedMembro] = useState<RankingCompleto | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [agrupar, setAgrupar] = useState(false);
  const [ordenar, setOrdenar] = useState<"equidade" | "presenca" | "nome">("equidade");

  useEffect(() => {
    if (!profile?.paroquia_id) return;
    const channel = supabase
      .channel("admin-avaliacao-rt")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "membros", filter: `paroquia_id=eq.${profile.paroquia_id}` }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-completo"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "historico_participacoes" }, () => {
        qc.invalidateQueries({ queryKey: ["ranking-completo"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.paroquia_id, qc]);

  useSetPageTabs([]);

  // Métricas de equidade
  const metricas = useMemo(() => {
    if (!membros.length) return null;
    const comConv = membros.filter((m) => m.total_convocacoes > 0);
    const gini = calcGini(membros.map((m) => m.total_convocacoes));
    const semEscalas = membros.filter((m) => m.total_convocacoes === 0).length;
    const emRisco = membros.filter((m) => m.total_convocacoes >= 5 && m.taxa_presenca < 60).length;
    const mediaPresenca = comConv.length > 0
      ? Math.round(comConv.reduce((s, m) => s + m.taxa_presenca, 0) / comConv.length)
      : 0;
    return { gini, semEscalas, emRisco, mediaPresenca, total: membros.length };
  }, [membros]);

  // Filtragem
  const filtrados = useMemo(() => {
    let lista = membros;
    const q = busca.trim().toLowerCase();
    if (q) lista = lista.filter((m) => m.nome.toLowerCase().includes(q));
    if (filtro === "sem_escalas") lista = lista.filter((m) => m.total_convocacoes === 0);
    if (filtro === "risco") lista = lista.filter((m) => m.total_convocacoes >= 5 && m.taxa_presenca < 60);
    if (filtro === "alta_fidelidade") lista = lista.filter((m) => m.taxa_presenca === 100 && m.total_convocacoes > 0);
    // Ordenação
    if (ordenar === "equidade") {
      lista = [...lista].sort((a, b) => a.total_convocacoes - b.total_convocacoes || b.taxa_presenca - a.taxa_presenca);
    } else if (ordenar === "presenca") {
      lista = [...lista].sort((a, b) => {
        if (a.total_convocacoes === 0 && b.total_convocacoes === 0) return a.nome.localeCompare(b.nome, "pt-BR");
        if (a.total_convocacoes === 0) return -1;
        if (b.total_convocacoes === 0) return 1;
        return b.taxa_presenca - a.taxa_presenca;
      });
    } else {
      lista = [...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
    return lista;
  }, [membros, busca, filtro, ordenar]);

  // Agrupamento por categoria
  const grupos = useMemo(() => {
    if (!agrupar) return null;
    const map = new Map<string, RankingCompleto[]>();
    filtrados.forEach((m) => {
      const cat = m.ministerios.map((min) => min.categoria).filter(Boolean)[0] ?? "Sem categoria";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [filtrados, agrupar]);

  const giniLabel = metricas
    ? metricas.gini <= 0.20 ? "Boa"
      : metricas.gini <= 0.35 ? "Moderada"
      : metricas.gini <= 0.50 ? "Elevada"
      : "Crítica"
    : "—";

  const giniColor = metricas
    ? metricas.gini <= 0.20 ? "text-emerald-600"
      : metricas.gini <= 0.35 ? "text-amber-500"
      : "text-red-500"
    : "";

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Avaliação de Participação</h1>
          <p className="page-header-sub">Distribuição de convocações, presença e equidade pastoral.</p>
        </div>
      </div>

      {/* Indicadores de equidade */}
      {metricas && !isLoading && (
        <div className="grid grid-cols-4 gap-2">
          <div className="stat-card text-center items-center gap-1">
            <span className="text-muted-foreground"><Users className="h-4 w-4" /></span>
            <p className="text-lg sm:text-xl font-serif font-bold leading-none">{metricas.total}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">servidores</p>
          </div>
          <div className="stat-card text-center items-center gap-1 cursor-pointer" onClick={() => setFiltro("sem_escalas")}>
            <span className="text-muted-foreground"><CheckCircle2 className="h-4 w-4" /></span>
            <p className={`text-lg sm:text-xl font-serif font-bold leading-none ${metricas.semEscalas > 0 ? "text-amber-500" : ""}`}>{metricas.semEscalas}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">sem escala</p>
          </div>
          <div className="stat-card text-center items-center gap-1 cursor-pointer" onClick={() => setFiltro("risco")}>
            <span className="text-muted-foreground"><AlertTriangle className="h-4 w-4" /></span>
            <p className={`text-lg sm:text-xl font-serif font-bold leading-none ${metricas.emRisco > 0 ? "text-red-500" : ""}`}>{metricas.emRisco}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">em risco</p>
          </div>
          <div className="stat-card text-center items-center gap-1">
            <span className="text-muted-foreground"><TrendingUp className="h-4 w-4" /></span>
            <p className={`text-lg sm:text-xl font-serif font-bold leading-none ${giniColor}`}>{metricas.gini.toFixed(2)}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Gini ({giniLabel})</p>
          </div>
        </div>
      )}

      {/* Filtros rápidos */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { key: "todos",           label: "Todos" },
          { key: "sem_escalas",     label: "Sem escalas" },
          { key: "risco",           label: "Em risco" },
          { key: "alta_fidelidade", label: "100% presença" },
        ] as { key: Filtro; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFiltro(key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              filtro === key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Controles de busca e ordenação */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar servidor..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9 pr-9 h-9 text-sm"
          />
          {busca && (
            <button onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={ordenar}
          onChange={(e) => setOrdenar(e.target.value as typeof ordenar)}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="equidade">↑ Menos escalados</option>
          <option value="presenca">↓ Maior presença</option>
          <option value="nome">A–Z Nome</option>
        </select>
        <Button
          variant={agrupar ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={() => setAgrupar((v) => !v)}
        >
          {agrupar ? <Layers className="h-3.5 w-3.5" /> : <LayoutList className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{agrupar ? "Agrupado" : "Agrupar"}</span>
        </Button>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : membros.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Users className="h-5 w-5" /></div>
          <p className="empty-state-title">Nenhum dado</p>
          <p className="empty-state-desc">Nenhum membro com histórico de participação.</p>
        </div>
      ) : (
        <>
          {agrupar && grupos ? (
            <div className="space-y-5">
              {grupos.map(([cat, lista]) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">{cat}</p>
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-[10px] text-muted-foreground shrink-0">{lista.length}</span>
                  </div>
                  <div className="space-y-2">
                    {lista.map((m) => (
                      <ParticipacaoCard key={m.id} membro={m} onClick={() => setSelectedMembro(m)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtrados.map((m) => (
                <ParticipacaoCard key={m.id} membro={m} onClick={() => setSelectedMembro(m)} />
              ))}
              {filtrados.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {busca ? `Nenhum servidor encontrado para "${busca}".` : "Nenhum servidor neste filtro."}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <HistoricoSheet membro={selectedMembro} onClose={() => setSelectedMembro(null)} />
    </div>
  );
}

// ── ParticipacaoCard ──────────────────────────────────────────────────────────

function ParticipacaoCard({ membro: m, onClick }: { membro: RankingCompleto; onClick: () => void }) {
  const status = statusMembro(m);
  const taxaColor =
    m.total_convocacoes === 0 ? "text-muted-foreground"
    : m.taxa_presenca >= 80 ? "text-emerald-600"
    : m.taxa_presenca >= 60 ? "text-amber-500"
    : "text-red-500";

  const statusBadge =
    status === "sem_escalas" ? (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium border border-amber-500/20">
        Sem escala
      </span>
    ) : status === "risco" ? (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium border border-red-500/20 flex items-center gap-0.5">
        <ShieldAlert className="h-2.5 w-2.5" /> Risco
      </span>
    ) : null;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-left interactive-card group"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
          style={{ backgroundColor: m.ministerios[0]?.cor ?? "#6B7280" }}
        >
          {m.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("")}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium truncate">{m.nome.split(" ").slice(0, 3).join(" ")}</p>
            {statusBadge}
          </div>
          {m.ministerios.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {m.ministerios.slice(0, 2).map((min) => (
                <span
                  key={min.id}
                  className="text-[10px] px-1.5 py-px rounded-full"
                  style={{ backgroundColor: (min.cor ?? "#6B7280") + "25", color: min.cor ?? "#6B7280" }}
                >
                  {min.nome}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Métricas compactas */}
        <div className="flex items-center gap-3 shrink-0 text-right">
          <div>
            <p className="text-sm font-semibold tabular-nums">{m.total_convocacoes}</p>
            <p className="text-[9px] text-muted-foreground">conv.</p>
          </div>
          <div>
            <p className={`text-sm font-semibold tabular-nums ${taxaColor}`}>
              {m.total_convocacoes > 0 ? `${m.taxa_presenca}%` : "—"}
            </p>
            <p className="text-[9px] text-muted-foreground">presença</p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition" />
        </div>
      </div>
    </button>
  );
}

// ── HistoricoSheet ──────────────────────────────────────────────────────────

function HistoricoSheet({ membro, onClose }: { membro: RankingCompleto | null; onClose: () => void }) {
  const { data: historico = [], isLoading } = useQuery<HistoricoItem[]>({
    queryKey: ["admin-ranking-historico", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("historico_participacoes")
        .select("id, pontos, tipo_evento, presenca, descricao, data, escalas(titulo, data)")
        .eq("membro_id", membro!.id)
        .order("data", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        pontos: r.pontos ?? 0,
        tipo_evento: r.tipo_evento ?? "escala",
        escala_titulo: r.escalas?.titulo ?? r.descricao ?? "Participação",
        escala_data: r.escalas?.data ?? r.data ?? "",
      }));
    },
  });

  const status = membro ? statusMembro(membro) : null;
  const taxaColor = membro && membro.total_convocacoes > 0
    ? membro.taxa_presenca >= 80 ? "text-emerald-600"
      : membro.taxa_presenca >= 60 ? "text-amber-500"
      : "text-red-500"
    : "text-muted-foreground";

  return (
    <Sheet open={!!membro} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="truncate">{membro?.nome.split(" ").slice(0, 3).join(" ")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Alerta de status */}
          {status === "sem_escalas" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Este servidor ainda não foi convocado.</p>
            </div>
          )}
          {status === "risco" && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-400">Atenção pastoral</p>
                <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                  Muitas convocações com presença abaixo de 60%. Considere conversar antes de novas escalações.
                </p>
              </div>
            </div>
          )}

          {/* Ministérios */}
          {membro?.ministerios && membro.ministerios.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {membro.ministerios.map((min) => (
                <span
                  key={min.id}
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ backgroundColor: (min.cor ?? "#6B7280") + "25", color: min.cor ?? "#6B7280" }}
                >
                  {min.nome}
                </span>
              ))}
            </div>
          )}

          {/* Stats */}
          {membro && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: membro.total_convocacoes,  label: "convocações", color: "" },
                { value: membro.total_presencas,    label: "presenças",   color: "text-emerald-600" },
                { value: membro.total_convocacoes > 0 ? `${membro.taxa_presenca}%` : "—", label: "presença", color: taxaColor },
              ].map(({ value, label, color }) => (
                <div key={label} className="rounded-xl border border-border bg-card px-2 py-2.5 text-center">
                  <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Histórico de pontuação */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Histórico de pontuação</span>
            </div>
            {historico.length > 0 && (
              <span className="text-xs text-muted-foreground">{historico.length} registros</span>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : historico.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma pontuação registrada ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historico.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.escala_titulo}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">{TIPO_LABELS[h.tipo_evento] ?? h.tipo_evento}</span>
                      {h.escala_data && (
                        <>
                          <span className="text-xs text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {format(new Date(h.escala_data + "T12:00:00"), "d 'de' MMM yyyy", { locale: ptBR })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-semibold shrink-0 tabular-nums ${h.pontos >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {h.pontos >= 0 ? `+${h.pontos}` : h.pontos}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
