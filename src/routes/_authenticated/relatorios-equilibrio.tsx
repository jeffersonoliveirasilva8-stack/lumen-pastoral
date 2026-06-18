import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, BarChart3, Download, Users, TrendingUp, TrendingDown, Minus,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useSetPageTabs } from "@/contexts/page-tabs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/relatorios-equilibrio")({
  component: RelatoriosEquilibrioPage,
  head: () => ({ meta: [{ title: "Relatório de Equilíbrio — Lumen Pastoral" }] }),
});

const PERIODOS = [
  { label: "30 dias", dias: 30 },
  { label: "60 dias", dias: 60 },
  { label: "90 dias", dias: 90 },
  { label: "180 dias", dias: 180 },
  { label: "1 ano", dias: 365 },
];

type LinhaRelatorio = {
  membro_id: string;
  nome: string;
  ministerio_nome: string;
  ministerio_cor: string;
  total: number;
  presentes: number;
  faltas: number;
  atrasados: number;
  justificou: number;
  pendentes: number;
  taxa_presenca: number;
  ultimo_servico: string | null;
};

function exportCSV(linhas: LinhaRelatorio[], periodo: string) {
  const header = ["Membro", "Função", "Total", "Presentes", "Atrasados", "Justificou", "Faltas", "Taxa %", "Último serviço"];
  const rows = linhas.map((l) => [
    l.nome,
    l.ministerio_nome,
    l.total,
    l.presentes,
    l.atrasados,
    l.justificou,
    l.faltas,
    l.taxa_presenca,
    l.ultimo_servico ?? "-",
  ]);
  const csv = [header, ...rows].map((r) => r.map(String).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `equilibrio-${periodo}-${format(new Date(), "yyyyMMdd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RelatoriosEquilibrioPage() {
  const { profile } = useAuth();
  const [periodoDias, setPeriodoDias] = useState(90);
  const [filtroMinisterio, setFiltroMinisterio] = useState<string | null>(null);
  const [ordenar, setOrdenar] = useState<"nome" | "total" | "taxa" | "ultimo">("total");
  const [asc, setAsc] = useState(false);

  const desde = format(subDays(new Date(), periodoDias), "yyyy-MM-dd");
  const ate = format(new Date(), "yyyy-MM-dd");

  const { data: membrosEscala = [], isLoading } = useQuery({
    queryKey: ["relatorio-equilibrio", profile?.paroquia_id, desde],
    enabled: !!profile?.paroquia_id,
    queryFn: async () => {
      // Busca escalas do período
      const { data: escalas } = await anyDb
        .from("escalas")
        .select("id, data")
        .eq("paroquia_id", profile!.paroquia_id!)
        .gte("data", desde)
        .lte("data", ate)
        .neq("status", "arquivada");

      if (!escalas?.length) return [];

      const escalaIds = (escalas as { id: string; data: string }[]).map((e) => e.id);
      const escalaDataMap = Object.fromEntries(
        (escalas as { id: string; data: string }[]).map((e) => [e.id, e.data])
      );

      const { data: membros } = await anyDb
        .from("escala_membros")
        .select("id, membro_id, ministerio_id, escala_id, status, membros(id, nome), ministerios(id, nome, cor)")
        .in("escala_id", escalaIds);

      return ((membros ?? []) as any[]).map((r: any) => ({
        id: r.id,
        membro_id: r.membro_id,
        ministerio_id: r.ministerio_id,
        escala_id: r.escala_id,
        status: r.status,
        data: escalaDataMap[r.escala_id] ?? ate,
        membro_nome: r.membros?.nome ?? "—",
        ministerio_nome: r.ministerios?.nome ?? "—",
        ministerio_cor: r.ministerios?.cor ?? "#888",
      }));
    },
  });

  // Agrupa por (membro_id, ministerio_id)
  const linhas: LinhaRelatorio[] = useMemo(() => {
    const map = new Map<string, LinhaRelatorio>();

    membrosEscala.forEach((r: any) => {
      if (filtroMinisterio && r.ministerio_id !== filtroMinisterio) return;
      const key = `${r.membro_id}__${r.ministerio_id}`;
      if (!map.has(key)) {
        map.set(key, {
          membro_id: r.membro_id,
          nome: r.membro_nome,
          ministerio_nome: r.ministerio_nome,
          ministerio_cor: r.ministerio_cor,
          total: 0,
          presentes: 0,
          faltas: 0,
          atrasados: 0,
          justificou: 0,
          pendentes: 0,
          taxa_presenca: 0,
          ultimo_servico: null,
        });
      }
      const linha = map.get(key)!;
      linha.total++;
      if (r.status === "presente") linha.presentes++;
      else if (r.status === "faltou") linha.faltas++;
      else if (r.status === "atrasado") linha.atrasados++;
      else if (r.status === "justificou") linha.justificou++;
      else linha.pendentes++;
      if (!linha.ultimo_servico || r.data > linha.ultimo_servico) {
        linha.ultimo_servico = r.data;
      }
    });

    map.forEach((l) => {
      const concluidos = l.presentes + l.faltas + l.atrasados + l.justificou;
      l.taxa_presenca = concluidos > 0 ? Math.round(((l.presentes + l.atrasados + l.justificou) / concluidos) * 100) : 0;
    });

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      let diff = 0;
      if (ordenar === "nome") diff = a.nome.localeCompare(b.nome, "pt-BR");
      else if (ordenar === "total") diff = a.total - b.total;
      else if (ordenar === "taxa") diff = a.taxa_presenca - b.taxa_presenca;
      else if (ordenar === "ultimo") diff = (a.ultimo_servico ?? "").localeCompare(b.ultimo_servico ?? "");
      return asc ? diff : -diff;
    });
    return arr;
  }, [membrosEscala, filtroMinisterio, ordenar, asc]);

  const ministerios = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; cor: string }>();
    membrosEscala.forEach((r: any) => map.set(r.ministerio_id, { id: r.ministerio_id, nome: r.ministerio_nome, cor: r.ministerio_cor }));
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [membrosEscala]);

  const stats = useMemo(() => {
    const total = linhas.reduce((s, l) => s + l.total, 0);
    const presentes = linhas.reduce((s, l) => s + l.presentes + l.atrasados + l.justificou, 0);
    const faltas = linhas.reduce((s, l) => s + l.faltas, 0);
    const taxa = total > 0 ? Math.round((presentes / (presentes + faltas || 1)) * 100) : 0;
    return { total, presentes, faltas, taxa, membros: linhas.length };
  }, [linhas]);

  function toggleOrdenar(campo: typeof ordenar) {
    if (ordenar === campo) setAsc((v) => !v);
    else { setOrdenar(campo); setAsc(false); }
  }

  const periodoLabel = PERIODOS.find((p) => p.dias === periodoDias)?.label ?? `${periodoDias} dias`;

  useSetPageTabs([
    { label: "Planejamento",       to: "/escalas",                         isActive: false },
    { label: "Presença",           to: "/sacristia",                       isActive: false },
    { label: "Indisponibilidades", to: "/escalas?view=indisponibilidades", isActive: false },
    { label: "Substituições",      to: "/substituicoes",                   isActive: false },
    { label: "Relatório",          to: "/relatorios-equilibrio",           isActive: true  },
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="font-serif text-2xl sm:text-3xl">Equilíbrio de participação</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Distribuição de escalas por membro — {desde} a {ate}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          disabled={linhas.length === 0}
          onClick={() => exportCSV(linhas, periodoLabel.replace(" ", ""))}
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <div className="space-y-3 mb-6">
        {/* Período */}
        <div className="flex gap-1.5 flex-wrap">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setPeriodoDias(p.dias)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                periodoDias === p.dias
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Filtro ministério */}
        {ministerios.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFiltroMinisterio(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroMinisterio === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Todas as funções
            </button>
            {ministerios.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFiltroMinisterio(filtroMinisterio === m.id ? null : m.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroMinisterio === m.id ? "text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                style={filtroMinisterio === m.id ? { backgroundColor: m.cor } : {}}
              >
                {m.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Carregando dados...</span>
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">Nenhuma escala encontrada no período.</p>
        </div>
      ) : (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold">{stats.membros}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Membros</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Escalações</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{stats.taxa}%</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Comparecimento</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{stats.faltas}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Faltas</p>
            </div>
          </div>

          {/* Tabela */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th
                      className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleOrdenar("nome")}
                    >
                      Membro {ordenar === "nome" ? (asc ? "↑" : "↓") : ""}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden sm:table-cell">
                      Função
                    </th>
                    <th
                      className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleOrdenar("total")}
                    >
                      Total {ordenar === "total" ? (asc ? "↑" : "↓") : ""}
                    </th>
                    <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden md:table-cell">
                      <CheckCircle2 className="h-3.5 w-3.5 inline text-emerald-500" />
                    </th>
                    <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden md:table-cell">
                      <XCircle className="h-3.5 w-3.5 inline text-red-500" />
                    </th>
                    <th
                      className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleOrdenar("taxa")}
                    >
                      Taxa {ordenar === "taxa" ? (asc ? "↑" : "↓") : ""}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground select-none hidden lg:table-cell"
                      onClick={() => toggleOrdenar("ultimo")}
                    >
                      Último serviço {ordenar === "ultimo" ? (asc ? "↑" : "↓") : ""}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => {
                    const TaxaIcon = l.taxa_presenca >= 80 ? TrendingUp : l.taxa_presenca >= 50 ? Minus : TrendingDown;
                    const taxaColor = l.taxa_presenca >= 80 ? "text-emerald-600" : l.taxa_presenca >= 50 ? "text-amber-600" : "text-red-500";
                    return (
                      <tr
                        key={`${l.membro_id}-${l.ministerio_nome}`}
                        className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-4 py-3 font-medium">{l.nome}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: l.ministerio_cor + "22", color: l.ministerio_cor }}
                          >
                            {l.ministerio_nome}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-bold">{l.total}</td>
                        <td className="px-3 py-3 text-center text-emerald-600 hidden md:table-cell">{l.presentes + l.atrasados + l.justificou}</td>
                        <td className="px-3 py-3 text-center text-red-500 hidden md:table-cell">{l.faltas}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`flex items-center justify-center gap-1 font-semibold ${taxaColor}`}>
                            <TaxaIcon className="h-3.5 w-3.5" />
                            {l.pendentes === l.total ? "—" : `${l.taxa_presenca}%`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">
                          {l.ultimo_servico
                            ? format(new Date(l.ultimo_servico + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
