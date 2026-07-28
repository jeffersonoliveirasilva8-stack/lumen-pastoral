import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, subDays, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, Download, Users, CheckCircle2, AlertCircle, Clock,
  TrendingUp, TrendingDown, Minus, Search, Filter, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useSetPageTabs } from "@/contexts/page-tabs";

const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/relatorios-membros")({
  component: RelatoriosMembrosPage,
  head: () => ({ meta: [{ title: "Participação de Membros — Lumen Pastoral" }] }),
});

const PERIODOS = [
  { label: "30 dias",  dias: 30  },
  { label: "60 dias",  dias: 60  },
  { label: "90 dias",  dias: 90  },
  { label: "180 dias", dias: 180 },
  { label: "1 ano",    dias: 365 },
];

type MembroStat = {
  id: string;
  nome: string;
  score: number;
  ministerios: string[];           // nomes dos ministérios vinculados
  convocados: number;              // escalas onde foi atribuído
  presentes: number;               // presente + atrasado
  faltas: number;                  // faltou + ausente
  justificou: number;
  pendentes: number;
  taxaPresenca: number;            // presentes / (convocados - pendentes)
  diasSemServir: number | null;    // dias desde último presente/atrasado
  tendencia: "alta" | "estavel" | "queda" | null;
  risco: boolean;                  // taxa < 60% e faltas >= 2
  inativo: boolean;                // 0 participações no período
};

function pct(num: number, den: number) {
  if (den === 0) return 0;
  return Math.round((num / den) * 100);
}

function exportCSV(membros: MembroStat[], periodo: string) {
  const header = [
    "Nome", "Ministérios", "Convocados", "Presentes", "Faltas", "Justificou", "Pendentes",
    "Taxa de presença %", "Dias sem servir", "Score", "Tendência", "Risco",
  ];
  const rows = membros.map((m) => [
    m.nome,
    m.ministerios.join(" | "),
    m.convocados,
    m.presentes,
    m.faltas,
    m.justificou,
    m.pendentes,
    m.taxaPresenca,
    m.diasSemServir ?? "—",
    m.score,
    m.tendencia === "alta" ? "Melhorando" : m.tendencia === "queda" ? "Piorando" : "Estável",
    m.risco ? "Sim" : "Não",
  ]);
  const csv = [header, ...rows].map((r) => r.map(String).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `participacao-membros-${periodo}-${format(new Date(), "yyyyMMdd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function TendenciaIcon({ t }: { t: MembroStat["tendencia"] }) {
  if (t === "alta")   return <TrendingUp   className="h-3.5 w-3.5 text-emerald-600" />;
  if (t === "queda")  return <TrendingDown  className="h-3.5 w-3.5 text-red-500"     />;
  if (t === "estavel") return <Minus        className="h-3.5 w-3.5 text-muted-foreground" />;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function BarraPresenca({ taxa }: { taxa: number }) {
  const cor = taxa >= 80 ? "bg-emerald-500" : taxa >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${taxa}%` }} />
      </div>
      <span className={`text-xs font-semibold ${taxa >= 80 ? "text-emerald-600" : taxa >= 60 ? "text-amber-600" : "text-red-500"}`}>
        {taxa}%
      </span>
    </div>
  );
}

