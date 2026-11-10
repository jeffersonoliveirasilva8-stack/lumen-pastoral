import React from "react";
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
  ShieldAlert, Layers, LayoutList, Ban,
  CalendarRange, BarChart3, Info, ArrowRight,
} from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation } from "@tanstack/react-query";
import type { DecisaoPresenca } from "@/biblioteca/elegibilidade-presenca";
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
  // campos v2 (migration 188) — opcionais para retrocompatibilidade
  data_ultima_escala?: string | null;
  dias_sem_servir?: number | null;
  convocacoes_12sem?: number | null;
  presencas_12sem?: number | null;
  taxa_presenca_12sem?: number | null;
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

// ── Tipos para Equidade por Período ──────────────────────────────────────────

type EquidadeMembro = {
  membro_id: string;
  nome: string;
  escalas_total: number;
  escalas_realizadas: number;
  escalas_futuras: number;
  oportunidades: number;
  taxa_aproveitamento: number | null;
  atribuicoes_extras: number;    // I3: atribuições fora das oportunidades (admin override)
  presencas: number;
  faltas: number;
  taxa_presenca: number | null;
  data_ultimo_servico: string | null;
  media_dias_intervalo: number | null;
  ministerios_periodo: { id: string; nome: string; cor: string }[];
  gini_periodo: number;
};

