import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, BarChart3, Download, Calendar, Users, TrendingUp,
  CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useSetPageTabs } from "@/contexts/page-tabs";

const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/relatorios-escalas")({
  component: RelatoriosEscalasPage,
  head: () => ({ meta: [{ title: "Relatório de Escalas — Lumen Pastoral" }] }),
});

const PERIODOS = [
  { label: "30 dias", dias: 30 },
  { label: "60 dias", dias: 60 },
  { label: "90 dias", dias: 90 },
  { label: "180 dias", dias: 180 },
  { label: "1 ano",   dias: 365 },
];

type EscalaRow = {
  id: string;
  titulo: string;
  data: string;
  tipo: string;
  status: string;
  solene: boolean;
  vagas: number;
  preenchidas: number;
  presentes: number;
  faltas: number;
  pendentes: number;
  aderencia_motor: number | null;
};

function pct(num: number, den: number) {
  if (den === 0) return 0;
  return Math.round((num / den) * 100);
}

function exportCSV(linhas: EscalaRow[], periodo: string) {
  const header = ["Data", "Título", "Tipo", "Vagas", "Preenchidas", "Cobertura%", "Presentes", "Faltas", "Pendentes", "Aderência motor%"];
  const rows = linhas.map((l) => [
    format(new Date(l.data + "T12:00:00"), "dd/MM/yyyy"),
    l.titulo,
    l.tipo,
    l.vagas,
    l.preenchidas,
    pct(l.preenchidas, l.vagas),
    l.presentes,
    l.faltas,
    l.pendentes,
    l.aderencia_motor != null ? l.aderencia_motor.toFixed(1) : "-",
  ]);
  const csv = [header, ...rows].map((r) => r.map(String).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `escalas-${periodo}-${format(new Date(), "yyyyMMdd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RelatoriosEscalasPage() {
  const { profile } = useAuth();
  const [periodoDias, setPeriodoDias] = useState(90);
  const [filtroStatus, setFiltroStatus] = useState<string>("publicada");
  const [ordenar, setOrdenar] = useState<"data" | "cobertura" | "aderencia">("data");
  const [asc, setAsc] = useState(false);

  const desde = format(subDays(new Date(), periodoDias), "yyyy-MM-dd");

  useSetPageTabs([
    { label: "Equilíbrio", to: "/relatorios-equilibrio", isActive: false },
    { label: "Escalas",    to: "/relatorios-escalas",    isActive: true  },
  ]);

  const { data: escalas = [], isLoading } = useQuery<EscalaRow[]>({
    queryKey: ["relatorio-escalas", profile?.paroquia_id, desde, filtroStatus],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      // Busca escalas do período
      let q = anyDb
        .from("escalas")
        .select("id, titulo, data, tipo, status, solene, aderencia_motor, escala_funcoes(quantidade), escala_membros(id, status, ativo)")
        .eq("paroquia_id", profile!.paroquia_id)
        .gte("data", desde)
        .order("data", { ascending: false });

      if (filtroStatus !== "todas") q = q.eq("status", filtroStatus);

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((e: any) => {
        const vagas = (e.escala_funcoes ?? []).reduce((s: number, f: any) => s + (f.quantidade ?? 0), 0);
        const membros = (e.escala_membros ?? []).filter((m: any) => m.ativo !== false);
        const preenchidas = membros.length;
        const presentes  = membros.filter((m: any) => m.status === "presente" || m.status === "atrasado").length;
        const faltas     = membros.filter((m: any) => m.status === "faltou").length;
        const pendentes  = membros.filter((m: any) => m.status === "pendente").length;
        return {
          id: e.id,
          titulo: e.titulo,
          data: e.data,
          tipo: e.tipo ?? "missa",
          status: e.status,
          solene: e.solene ?? false,
          vagas,
          preenchidas,
          presentes,
          faltas,
          pendentes,
          aderencia_motor: e.aderencia_motor ?? null,
        } as EscalaRow;
      });
    },
  });

  // KPIs agregados
  const kpis = useMemo(() => {
    const total = escalas.length;
    if (total === 0) return { total: 0, coberturaMedia: 0, aderenciaMedia: null, totalVagas: 0, totalPreenchidas: 0 };
    const totalVagas      = escalas.reduce((s, e) => s + e.vagas, 0);
    const totalPreenchidas = escalas.reduce((s, e) => s + e.preenchidas, 0);
    const coberturaMedia  = pct(totalPreenchidas, totalVagas);
    const comAderencia    = escalas.filter((e) => e.aderencia_motor != null);
    const aderenciaMedia  = comAderencia.length > 0
      ? Math.round(comAderencia.reduce((s, e) => s + (e.aderencia_motor ?? 0), 0) / comAderencia.length)
      : null;
    return { total, coberturaMedia, aderenciaMedia, totalVagas, totalPreenchidas };
  }, [escalas]);

  // Ordenação
  const ordenadas = useMemo(() => {
    const sorted = [...escalas].sort((a, b) => {
      if (ordenar === "data")      return a.data.localeCompare(b.data);
      if (ordenar === "cobertura") return pct(a.preenchidas, a.vagas) - pct(b.preenchidas, b.vagas);
      if (ordenar === "aderencia") return (a.aderencia_motor ?? -1) - (b.aderencia_motor ?? -1);
      return 0;
    });
    return asc ? sorted : sorted.reverse();
  }, [escalas, ordenar, asc]);

  function toggleOrdem(col: typeof ordenar) {
    if (ordenar === col) setAsc(!asc);
    else { setOrdenar(col); setAsc(false); }
  }

  const periodoLabel = PERIODOS.find((p) => p.dias === periodoDias)?.label ?? `${periodoDias}d`;

  return (
    <div className="space-y-5 pb-10">
      {/* Filtros */}
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

        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {[
            { v: "publicada", l: "Publicadas" },
            { v: "arquivada", l: "Arquivadas" },
            { v: "todas",     l: "Todas"      },
          ].map((s) => (
            <button
              key={s.v}
              onClick={() => setFiltroStatus(s.v)}
              className={`px-3 py-1.5 font-medium transition-colors ${filtroStatus === s.v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {s.l}
            </button>
          ))}
        </div>

        <Button
          size="sm" variant="outline" className="ml-auto gap-1.5 text-xs h-8"
          disabled={escalas.length === 0}
          onClick={() => exportCSV(ordenadas, periodoLabel)}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            icon: Calendar,
            label: "Escalas",
            value: kpis.total,
            color: "text-blue-600",
            bg: "bg-blue-50 dark:bg-blue-950/30",
          },
          {
            icon: Users,
            label: "Cobertura média",
            value: isLoading ? "…" : `${kpis.coberturaMedia}%`,
            sub: `${kpis.totalPreenchidas}/${kpis.totalVagas} vagas`,
            color: kpis.coberturaMedia >= 80 ? "text-emerald-600" : kpis.coberturaMedia >= 60 ? "text-amber-600" : "text-red-600",
            bg: "bg-muted/30",
          },
          {
            icon: TrendingUp,
            label: "Aderência ao motor",
            value: isLoading ? "…" : kpis.aderenciaMedia != null ? `${kpis.aderenciaMedia}%` : "—",
            sub: kpis.aderenciaMedia != null ? "média das publicadas" : "sem dados ainda",
            color: "text-violet-600",
            bg: "bg-violet-50 dark:bg-violet-950/30",
          },
          {
            icon: CheckCircle2,
            label: "Período",
            value: periodoLabel,
            sub: `desde ${format(subDays(new Date(), periodoDias), "dd/MM/yyyy")}`,
            color: "text-muted-foreground",
            bg: "bg-muted/30",
          },
        ].map((k) => (
          <div key={k.label} className={`rounded-xl border border-border ${k.bg} p-3 space-y-1`}>
            <div className="flex items-center gap-1.5">
              <k.icon className={`h-3.5 w-3.5 ${k.color}`} />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</p>
            </div>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            {k.sub && <p className="text-[10px] text-muted-foreground">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando escalas…
        </div>
      ) : escalas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhuma escala no período selecionado.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th
                  className="text-left px-3 py-2.5 font-semibold cursor-pointer hover:text-foreground select-none"
                  onClick={() => toggleOrdem("data")}
                >
                  Data {ordenar === "data" ? (asc ? "↑" : "↓") : ""}
                </th>
                <th className="text-left px-3 py-2.5 font-semibold">Escala</th>
                <th
                  className="text-center px-3 py-2.5 font-semibold cursor-pointer hover:text-foreground select-none"
                  onClick={() => toggleOrdem("cobertura")}
                >
                  Cobertura {ordenar === "cobertura" ? (asc ? "↑" : "↓") : ""}
                </th>
                <th className="text-center px-3 py-2.5 font-semibold hidden sm:table-cell">Presença</th>
                <th
                  className="text-center px-3 py-2.5 font-semibold cursor-pointer hover:text-foreground select-none hidden md:table-cell"
                  onClick={() => toggleOrdem("aderencia")}
                >
                  Motor {ordenar === "aderencia" ? (asc ? "↑" : "↓") : ""}
                </th>
                <th className="text-center px-3 py-2.5 font-semibold hidden sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((e, i) => {
                const cobertura = pct(e.preenchidas, e.vagas);
                const cobColor  = cobertura >= 80 ? "text-emerald-600" : cobertura >= 60 ? "text-amber-600" : "text-red-500";
                return (
                  <tr key={e.id} className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(e.data + "T12:00:00"), "EEE dd/MM", { locale: ptBR })}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px]">
                      <p className="font-medium truncate">{e.titulo}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{e.tipo}{e.solene ? " · Solene" : ""}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`font-bold text-sm ${cobColor}`}>{cobertura}%</span>
                        <span className="text-[10px] text-muted-foreground">{e.preenchidas}/{e.vagas}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <div className="flex items-center justify-center gap-2 text-[10px]">
                        {e.presentes > 0 && (
                          <span className="flex items-center gap-0.5 text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" />{e.presentes}
                          </span>
                        )}
                        {e.faltas > 0 && (
                          <span className="flex items-center gap-0.5 text-red-500">
                            <AlertCircle className="h-3 w-3" />{e.faltas}
                          </span>
                        )}
                        {e.pendentes > 0 && (
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <Clock className="h-3 w-3" />{e.pendentes}
                          </span>
                        )}
                        {e.presentes === 0 && e.faltas === 0 && e.pendentes === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center hidden md:table-cell">
                      {e.aderencia_motor != null ? (
                        <span className={`text-xs font-medium ${e.aderencia_motor >= 70 ? "text-violet-600" : "text-amber-600"}`}>
                          {e.aderencia_motor.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        e.status === "publicada" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : e.status === "rascunho" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                      }`}>
                        {e.status === "publicada" ? "Publicada" : e.status === "rascunho" ? "Rascunho" : "Arquivada"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