function RelatoriosMembrosPage() {
  const { profile } = useAuth();
  const [periodoDias, setPeriodoDias] = useState(90);
  const [busca, setBusca] = useState("");
  const [filtroMin, setFiltroMin] = useState<string>("todos");
  const [filtroRisco, setFiltroRisco] = useState(false);
  const [filtroInativos, setFiltroInativos] = useState(false);
  const [ordenar, setOrdenar] = useState<"nome" | "taxa" | "faltas" | "dias" | "convocados">("taxa");
  const [asc, setAsc] = useState(true);

  useSetPageTabs([
    { label: "Equilíbrio", to: "/relatorios-equilibrio", isActive: false },
    { label: "Escalas",    to: "/relatorios-escalas",    isActive: false },
    { label: "Membros",    to: "/relatorios-membros",    isActive: true  },
  ]);

  const hoje = format(new Date(), "yyyy-MM-dd");
  const desde = format(subDays(new Date(), periodoDias), "yyyy-MM-dd");
  const metade = format(subDays(new Date(), Math.floor(periodoDias / 2)), "yyyy-MM-dd");

  // ── Membros ativos ────────────────────────────────────────────────────────
  const { data: membrosRaw = [], isLoading: loadingMembros } = useQuery({
    queryKey: ["rel-membros-lista", profile?.paroquia_id],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id, nome, score, membro_ministerios(ministerios(id, nome))")
        .eq("paroquia_id", profile!.paroquia_id)
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as any[];
    },
  });

  // ── Histórico do período ──────────────────────────────────────────────────
  const { data: historico = [], isLoading: loadingHist } = useQuery({
    queryKey: ["rel-membros-hist", profile?.paroquia_id, desde],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("historico_participacoes")
        .select("membro_id, presenca, data, ministerio_id")
        .eq("paroquia_id", profile!.paroquia_id)
        .eq("origem", "escala")
        .gte("data", desde)
        .lte("data", hoje);
      return (data ?? []) as { membro_id: string; presenca: string; data: string; ministerio_id: string | null }[];
    },
    staleTime: 2 * 60 * 1000,
  });

  // ── Lista de ministérios únicos (para filtro) ─────────────────────────────
  const ministeriosLista = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membrosRaw) {
      for (const mm of (m.membro_ministerios ?? [])) {
        const min = mm.ministerios;
        if (min) map.set(min.id, min.nome);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [membrosRaw]);

  const isLoading = loadingMembros || loadingHist;

  // ── Computa stats por membro ──────────────────────────────────────────────
  const stats: MembroStat[] = useMemo(() => {
    return membrosRaw.map((m: any) => {
      const ministerios = (m.membro_ministerios ?? [])
        .map((mm: any) => mm.ministerios?.nome)
        .filter(Boolean) as string[];

      const hist = historico.filter((h) => h.membro_id === m.id);
      const histPrimeira = hist.filter((h) => h.data < metade);
      const histSegunda  = hist.filter((h) => h.data >= metade);

      const presentes  = hist.filter((h) => h.presenca === "presente" || h.presenca === "atrasado").length;
      const faltas     = hist.filter((h) => h.presenca === "faltou" || h.presenca === "ausente").length;
      const justificou = hist.filter((h) => h.presenca === "justificou").length;
      const pendentes  = hist.filter((h) => h.presenca === "pendente").length;
      const convocados = hist.length;

      const efetivos   = convocados - pendentes;
      const taxaPresenca = pct(presentes, efetivos);

      // Dias sem servir — última data com presença real
      const ultimaPresenca = hist
        .filter((h) => h.presenca === "presente" || h.presenca === "atrasado")
        .sort((a, b) => b.data.localeCompare(a.data))[0];
      const diasSemServir = ultimaPresenca
        ? differenceInDays(new Date(), new Date(ultimaPresenca.data + "T12:00:00"))
        : null;

      // Tendência: compara taxa da primeira vs segunda metade do período
      let tendencia: MembroStat["tendencia"] = null;
      if (hist.length >= 4) {
        const calcTaxa = (h: typeof hist) => {
          const ef = h.filter((x) => x.presenca !== "pendente").length;
          const pr = h.filter((x) => x.presenca === "presente" || x.presenca === "atrasado").length;
          return ef === 0 ? 0 : pr / ef;
        };
        const t1 = calcTaxa(histPrimeira);
        const t2 = calcTaxa(histSegunda);
        const delta = t2 - t1;
        tendencia = delta > 0.1 ? "alta" : delta < -0.1 ? "queda" : "estavel";
      }

      const risco   = efetivos >= 2 && taxaPresenca < 60;
      const inativo = presentes === 0 && convocados === 0;

      return {
        id: m.id, nome: m.nome, score: m.score ?? 0, ministerios,
        convocados, presentes, faltas, justificou, pendentes, taxaPresenca,
        diasSemServir, tendencia, risco, inativo,
      };
    });
  }, [membrosRaw, historico, metade]);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    let list = stats;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      list = list.filter((m) => m.nome.toLowerCase().includes(q) || m.ministerios.some((mn) => mn.toLowerCase().includes(q)));
    }
    if (filtroMin !== "todos") {
      list = list.filter((m) => {
        const mb = membrosRaw.find((r: any) => r.id === m.id);
        return (mb?.membro_ministerios ?? []).some((mm: any) => mm.ministerios?.id === filtroMin);
      });
    }
    if (filtroRisco)   list = list.filter((m) => m.risco);
    if (filtroInativos) list = list.filter((m) => m.inativo || m.presentes === 0);
    return list;
  }, [stats, busca, filtroMin, filtroRisco, filtroInativos, membrosRaw]);

  // ── Ordenação ─────────────────────────────────────────────────────────────
  const ordenados = useMemo(() => {
    return [...filtrados].sort((a, b) => {
      let v = 0;
      if (ordenar === "nome")       v = a.nome.localeCompare(b.nome);
      else if (ordenar === "taxa")       v = a.taxaPresenca - b.taxaPresenca;
      else if (ordenar === "faltas")     v = a.faltas - b.faltas;
      else if (ordenar === "dias")       v = (a.diasSemServir ?? 9999) - (b.diasSemServir ?? 9999);
      else if (ordenar === "convocados") v = a.convocados - b.convocados;
      return asc ? v : -v;
    });
  }, [filtrados, ordenar, asc]);

  function toggleOrdem(col: typeof ordenar) {
    if (ordenar === col) setAsc(!asc);
    else { setOrdenar(col); setAsc(col === "nome" ? true : false); }
  }

  // ── KPIs globais ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const comHistorico = stats.filter((m) => m.convocados > 0);
    const emRisco = stats.filter((m) => m.risco).length;
    const semServir = stats.filter((m) => m.presentes === 0 && m.convocados > 0).length;
    const taxaMedia = comHistorico.length > 0
      ? Math.round(comHistorico.reduce((s, m) => s + m.taxaPresenca, 0) / comHistorico.length)
      : 0;
    const totalFaltas = stats.reduce((s, m) => s + m.faltas, 0);
    return { emRisco, semServir, taxaMedia, totalFaltas, comHistorico: comHistorico.length };
  }, [stats]);

  const periodoLabel = PERIODOS.find((p) => p.dias === periodoDias)?.label ?? `${periodoDias}d`;

  return (
    <div className="space-y-5 pb-10">

      {/* ── Filtros de período ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setPeriodoDias(p.dias)}
              className={`px-3 py-1.5 font-medium transition-colors ${periodoDias === p.dias ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => exportCSV(ordenados, periodoLabel)}
          disabled={ordenados.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Exportar CSV
        </button>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-blue-50 dark:bg-blue-950/30 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-blue-600" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Com histórico</p>
          </div>
          <p className="text-2xl font-bold text-blue-600">{kpis.comHistorico}</p>
          <p className="text-[10px] text-muted-foreground">de {stats.length} membros ativos</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Taxa média</p>
          </div>
          <p className={`text-2xl font-bold ${kpis.taxaMedia >= 80 ? "text-emerald-600" : kpis.taxaMedia >= 60 ? "text-amber-600" : "text-red-500"}`}>
            {isLoading ? "…" : `${kpis.taxaMedia}%`}
          </p>
          <p className="text-[10px] text-muted-foreground">presença no período</p>
        </div>
        <div className="rounded-xl border border-border bg-red-50 dark:bg-red-950/30 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Em risco</p>
          </div>
          <p className="text-2xl font-bold text-red-500">{isLoading ? "…" : kpis.emRisco}</p>
          <p className="text-[10px] text-muted-foreground">taxa &lt; 60% com ≥2 chamadas</p>
        </div>
        <div className="rounded-xl border border-border bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sem presença</p>
          </div>
          <p className="text-2xl font-bold text-amber-600">{isLoading ? "…" : kpis.semServir}</p>
          <p className="text-[10px] text-muted-foreground">convocados mas nunca presentes</p>
        </div>
      </div>

      {/* ── Busca + filtros rápidos ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar membro ou ministério…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-ring"
          />
        </div>
        {ministeriosLista.length > 0 && (
          <select
            value={filtroMin}
            onChange={(e) => setFiltroMin(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          >
            <option value="todos">Todos os ministérios</option>
            {ministeriosLista.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { setFiltroRisco(!filtroRisco); setFiltroInativos(false); }}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${filtroRisco ? "bg-red-500 text-white border-red-500" : "border-border hover:bg-muted"}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Em risco
        </button>
        <button
          onClick={() => { setFiltroInativos(!filtroInativos); setFiltroRisco(false); }}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${filtroInativos ? "bg-amber-500 text-white border-amber-500" : "border-border hover:bg-muted"}`}
        >
          <Clock className="h-3.5 w-3.5" /> Sem presença
        </button>
      </div>

      {/* ── Tabela ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando participações…
        </div>
      ) : ordenados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Filter className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum membro encontrado com os filtros atuais.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <Th onClick={() => toggleOrdem("nome")} sorted={ordenar === "nome"} asc={asc}>Membro</Th>
                <th className="text-left px-3 py-2.5 font-semibold">Ministérios</th>
                <Th onClick={() => toggleOrdem("convocados")} sorted={ordenar === "convocados"} asc={asc} center>Convocado</Th>
                <th className="text-center px-3 py-2.5 font-semibold">Presente</th>
                <Th onClick={() => toggleOrdem("faltas")} sorted={ordenar === "faltas"} asc={asc} center>Faltou</Th>
                <th className="text-center px-3 py-2.5 font-semibold hidden sm:table-cell">Justificou</th>
                <Th onClick={() => toggleOrdem("taxa")} sorted={ordenar === "taxa"} asc={asc} center>Taxa</Th>
                <Th onClick={() => toggleOrdem("dias")} sorted={ordenar === "dias"} asc={asc} center>Sem servir</Th>
                <th className="text-center px-3 py-2.5 font-semibold hidden md:table-cell">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((m, i) => (
                <tr
                  key={m.id}
                  className={`border-b border-border last:border-0 transition-colors ${
                    m.risco ? "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70 dark:hover:bg-red-950/20"
                    : i % 2 === 0 ? "hover:bg-muted/30" : "bg-muted/10 hover:bg-muted/30"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {m.risco && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" aria-label="Em risco de abandono" />}
                      <span className="font-medium">{m.nome}</span>
                    </div>
                    {m.inativo && (
                      <span className="text-[10px] text-amber-600">Nunca serviu no período</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.ministerios.slice(0, 2).map((mn) => (
                        <span key={mn} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{mn}</span>
                      ))}
                      {m.ministerios.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">+{m.ministerios.length - 2}</span>
                      )}
                      {m.ministerios.length === 0 && <span className="text-[10px] text-muted-foreground/50">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{m.convocados || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {m.presentes > 0
                      ? <span className="text-xs font-semibold text-emerald-600">{m.presentes}</span>
                      : <span className="text-xs text-muted-foreground">0</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {m.faltas > 0
                      ? <span className="text-xs font-semibold text-red-500">{m.faltas}</span>
                      : <span className="text-xs text-muted-foreground">0</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                    {m.justificou > 0
                      ? <span className="text-xs font-medium text-blue-600">{m.justificou}</span>
                      : <span className="text-xs text-muted-foreground">0</span>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    {m.convocados === 0
                      ? <span className="text-xs text-muted-foreground block text-center">—</span>
                      : <BarraPresenca taxa={m.taxaPresenca} />
                    }
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {m.diasSemServir !== null ? (
                      <span className={`text-xs font-medium ${
                        m.diasSemServir <= 14 ? "text-emerald-600"
                        : m.diasSemServir <= 30 ? "text-foreground"
                        : m.diasSemServir <= 60 ? "text-amber-600"
                        : "text-red-500"
                      }`}>
                        {m.diasSemServir}d
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center hidden md:table-cell">
                    <TendenciaIcon t={m.tendencia} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        {ordenados.length} membro{ordenados.length !== 1 ? "s" : ""} · período de {periodoLabel} ({format(subDays(new Date(), periodoDias), "dd/MM/yyyy", { locale: ptBR })} a hoje)
      </p>
    </div>
  );
}

// ── Th helper ─────────────────────────────────────────────────────────────────

function Th({
  children, onClick, sorted, asc, center,
}: {
  children: React.ReactNode;
  onClick: () => void;
  sorted: boolean;
  asc: boolean;
  center?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-semibold cursor-pointer hover:text-foreground select-none ${center ? "text-center" : "text-left"}`}
    >
      {children} {sorted ? (asc ? "↑" : "↓") : ""}
    </th>
  );
}