function useEquidadePeriodo(paroquiaId: string | undefined, inicio: string, fim: string) {
  return useQuery<EquidadeMembro[]>({
    queryKey: ["equidade-periodo", paroquiaId, inicio, fim],
    enabled: !!paroquiaId && !!inicio && !!fim,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("get_equidade_periodo", {
        p_paroquia_id: paroquiaId,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        escalas_total:       Number(r.escalas_total ?? 0),
        escalas_realizadas:  Number(r.escalas_realizadas ?? 0),
        escalas_futuras:     Number(r.escalas_futuras ?? 0),
        oportunidades:       Number(r.oportunidades ?? 0),
        taxa_aproveitamento: r.taxa_aproveitamento != null ? Number(r.taxa_aproveitamento) : null,
        atribuicoes_extras:  Number(r.atribuicoes_extras ?? 0),
        presencas:           Number(r.presencas ?? 0),
        faltas:              Number(r.faltas ?? 0),
        taxa_presenca:       r.taxa_presenca != null ? Number(r.taxa_presenca) : null,
        gini_periodo:        Number(r.gini_periodo ?? 0),
        ministerios_periodo: Array.isArray(r.ministerios_periodo) ? r.ministerios_periodo : [],
      }));
    },
  });
}

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
        // campos v2 (opcionais)
        data_ultima_escala: r.data_ultima_escala ?? null,
        dias_sem_servir: r.dias_sem_servir != null ? Number(r.dias_sem_servir) : null,
        convocacoes_12sem: r.convocacoes_12sem != null ? Number(r.convocacoes_12sem) : null,
        presencas_12sem: r.presencas_12sem != null ? Number(r.presencas_12sem) : null,
        taxa_presenca_12sem: r.taxa_presenca_12sem != null ? Number(r.taxa_presenca_12sem) : null,
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
  const [abaAtiva, setAbaAtiva] = useState<"ranking" | "equidade">("ranking");
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

  // FASE 6C: decisões ativas de elegibilidade
  const { data: decisoesPresenca = [] } = useQuery<DecisaoPresenca[]>({
    queryKey: ["elegibilidade-presenca", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("coord_get_elegibilidade_presenca", {
        p_paroquia_id: profile!.paroquia_id!,
      });
      if (error) { console.warn("[elegibilidade-presenca]", error.message); return []; }
      return (data ?? []) as DecisaoPresenca[];
    },
  });

  const suspensaoMap = useMemo(() => {
    const m = new Map<string, DecisaoPresenca>();
    for (const d of decisoesPresenca) m.set(d.membro_id, d);
    return m;
  }, [decisoesPresenca]);

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
      // Se dados v2 disponíveis: ordena por mais dias sem servir (esquecidos primeiro)
      const temV2 = lista.some((m) => m.dias_sem_servir != null);
      if (temV2) {
        lista = [...lista].sort((a, b) => {
          // Nunca serviu → prioridade máxima
          if (a.data_ultima_escala == null && b.data_ultima_escala == null) return a.nome.localeCompare(b.nome, "pt-BR");
          if (a.data_ultima_escala == null) return -1;
          if (b.data_ultima_escala == null) return 1;
          return (b.dias_sem_servir ?? 0) - (a.dias_sem_servir ?? 0);
        });
      } else {
        lista = [...lista].sort((a, b) => a.total_convocacoes - b.total_convocacoes || b.taxa_presenca - a.taxa_presenca);
      }
    } else if (ordenar === "presenca") {
      lista = [...lista].sort((a, b) => {
        if (a.total_convocacoes === 0 && b.total_convocacoes === 0) return a.nome.localeCompare(b.nome, "pt-BR");
        if (a.total_convocacoes === 0) return -1;
        if (b.total_convocacoes === 0) return 1;
        // Preferir taxa das 12 semanas quando disponível
        const taxaA = a.taxa_presenca_12sem ?? a.taxa_presenca;
        const taxaB = b.taxa_presenca_12sem ?? b.taxa_presenca;
        return taxaB - taxaA;
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

      {/* Seletor de abas */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border">
        {([
          { key: "ranking",   label: "Ranking",           icon: BarChart3 },
          { key: "equidade",  label: "Equidade por período", icon: CalendarRange },
        ] as { key: "ranking" | "equidade"; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setAbaAtiva(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
              abaAtiva === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{key === "ranking" ? "Ranking" : "Equidade"}</span>
          </button>
        ))}
      </div>

      {abaAtiva === "equidade" && profile?.paroquia_id && (
        <EquidadePeriodo paroquiaId={profile.paroquia_id} />
      )}

      {abaAtiva === "ranking" && (<>

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
                      <ParticipacaoCard key={m.id} membro={m} decisao={suspensaoMap.get(m.id)} onClick={() => setSelectedMembro(m)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtrados.map((m) => (
                <ParticipacaoCard key={m.id} membro={m} decisao={suspensaoMap.get(m.id)} onClick={() => setSelectedMembro(m)} />
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

      <HistoricoSheet
        membro={selectedMembro}
        decisao={selectedMembro ? suspensaoMap.get(selectedMembro.id) : undefined}
        onClose={() => setSelectedMembro(null)}
        onRestabelecido={() => qc.invalidateQueries({ queryKey: ["elegibilidade-presenca"] })}
      />
      </>)}
    </div>
  );
}

// ── EquidadePeriodo ───────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function EquidadePeriodo({ paroquiaId }: { paroquiaId: string }) {
  const hoje = new Date();
  const [inicio, setInicio] = useState(() => fmtDate(startOfMonth(subMonths(hoje, 1))));
  const [fim, setFim] = useState(() => fmtDate(endOfMonth(subMonths(hoje, 1))));
  // Comparativo: período anterior do mesmo tamanho
  const [compararPeriodo, setCompararPeriodo] = useState(false);

  const { data: membros = [], isLoading, error } = useEquidadePeriodo(paroquiaId, inicio, fim);

  // Período anterior para comparativo
  const inicioDt = new Date(inicio + "T12:00:00");
  const fimDt    = new Date(fim + "T12:00:00");
  const diffDias = Math.round((fimDt.getTime() - inicioDt.getTime()) / 86_400_000) + 1;
  const inicioAnt = fmtDate(new Date(inicioDt.getTime() - diffDias * 86_400_000));
  const fimAnt    = fmtDate(new Date(inicioDt.getTime() - 86_400_000));

  const { data: membrosAnt = [] } = useEquidadePeriodo(
    compararPeriodo ? paroquiaId : undefined,
    inicioAnt,
    fimAnt,
  );

  const mapaAnt = useMemo(() => {
    const m = new Map<string, EquidadeMembro>();
    for (const r of membrosAnt) m.set(r.membro_id, r);
    return m;
  }, [membrosAnt]);

  // Métricas agregadas do período
  const metricas = useMemo(() => {
    if (!membros.length) return null;
    const gini = membros[0]?.gini_periodo ?? 0;
    const semEscala = membros.filter((m) => m.escalas_total === 0).length;
    const comOport  = membros.filter((m) => m.oportunidades > 0);
    const mediaAprov = comOport.length > 0
      ? Math.round(comOport.reduce((s, m) => s + (m.taxa_aproveitamento ?? 0), 0) / comOport.length)
      : 0;
    const totalEscalas = membros.reduce((s, m) => s + m.escalas_total, 0);
    return { gini, semEscala, mediaAprov, totalEscalas, total: membros.length };
  }, [membros]);

  const giniLabel = !metricas ? "—"
    : metricas.gini <= 0.20 ? "Boa"
    : metricas.gini <= 0.35 ? "Moderada"
    : metricas.gini <= 0.50 ? "Elevada"
    : "Crítica";
  const giniColor = !metricas ? ""
    : metricas.gini <= 0.20 ? "text-emerald-600"
    : metricas.gini <= 0.35 ? "text-amber-500"
    : "text-red-500";

  return (
    <div className="space-y-4">
      {/* Seletor de período */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Período de análise</span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">De</label>
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">até</label>
            <input
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
          </div>
          <button
            onClick={() => setCompararPeriodo((v) => !v)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition ${
              compararPeriodo
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowRight className="h-3 w-3" />
            Comparar período anterior
          </button>
        </div>
        {/* Atalhos de período */}
        <div className="flex gap-1 flex-wrap">
          {[
            { label: "Mês anterior",   i: fmtDate(startOfMonth(subMonths(hoje, 1))), f: fmtDate(endOfMonth(subMonths(hoje, 1))) },
            { label: "Mês atual",      i: fmtDate(startOfMonth(hoje)),               f: fmtDate(endOfMonth(hoje)) },
            { label: "Últimos 3 meses",i: fmtDate(startOfMonth(subMonths(hoje, 2))), f: fmtDate(endOfMonth(hoje)) },
          ].map(({ label, i, f }) => (
            <button
              key={label}
              onClick={() => { setInicio(i); setFim(f); }}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                inicio === i && fim === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Indicadores do período */}
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 text-center">
          <p className="text-sm text-red-600">Erro ao carregar dados. Tente novamente.</p>
        </div>
      ) : metricas ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div className="stat-card text-center items-center gap-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <p className={`text-lg sm:text-xl font-serif font-bold leading-none ${giniColor}`}>
                {metricas.gini.toFixed(2)}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Gini ({giniLabel})</p>
            </div>
            <div className="stat-card text-center items-center gap-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className={`text-lg sm:text-xl font-serif font-bold leading-none ${metricas.semEscala > 0 ? "text-amber-500" : ""}`}>
                {metricas.semEscala}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">sem escala</p>
            </div>
            <div className="stat-card text-center items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-lg sm:text-xl font-serif font-bold leading-none">
                {metricas.mediaAprov}%
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">% aproveit.</p>
            </div>
            <div className="stat-card text-center items-center gap-1">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <p className="text-lg sm:text-xl font-serif font-bold leading-none">
                {metricas.totalEscalas}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">atribuições</p>
            </div>
          </div>

          {/* Nota sobre Gini */}
          <div className="flex items-start gap-2 rounded-xl bg-muted/40 border border-border px-3 py-2.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Gini mede desigualdade de distribuição (0 = perfeita, 1 = máxima). Calculado sobre escalas atribuídas
              — inclui membros elegíveis sem escalas no período.
            </p>
          </div>

          {/* Tabela de membros */}
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground">Servidor</th>
                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Esc.</th>
                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Oport.</th>
                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Aprov.</th>
                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Pres.</th>
                    {/* M1: título com nota de que requer ≥2 escalas */}
                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground hidden sm:table-cell" title="Intervalo médio entre serviços consecutivos no período. Exibe — quando há menos de 2 escalas.">
                      Intervalo ⓘ
                    </th>
                    {compararPeriodo && (
                      <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Δ Esc.</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {membros.map((m) => {
                    const ant = mapaAnt.get(m.membro_id);
                    // M3: ant===undefined → membro não existia no período anterior (novo/reativado)
                    //     ant===found   → existia (escalas_total pode ser 0)
                    const isNovo = compararPeriodo && ant === undefined;
                    const delta = ant != null ? m.escalas_total - ant.escalas_total : null;
                    // I3: taxa pode ultrapassar 100% quando há atribuições diretas
                    const aprovColor =
                      m.taxa_aproveitamento == null ? "text-muted-foreground"
                      : m.taxa_aproveitamento > 100  ? "text-blue-500"
                      : m.taxa_aproveitamento >= 70  ? "text-emerald-600"
                      : m.taxa_aproveitamento >= 40  ? "text-amber-500"
                      : "text-red-500";
                    const presColor =
                      m.taxa_presenca == null ? "text-muted-foreground"
                      : m.taxa_presenca >= 80 ? "text-emerald-600"
                      : m.taxa_presenca >= 60 ? "text-amber-500"
                      : "text-red-500";
                    return (
                      <tr key={m.membro_id} className="bg-card hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                              style={{ backgroundColor: m.ministerios_periodo[0]?.cor ?? "#6B7280" }}
                            >
                              {m.nome.split(" ").slice(0, 2).map((n) => n[0]).join("")}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate text-xs leading-snug">{m.nome}</p>
                              {m.escalas_futuras > 0 && (
                                <span className="text-[9px] text-blue-500">+{m.escalas_futuras} futuras</span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Escalas realizadas */}
                        <td className="px-2 py-2.5 text-center">
                          <span className={`font-semibold tabular-nums ${m.escalas_realizadas === 0 ? "text-muted-foreground" : ""}`}>
                            {m.escalas_realizadas}
                          </span>
                        </td>
                        {/* Oportunidades */}
                        <td className="px-2 py-2.5 text-center">
                          <span className="tabular-nums text-muted-foreground">{m.oportunidades}</span>
                        </td>
                        {/* Taxa aproveitamento — I3: badge quando >100% (atribuições diretas) */}
                        <td className="px-2 py-2.5 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-semibold tabular-nums ${aprovColor}`}>
                              {m.taxa_aproveitamento != null ? `${m.taxa_aproveitamento}%` : "—"}
                            </span>
                            {m.atribuicoes_extras > 0 && (
                              <span className="text-[9px] text-blue-500 leading-none" title={`${m.atribuicoes_extras} atribuição(ões) direta(s) fora das oportunidades calculadas`}>
                                +{m.atribuicoes_extras} direta{m.atribuicoes_extras > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Taxa presença */}
                        <td className="px-2 py-2.5 text-center">
                          <span className={`tabular-nums ${presColor}`}>
                            {m.taxa_presenca != null ? `${m.taxa_presenca}%` : "—"}
                          </span>
                        </td>
                        {/* Intervalo médio — M1: título explica restrição */}
                        <td className="px-2 py-2.5 text-center hidden sm:table-cell"
                            title={m.media_dias_intervalo == null ? "Requer pelo menos 2 escalas no período para calcular o intervalo médio." : undefined}>
                          <span className="text-muted-foreground tabular-nums text-xs">
                            {m.media_dias_intervalo != null ? `${m.media_dias_intervalo}d` : "—"}
                          </span>
                        </td>
                        {/* Delta comparativo — M3: badge "Novo" quando membro não existia no período anterior */}
                        {compararPeriodo && (
                          <td className="px-2 py-2.5 text-center">
                            {isNovo ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium border border-blue-500/20">
                                Novo
                              </span>
                            ) : delta == null ? (
                              <span className="text-muted-foreground text-xs">—</span>
                            ) : (
                              <span className={`text-xs font-semibold tabular-nums ${
                                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"
                              }`}>
                                {delta > 0 ? `+${delta}` : delta}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {membros.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">Nenhum dado para o período selecionado.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">Selecione um período para visualizar os indicadores.</p>
        </div>
      )}
    </div>
  );
}

// ── ParticipacaoCard ──────────────────────────────────────────────────────────

function ParticipacaoCard({ membro: m, decisao, onClick }: { membro: RankingCompleto; decisao?: DecisaoPresenca; onClick: () => void }) {
  const status = statusMembro(m);
  const taxaColor =
    m.total_convocacoes === 0 ? "text-muted-foreground"
    : m.taxa_presenca >= 80 ? "text-emerald-600"
    : m.taxa_presenca >= 60 ? "text-amber-500"
    : "text-red-500";

  const suspensoBadge = decisao?.tipo === "suspensao" ? (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 font-medium border border-orange-500/20 flex items-center gap-0.5">
      <Ban className="h-2.5 w-2.5" /> Suspenso
    </span>
  ) : null;

  const statusBadge = suspensoBadge ?? (
    status === "sem_escalas" ? (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium border border-amber-500/20">
        Sem escala
      </span>
    ) : status === "risco" ? (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium border border-red-500/20 flex items-center gap-0.5">
        <ShieldAlert className="h-2.5 w-2.5" /> Risco
      </span>
    ) : null
  );

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
          {/* pontos histórico — equidade */}
          <div>
            <p className="text-sm font-semibold tabular-nums text-primary">{m.score}</p>
            <p className="text-[9px] text-muted-foreground">pts</p>
          </div>
          {/* dias sem servir (campo v2) ou convocações totais */}
          {m.dias_sem_servir != null ? (
            <div>
              <p className={`text-sm font-semibold tabular-nums ${
                m.dias_sem_servir > 90 ? "text-red-500"
                : m.dias_sem_servir > 60 ? "text-amber-500"
                : ""
              }`}>
                {m.dias_sem_servir === 0 ? "hoje" : `${m.dias_sem_servir}d`}
              </p>
              <p className="text-[9px] text-muted-foreground">sem servir</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold tabular-nums">{m.total_convocacoes}</p>
              <p className="text-[9px] text-muted-foreground">conv.</p>
            </div>
          )}
          <div>
            <p className={`text-sm font-semibold tabular-nums ${taxaColor}`}>
              {m.total_convocacoes > 0
                ? `${m.taxa_presenca_12sem != null ? m.taxa_presenca_12sem : m.taxa_presenca}%`
                : "—"}
            </p>
            <p className="text-[9px] text-muted-foreground">
              {m.taxa_presenca_12sem != null ? "pres. 12sem" : "presença"}
            </p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition" />
        </div>
      </div>
    </button>
  );
}

// ── HistoricoSheet ──────────────────────────────────────────────────────────

function HistoricoSheet({ membro, decisao, onClose, onRestabelecido }: {
  membro: RankingCompleto | null;
  decisao?: DecisaoPresenca;
  onClose: () => void;
  onRestabelecido?: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  const restabelecerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await anyDb.rpc("coord_restabelecer_membro_presenca", {
        p_membro_id: membro!.id,
        p_motivo:    motivo.trim() || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setConfirmando(false);
      setMotivo("");
      toast.success("Membro restabelecido. Imunidade ativa por 45 dias.");
      onRestabelecido?.();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg === "apenas_coordenacao_ativa" ? "Apenas coordenadores ativos podem restabelecer membros." : `Erro ao restabelecer: ${msg}`);
    },
  });

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

          {/* FASE 6C — painel de suspensão */}
          {decisao?.tipo === "suspensao" && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 px-4 py-3 space-y-3">
              <div className="flex items-start gap-2">
                <Ban className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Suspenso por recorrência de ausências</p>
                  {decisao.motivo && (
                    <p className="text-xs text-orange-600 dark:text-orange-300 mt-0.5">{decisao.motivo}</p>
                  )}
                  <p className="text-[10px] text-orange-500/80 dark:text-orange-400/60 mt-1">
                    Suspenso em {format(new Date(decisao.criado_em), "d 'de' MMM yyyy", { locale: ptBR })}
                  </p>
                </div>
              </div>

              {confirmando ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo do restabelecimento (opcional)"
                    className="w-full rounded-lg border border-orange-300 bg-white dark:bg-orange-950 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => restabelecerMutation.mutate()}
                      disabled={restabelecerMutation.isPending}
                      className="flex-1 rounded-lg bg-orange-500 text-white text-xs font-medium py-1.5 disabled:opacity-50"
                    >
                      {restabelecerMutation.isPending ? "Restabelecendo…" : "Confirmar"}
                    </button>
                    <button
                      onClick={() => { setConfirmando(false); setMotivo(""); }}
                      className="flex-1 rounded-lg border border-orange-300 text-orange-700 dark:text-orange-300 text-xs font-medium py-1.5"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmando(true)}
                  className="w-full rounded-lg border border-orange-300 text-orange-700 dark:text-orange-300 text-xs font-medium py-1.5"
                >
                  Restabelecer membro
                </button>
              )}
            </div>
          )}

          {/* Imunidade ativa após restabelecimento */}
          {decisao?.tipo === "restabelecimento" && decisao.imune_ate && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 px-4 py-3 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Período de imunidade ativo</p>
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-0.5">
                  Protegido contra nova suspensão até{" "}
                  {format(new Date(decisao.imune_ate + "T12:00:00"), "d 'de' MMMM yyyy", { locale: ptBR })}.
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

          {/* Stats — última escala e dias sem servir (v2) */}
          {membro && membro.dias_sem_servir != null && (
            <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Última escala</p>
                <p className="text-sm font-medium mt-0.5">
                  {membro.data_ultima_escala
                    ? format(new Date(membro.data_ultima_escala + "T12:00:00"), "d 'de' MMMM yyyy", { locale: ptBR })
                    : "Nunca"}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-bold tabular-nums ${
                  membro.dias_sem_servir > 90 ? "text-red-500"
                  : membro.dias_sem_servir > 60 ? "text-amber-500"
                  : "text-foreground"
                }`}>
                  {membro.dias_sem_servir}d
                </p>
                <p className="text-[10px] text-muted-foreground">sem servir</p>
              </div>
            </div>
          )}

          {/* Stats — convocações e presença */}
          {membro && (
            <>
              {/* Últimas 12 semanas (v2) */}
              {membro.convocacoes_12sem != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Últimas 12 semanas</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: membro.convocacoes_12sem,  label: "conv.", color: "" },
                      { value: membro.presencas_12sem ?? 0,  label: "presenças", color: "text-emerald-600" },
                      { value: membro.convocacoes_12sem! > 0 ? `${membro.taxa_presenca_12sem}%` : "—", label: "presença", color: taxaColor },
                    ].map(({ value, label, color }) => (
                      <div key={label} className="rounded-xl border border-border bg-card px-2 py-2.5 text-center">
                        <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Total histórico */}
              <div>
                {membro.convocacoes_12sem != null && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Total histórico</p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: membro.total_convocacoes,  label: "conv.", color: "" },
                    { value: membro.total_presencas,    label: "presenças",   color: "text-emerald-600" },
                    { value: membro.total_convocacoes > 0 ? `${membro.taxa_presenca}%` : "—", label: "presença", color: taxaColor },
                  ].map(({ value, label, color }) => (
                    <div key={label} className="rounded-xl border border-border bg-card px-2 py-2.5 text-center">
                      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
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
