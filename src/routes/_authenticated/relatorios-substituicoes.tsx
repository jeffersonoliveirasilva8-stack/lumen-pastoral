import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2, BarChart3, Download, Filter,
  CheckCircle2, XCircle, Clock, ArrowLeftRight,
  TrendingUp, TrendingDown,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/relatorios-substituicoes")({
  component: RelatoriosSubstituicoes,
  head: () => ({ meta: [{ title: "Relatórios — Substituições — Lumen Pastoral" }] }),
});

type SubstItem = {
  id: string;
  status: string;
  motivo_solicitacao: string | null;
  motivo_rejeicao: string | null;
  aprovado_em: string | null;
  created_at: string;
  escala_titulo: string;
  escala_data: string;
  ministerio_nome: string;
  ministerio_cor: string;
  solicitante_nome: string;
  substituto_nome: string | null;
  aprovador_nome: string | null;
};

type Filtros = {
  status: string;
  periodo: "30d" | "90d" | "180d" | "todos";
  ministerio: string;
};

const STATUS_LABEL: Record<string, string> = {
  solicitada:     "Aguardando",
  com_voluntario: "Com voluntário",
  aprovada:       "Aprovada",
  rejeitada:      "Rejeitada",
  cancelada:      "Cancelada",
};

function RelatoriosSubstituicoes() {
  const { profile } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? null;
  const [filtros, setFiltros] = useState<Filtros>({
    status: "todos",
    periodo: "90d",
    ministerio: "todos",
  });

  const { data: substituicoes = [], isLoading } = useQuery<SubstItem[]>({
    queryKey: ["relatorio-substituicoes", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("coord_get_substituicoes", {
        p_status: null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const cutoffDate = useMemo(() => {
    const d = new Date();
    if (filtros.periodo === "30d")  d.setDate(d.getDate() - 30);
    if (filtros.periodo === "90d")  d.setDate(d.getDate() - 90);
    if (filtros.periodo === "180d") d.setDate(d.getDate() - 180);
    return filtros.periodo === "todos" ? new Date(0) : d;
  }, [filtros.periodo]);

  const ministerios = useMemo(() => {
    const set = new Set(substituicoes.map((s) => s.ministerio_nome));
    return Array.from(set).sort();
  }, [substituicoes]);

  const filtered = useMemo(() => {
    return substituicoes.filter((s) => {
      if (filtros.status !== "todos" && s.status !== filtros.status) return false;
      if (filtros.ministerio !== "todos" && s.ministerio_nome !== filtros.ministerio) return false;
      if (new Date(s.created_at) < cutoffDate) return false;
      return true;
    });
  }, [substituicoes, filtros, cutoffDate]);

  const stats = useMemo(() => {
    const total    = filtered.length;
    const aprovadas  = filtered.filter((s) => s.status === "aprovadas").length;
    const rejeitadas = filtered.filter((s) => s.status === "rejeitadas").length;
    const aprovada   = filtered.filter((s) => s.status === "aprovada").length;
    const rejeitada  = filtered.filter((s) => s.status === "rejeitada").length;
    const cancelada  = filtered.filter((s) => s.status === "cancelada").length;
    const pendentes  = filtered.filter((s) => ["solicitada","com_voluntario"].includes(s.status)).length;
    const taxaAprovacao = total > 0 ? Math.round((aprovada / total) * 100) : 0;

    // Por membro (quem mais solicita)
    const porMembro = filtered.reduce<Record<string, { nome: string; total: number; aprovadas: number }>>((acc, s) => {
      const nome = s.solicitante_nome;
      if (!acc[nome]) acc[nome] = { nome, total: 0, aprovadas: 0 };
      acc[nome].total++;
      if (s.status === "aprovada") acc[nome].aprovadas++;
      return acc;
    }, {});

    // Por ministério
    const porMinisterio = filtered.reduce<Record<string, { nome: string; total: number; cor: string }>>((acc, s) => {
      const nome = s.ministerio_nome;
      if (!acc[nome]) acc[nome] = { nome, total: 0, cor: s.ministerio_cor };
      acc[nome].total++;
      return acc;
    }, {});

    return {
      total, aprovada, rejeitada, cancelada, pendentes, taxaAprovacao,
      topMembros: Object.values(porMembro).sort((a, b) => b.total - a.total).slice(0, 5),
      topMinisterios: Object.values(porMinisterio).sort((a, b) => b.total - a.total).slice(0, 5),
    };
  }, [filtered]);

  function exportCSV() {
    const headers = ["Data", "Status", "Ministério", "Escala", "Solicitante", "Substituto", "Motivo", "Aprovador"];
    const rows = filtered.map((s) => [
      format(new Date(s.created_at), "dd/MM/yyyy HH:mm"),
      STATUS_LABEL[s.status] ?? s.status,
      s.ministerio_nome,
      s.escala_titulo,
      s.solicitante_nome,
      s.substituto_nome ?? "",
      s.motivo_solicitacao ?? "",
      s.aprovador_nome ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `substituicoes_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 lg:px-6 space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif">Relatórios — Substituições</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Análise e histórico completo de substituições da paróquia.
          </p>
        </div>
        <Button variant="outline" size="sm" className="rounded-xl shrink-0" onClick={exportCSV}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Período</p>
          <div className="flex gap-1.5">
            {(["30d","90d","180d","todos"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFiltros((f) => ({ ...f, periodo: p }))}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  filtros.periodo === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "todos" ? "Todos" : p.replace("d", "d")}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
          <select
            value={filtros.status}
            onChange={(e) => setFiltros((f) => ({ ...f, status: e.target.value }))}
            className="text-xs rounded-lg border border-input bg-background px-2 py-1 outline-none focus:border-ring"
          >
            <option value="todos">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {ministerios.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ministério</p>
            <select
              value={filtros.ministerio}
              onChange={(e) => setFiltros((f) => ({ ...f, ministerio: e.target.value }))}
              className="text-xs rounded-lg border border-input bg-background px-2 py-1 outline-none focus:border-ring"
            >
              <option value="todos">Todos</option>
              {ministerios.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard icon={<ArrowLeftRight className="h-4 w-4" />} label="Total" value={stats.total} color="text-foreground" />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="Aprovadas" value={stats.aprovada} color="text-green-600" />
            <KpiCard icon={<XCircle className="h-4 w-4" />} label="Rejeitadas" value={stats.rejeitada} color="text-red-600" />
            <KpiCard icon={<Clock className="h-4 w-4" />} label="Pendentes" value={stats.pendentes} color="text-amber-600" />
          </div>

          {stats.total > 0 && (
            <div className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{stats.taxaAprovacao}% de aprovação</p>
                <p className="text-xs text-muted-foreground">{stats.aprovada} aprovadas de {stats.total} solicitações</p>
              </div>
            </div>
          )}

          {/* Top membros + ministérios */}
          {stats.total > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quem mais solicita</p>
                {stats.topMembros.map((m) => (
                  <div key={m.nome} className="flex items-center justify-between gap-2">
                    <p className="text-sm truncate">{m.nome}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{m.total} pedido{m.total !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por ministério</p>
                {stats.topMinisterios.map((m) => (
                  <div key={m.nome} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.cor }} />
                    <p className="text-sm truncate flex-1">{m.nome}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{m.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabela completa */}
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
              </p>
            </div>
            {filtered.length === 0 ? (
              <div className="p-10 text-center">
                <BarChart3 className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum dado no período selecionado.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {filtered.map((s) => (
                  <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="shrink-0">
                      {s.status === "aprovada"  && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {s.status === "rejeitada" && <XCircle className="h-4 w-4 text-red-400" />}
                      {s.status === "cancelada" && <XCircle className="h-4 w-4 text-muted-foreground" />}
                      {["solicitada","com_voluntario"].includes(s.status) && <Clock className="h-4 w-4 text-amber-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.solicitante_nome}
                        {s.substituto_nome && (
                          <span className="text-muted-foreground font-normal"> → {s.substituto_nome}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.escala_titulo} · {format(new Date(s.escala_data + "T12:00:00"), "d MMM", { locale: ptBR })}
                        {" · "}
                        <span style={{ color: s.ministerio_cor }}>{s.ministerio_nome}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{STATUS_LABEL[s.status] ?? s.status}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(new Date(s.created_at), "d/MM/yy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className={`shrink-0 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <p className={`text-2xl font-serif ${color}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
