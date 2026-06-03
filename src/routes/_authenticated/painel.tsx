import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Calendar, CalendarRange, Users, Sparkles, Activity, ChevronRight,
  AlertTriangle, Cake, CheckCircle2, UserX, UserCheck,
  CalendarOff, Zap, Loader2, FileText, BookOpen, Music,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useRankingTop } from "@/lib/ranking";
import { useLiturgiaHoje } from "@/hooks/use-liturgia";
import { DashboardMetricCard } from "@/components/dashboard/DashboardMetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getLiturgicalDays,
  getLiturgicalSeason,
  SEASON_LABELS,
  type LiturgicalColor,
  type LiturgicalSeason,
} from "@/lib/liturgical-calendar";

const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/painel")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Painel — Lumen Pastoral" }] }),
});

type SubstituicaoTarget = { escalaId: string; atribuicaoId: string; ministerioId: string; membroNome: string; data: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const VESTMENT_DOT: Record<LiturgicalColor, string> = {
  branco:   "bg-white border-2 border-gray-300",
  roxo:     "bg-purple-600",
  vermelho: "bg-red-600",
  verde:    "bg-green-600",
  preto:    "bg-gray-900",
  dourado:  "bg-amber-400",
  rosa:     "bg-pink-400",
};

const VESTMENT_LABEL: Record<LiturgicalColor, string> = {
  branco: "Branco", roxo: "Roxo", vermelho: "Vermelho",
  verde: "Verde", preto: "Preto", dourado: "Dourado", rosa: "Rosa",
};

const SEASON_VESTMENT: Record<LiturgicalSeason, LiturgicalColor> = {
  advento: "roxo", natal: "branco", comum: "verde",
  quaresma: "roxo", triduo: "vermelho", pascoa: "branco",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  rascunho:  { label: "Rascunho",  variant: "secondary" },
  publicada: { label: "Publicada", variant: "default" },
  arquivada: { label: "Arquivada", variant: "outline" },
};

type AgendaEvent = {
  id: string;
  tipo: "Escala" | "Formação";
  titulo: string;
  data: string;
  hora: string | null;
  local: string | null;
  cor: string;
};


// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-popover border border-border px-3 py-2 shadow-md text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color ?? "currentColor" }}>
          {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function DashboardPage() {
  const { profile } = useAuth();
  const pid = profile?.paroquia_id;

  // ── Liturgical (pure, no fetch) ───────────────────────────────────────────────
  const today = useMemo(() => new Date(), []);
  const year = today.getFullYear();
  const todayStr = format(today, "yyyy-MM-dd");
  const season = useMemo(() => getLiturgicalSeason(today, year), [today, year]);
  const allDays = useMemo(() => getLiturgicalDays(year), [year]);
  const todayCelebrations = useMemo(
    () => allDays.filter((d) => format(d.date, "yyyy-MM-dd") === todayStr),
    [allDays, todayStr],
  );
  const todayColor: LiturgicalColor =
    todayCelebrations.length > 0 ? todayCelebrations[0].color : SEASON_VESTMENT[season];

  // ── KPI queries ───────────────────────────────────────────────────────────────
  const { data: paroquia } = useQuery({
    queryKey: ["paroquia", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await supabase.from("paroquias").select("nome, diocese").eq("id", pid!).maybeSingle();
      return data;
    },
  });

  const { data: totalMembros = 0 } = useQuery({
    queryKey: ["stats-membros", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { count } = await supabase
        .from("membros").select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!).eq("ativo", true);
      return count ?? 0;
    },
  });

  const { data: escalasDoMes = 0 } = useQuery({
    queryKey: ["stats-escalas-mes", pid],
    enabled: !!pid,
    queryFn: async () => {
      const now = new Date();
      const inicio = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const fim = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
      const { count } = await supabase
        .from("escalas").select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!).gte("data", inicio).lte("data", fim);
      return count ?? 0;
    },
  });

  const { data: totalMinisterios = 0 } = useQuery({
    queryKey: ["stats-ministerios", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { count } = await supabase
        .from("ministerios").select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!).eq("ativo", true);
      return count ?? 0;
    },
  });

  const { data: taxaPreenchimento = null } = useQuery({
    queryKey: ["stats-taxa", pid],
    enabled: !!pid,
    queryFn: async () => {
      const now = new Date();
      const inicio = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const { data: escalas } = await supabase
        .from("escalas").select("id").eq("paroquia_id", pid!).gte("data", inicio);
      if (!escalas?.length) return null;
      const ids = escalas.map((e) => e.id);
      const [vagasResult, { count: preenchidas }] = await Promise.all([
        supabase.from("escala_funcoes").select("quantidade").in("escala_id", ids),
        supabase.from("escala_membros").select("*", { count: "exact", head: true }).in("escala_id", ids),
      ]);
      const totalVagas = ((vagasResult.data ?? []) as { quantidade: number }[])
        .reduce((s, r) => s + (r.quantidade ?? 1), 0);
      if (!totalVagas) return null;
      return Math.min(100, Math.round(((preenchidas ?? 0) / totalVagas) * 100));
    },
  });

  // ── Escalas ───────────────────────────────────────────────────────────────────
  const { data: proximasEscalas = [] } = useQuery({
    queryKey: ["proximas-escalas", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, local, status")
        .eq("paroquia_id", pid!)
        .gte("data", format(new Date(), "yyyy-MM-dd"))
        .order("data").order("hora_inicio")
        .limit(6);
      return (data ?? []) as {
        id: string; titulo: string; data: string;
        hora_inicio: string | null; local: string | null; status: string;
      }[];
    },
  });

  // ── Insights: membros sem servir há >20 dias ─────────────────────────────────
  const { data: membrosOciosos = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["insights-ociosos", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data: todos } = await supabase.from("membros").select("id,nome").eq("paroquia_id", pid!).eq("ativo", true);
      if (!todos?.length) return [];
      const vinte = format(addDays(new Date(), -20), "yyyy-MM-dd");
      const { data: escalasRecentes } = await supabase.from("escalas").select("id").eq("paroquia_id", pid!).gte("data", vinte);
      const escalaIds = (escalasRecentes ?? []).map((e) => e.id);
      if (escalaIds.length === 0) return todos.slice(0, 5);
      const { data: escalados } = await supabase.from("escala_membros").select("membro_id").in("escala_id", escalaIds);
      const escaladosSet = new Set((escalados ?? []).map((r) => r.membro_id));
      return todos.filter((m) => !escaladosSet.has(m.id)).slice(0, 5);
    },
  });

  // ── Insights: membros novos sem escala (últimos 30 dias) ──────────────────────
  const { data: membrosNovos = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["insights-novos", pid],
    enabled: !!pid,
    queryFn: async () => {
      const trinta = format(addDays(new Date(), -30), "yyyy-MM-dd");
      const { data: novos } = await supabase.from("membros").select("id,nome").eq("paroquia_id", pid!).eq("ativo", true).gte("data_ingresso", trinta);
      if (!novos?.length) return [];
      const ids = novos.map((m) => m.id);
      const { data: escalados } = await supabase.from("escala_membros").select("membro_id").in("membro_id", ids);
      const escaladosSet = new Set((escalados ?? []).map((r) => r.membro_id));
      return novos.filter((m) => !escaladosSet.has(m.id));
    },
  });

  // ── Insights: conflitos indisponibilidade próximos 7 dias ─────────────────────
  type Conflito = { escalaId: string; escalaTitulo: string; membroId: string; membroNome: string; atribuicaoId: string; ministerioId: string; data: string };
  const { data: conflitos = [] } = useQuery<Conflito[]>({
    queryKey: ["insights-conflitos", pid],
    enabled: !!pid,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
      const { data: escalas } = await supabase.from("escalas").select("id,titulo,data").eq("paroquia_id", pid!).gte("data", hoje).lte("data", em7).neq("status", "arquivada");
      if (!escalas?.length) return [];
      const escalaIds = escalas.map((e) => e.id);
      const { data: emEscala } = await supabase.from("escala_membros").select("id, membro_id, escala_id, ministerio_id, membros(nome)").in("escala_id", escalaIds);
      if (!emEscala?.length) return [];
      const membroIds = [...new Set((emEscala as any[]).map((r) => r.membro_id))];
      const { data: indisp } = await supabase.from("indisponibilidades").select("membro_id,data").in("membro_id", membroIds).gte("data", hoje).lte("data", em7);
      if (!indisp?.length) return [];
      const conflitosResult: Conflito[] = [];
      for (const ind of indisp) {
        const escalasNoDia = escalas.filter((e) => e.data === ind.data);
        for (const esc of escalasNoDia) {
          const row = (emEscala as any[]).find((r) => r.membro_id === ind.membro_id && r.escala_id === esc.id);
          if (row) {
            conflitosResult.push({
              escalaId: esc.id,
              escalaTitulo: esc.titulo,
              membroId: ind.membro_id,
              membroNome: row.membros?.nome ?? "Membro",
              atribuicaoId: row.id,
              ministerioId: row.ministerio_id,
              data: ind.data,
            });
          }
        }
      }
      return conflitosResult.slice(0, 5);
    },
  });

  // ── Insights: escalas incompletas próximos 14 dias ───────────────────────────
  const { data: escalasIncompletas = [] } = useQuery({
    queryKey: ["insights-incompletas", pid],
    enabled: !!pid,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em14 = format(addDays(new Date(), 14), "yyyy-MM-dd");
      const { data: escalas } = await supabase.from("escalas").select("id, titulo, data").eq("paroquia_id", pid!).neq("status", "arquivada").gte("data", hoje).lte("data", em14);
      if (!escalas?.length) return [];
      const ids = escalas.map((e) => e.id);
      const [{ data: vagas }, { data: atribuidos }] = await Promise.all([
        supabase.from("escala_funcoes").select("escala_id, quantidade").in("escala_id", ids),
        supabase.from("escala_membros").select("escala_id").in("escala_id", ids),
      ]);
      const vagasMap: Record<string, number> = {};
      const atribMap: Record<string, number> = {};
      (vagas ?? []).forEach((r) => { vagasMap[r.escala_id] = (vagasMap[r.escala_id] ?? 0) + ((r.quantidade as number) ?? 1); });
      (atribuidos ?? []).forEach((r) => { atribMap[r.escala_id] = (atribMap[r.escala_id] ?? 0) + 1; });
      return escalas.map((e) => ({
        id: e.id, titulo: e.titulo, data: e.data,
        vagas: vagasMap[e.id] ?? 0,
        atribuidos: atribMap[e.id] ?? 0,
        abertas: (vagasMap[e.id] ?? 0) - (atribMap[e.id] ?? 0),
      })).filter((e) => e.abertas > 0);
    },
  });

  // ── BI: Top membros por score — fonte unificada via useRankingTop ────────────
  const { data: topMembrosRaw = [] } = useRankingTop(pid ?? undefined, 10);
  // Formata para o gráfico (primeiro nome + score)
  const topMembros = topMembrosRaw.map((m) => ({
    nome: m.nome.split(" ")[0],
    score: m.score,
  }));

  // ── BI: Distribuição de funções ───────────────────────────────────────────────
  const { data: funcaoDistrib = [] } = useQuery({
    queryKey: ["stats-funcao-distrib", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data: ministerios } = await supabase
        .from("ministerios")
        .select("id, nome, cor")
        .eq("paroquia_id", pid!)
        .eq("ativo", true);
      if (!ministerios?.length) return [];
      const { data: atrib } = await supabase
        .from("membro_ministerios")
        .select("ministerio_id")
        .in("ministerio_id", ministerios.map((m) => m.id));
      const counts: Record<string, number> = {};
      (atrib ?? []).forEach((r) => { counts[r.ministerio_id] = (counts[r.ministerio_id] ?? 0) + 1; });
      return ministerios
        .map((m) => ({ nome: m.nome, cor: m.cor, membros: counts[m.id] ?? 0 }))
        .sort((a, b) => b.membros - a.membros);
    },
  });

  // ── Aniversariantes do mês ───────────────────────────────────────────────────
  const mesAtual = today.getMonth() + 1;
  const { data: aniversariantes = [] } = useQuery<{ id: string; nome: string; data_nascimento: string }[]>({
    queryKey: ["aniversariantes", pid, mesAtual],
    enabled: !!pid,
    queryFn: async () => {
      const { data } = await supabase
        .from("membros")
        .select("id, nome, data_nascimento")
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .not("data_nascimento", "is", null);
      return ((data ?? []) as { id: string; nome: string; data_nascimento: string }[])
        .filter((m) => new Date(m.data_nascimento + "T12:00:00").getMonth() + 1 === mesAtual)
        .sort((a, b) =>
          new Date(a.data_nascimento + "T12:00:00").getDate() -
          new Date(b.data_nascimento + "T12:00:00").getDate()
        );
    },
  });

  // ── Aniversariantes: filtros computados ─────────────────────────────────────
  const [anivTab, setAnivTab] = useState<"hoje" | "semana" | "mes">("hoje");

  const [substituicaoTarget, setSubstituicaoTarget] = useState<SubstituicaoTarget | null>(null);
  const qcDash = useQueryClient();

  const aniversariantesHoje = useMemo(() => {
    const day = today.getDate();
    const month = today.getMonth() + 1;
    return aniversariantes.filter((m) => {
      const d = new Date(m.data_nascimento + "T12:00:00");
      return d.getDate() === day && d.getMonth() + 1 === month;
    });
  }, [aniversariantes, today]);

  const aniversariantesSemana = useMemo(() => {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return aniversariantes.filter((m) => {
      const d = new Date(m.data_nascimento + "T12:00:00");
      const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate());
      return thisYear >= weekStart && thisYear <= weekEnd;
    });
  }, [aniversariantes, today]);

  // ── Insights: membros sem função atribuída ───────────────────────────────────
  const { data: membrosSemFuncao = 0 } = useQuery<number>({
    queryKey: ["insights-sem-funcao", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data: todos } = await supabase
        .from("membros").select("id").eq("paroquia_id", pid!).eq("ativo", true);
      if (!todos?.length) return 0;
      const { data: comFuncao } = await supabase
        .from("membro_ministerios").select("membro_id").in("membro_id", todos.map((m) => m.id));
      const comSet = new Set((comFuncao ?? []).map((r) => r.membro_id));
      return todos.filter((m) => !comSet.has(m.id)).length;
    },
  });

  // ── Datas de escalas para cruzar com calendário litúrgico ───────────────────
  const { data: escalaDatas = [] } = useQuery<string[]>({
    queryKey: ["escalas-datas-60d", pid],
    enabled: !!pid,
    staleTime: 60_000,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em60 = format(addDays(new Date(), 60), "yyyy-MM-dd");
      const { data } = await supabase
        .from("escalas")
        .select("data")
        .eq("paroquia_id", pid!)
        .gte("data", hoje)
        .lte("data", em60)
        .neq("status", "arquivada");
      return (data ?? []).map((e) => e.data as string);
    },
  });

  // ── Alertas litúrgicos: solenidades e festas sem escala nos próximos 45 dias
  const alertasLiturgicos = useMemo(() => {
    const hoje = new Date();
    const hojeStr = format(hoje, "yyyy-MM-dd");
    const em45Str = format(addDays(hoje, 45), "yyyy-MM-dd");
    const escalaDatasSet = new Set(escalaDatas);
    return allDays
      .filter((d) => {
        const ds = format(d.date, "yyyy-MM-dd");
        return ds > hojeStr && ds <= em45Str && (d.rank === "solenidade" || d.rank === "festa");
      })
      .filter((d) => !escalaDatasSet.has(format(d.date, "yyyy-MM-dd")))
      .slice(0, 3)
      .map((d) => ({
        name: d.name,
        date: format(d.date, "yyyy-MM-dd"),
        rank: d.rank as "solenidade" | "festa",
        dias: Math.round((d.date.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)),
      }));
  }, [allDays, escalaDatas]);

  const { data: agendaItems = [] } = useQuery<AgendaEvent[]>({
    queryKey: ["dashboard-agenda", pid],
    enabled: !!pid,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const ate = format(addDays(new Date(), 14), "yyyy-MM-dd");

      const [escalaResult, formacaoResult] = await Promise.all([
        supabase
          .from("escalas")
          .select("id,titulo,data,hora_inicio,local,solene")
          .eq("paroquia_id", pid!)
          .gte("data", hoje)
          .lte("data", ate)
          .neq("status", "arquivada")
          .order("data")
          .order("hora_inicio"),
        anyDb
          .from("formacoes_eventos")
          .select("id,titulo,data_inicio,local,tipo")
          .eq("paroquia_id", pid)
          .eq("ativo", true)
          .gte("data_inicio", `${hoje}T00:00:00`)
          .lte(`${ate}T23:59:59`)
          .order("data_inicio"),
      ]);

      const escalas = (escalaResult.data ?? []).map((item: any) => ({
        id: item.id,
        tipo: "Escala" as const,
        titulo: item.titulo,
        data: item.data,
        hora: item.hora_inicio,
        local: item.local,
        cor: item.solene ? "#f59e0b" : "#ec4899",
      }));

      const formacoes = (formacaoResult.data ?? []).map((item: any) => ({
        id: item.id,
        tipo: "Formação" as const,
        titulo: item.titulo,
        data: item.data_inicio.slice(0, 10),
        hora: item.data_inicio.slice(11, 16),
        local: item.local,
        cor: "#3b82f6",
      }));

      return [...escalas, ...formacoes]
        .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
        .slice(0, 6);
    },
  });


  const groupedEscalas = useMemo(() => {
    const map = new Map<string, typeof proximasEscalas>();
    proximasEscalas.forEach((escala) => {
      const group = map.get(escala.data) ?? [];
      group.push(escala);
      map.set(escala.data, group);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([date, items]) => ({ date, items }));
  }, [proximasEscalas]);

  const primaryCelebration = todayCelebrations[0] ?? null;
  const secondaryCelebrations = todayCelebrations.slice(1, 4);

  // ── Liturgia do dia — fonte DB (tem precedência sobre o engine local) ─────────
  const { data: liturgiaDB } = useLiturgiaHoje();

  // ── Stats cards ───────────────────────────────────────────────────────────────
  const stats = [
    {
      label: "Membros ativos",
      value: totalMembros.toString(),
      icon: Users,
      hint: totalMembros === 0 ? "Cadastre membros" : "servidores",
      href: "/membros",
    },
    {
      label: "Escalas do mês",
      value: escalasDoMes.toString(),
      icon: Calendar,
      hint: format(new Date(), "MMMM", { locale: ptBR }),
      href: "/escalas",
    },
    {
      label: "Funções litúrgicas",
      value: totalMinisterios.toString(),
      icon: Sparkles,
      hint: totalMinisterios === 0 ? "Configure funções" : "funções ativas",
      href: "/configuracoes/paroquia",
    },
    {
      label: "Taxa de preenchimento",
      value: taxaPreenchimento !== null ? `${taxaPreenchimento}%` : "—",
      icon: Activity,
      hint: taxaPreenchimento === null ? "Sem escalas no mês" : "escalas do mês",
      href: "/escalas",
    },
  ];

  // ── Radar de saúde pastoral (score composto 0–100) ───────────────────────────
  const saudePastoral = useMemo(() => {
    const compPreenchimento = taxaPreenchimento ?? 0;
    const ociososRatio = totalMembros > 0 ? membrosOciosos.length / totalMembros : 0;
    const compAtividade = Math.max(0, Math.round((1 - ociososRatio) * 100));
    const totalUpcoming = proximasEscalas.length;
    const compPublicacao = totalUpcoming === 0 ? 50
      : Math.round((proximasEscalas.filter((e) => e.status === "publicada").length / totalUpcoming) * 100);
    const compConflitos = Math.max(0, 100 - conflitos.length * 25);
    const score = Math.min(100, Math.max(0, Math.round(
      0.40 * compPreenchimento + 0.30 * compAtividade + 0.15 * compPublicacao + 0.15 * compConflitos
    )));
    const label = score >= 90 ? "Excelente" : score >= 70 ? "Boa pastoral" : score >= 40 ? "Em desenvolvimento" : "Precisa atenção";
    const color = score >= 90 ? "text-emerald-600" : score >= 70 ? "text-blue-600" : score >= 40 ? "text-amber-600" : "text-red-600";
    const barColor = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-blue-500" : score >= 40 ? "bg-amber-400" : "bg-red-500";
    return { score, label, color, barColor, compPreenchimento, compAtividade, compPublicacao, compConflitos };
  }, [taxaPreenchimento, membrosOciosos.length, totalMembros, proximasEscalas, conflitos.length]);

  // ── Relatório mensal PDF ──────────────────────────────────────────────────────
  function gerarRelatorioMensal() {
    const mesLabel = format(new Date(), "MMMM 'de' yyyy", { locale: ptBR });
    const mesLabelUC = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);
    const emitidoEm = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    const nomeParoquia = paroquia?.nome ?? "Pastoral Litúrgica";

    const saudeColor = saudePastoral.score >= 90 ? "#16a34a" : saudePastoral.score >= 70 ? "#2563eb" : saudePastoral.score >= 40 ? "#d97706" : "#dc2626";
    const saudeBar = saudePastoral.score >= 90 ? "#22c55e" : saudePastoral.score >= 70 ? "#3b82f6" : saudePastoral.score >= 40 ? "#f59e0b" : "#ef4444";

    const topMembrosRows = topMembrosRaw.slice(0, 10).map((m, i) =>
      `<tr><td class="rank">${i + 1}</td><td>${m.nome}</td><td class="num">${m.score} pts</td></tr>`
    ).join("");

    const novosRows = membrosNovos.length === 0
      ? `<p class="empty">Todos os membros novos já foram escalados.</p>`
      : membrosNovos.map((m) => `<li>${m.nome}</li>`).join("");

    const proximasRows = proximasEscalas.slice(0, 10).map((e) => {
      const d = new Date(e.data + "T00:00:00");
      const st = e.status === "publicada" ? "Publicada" : e.status === "rascunho" ? "Rascunho" : "Arquivada";
      const stColor = e.status === "publicada" ? "#16a34a" : "#64748b";
      return `<tr>
        <td>${format(d, "dd/MM/yyyy", { locale: ptBR })}</td>
        <td>${e.titulo}</td>
        <td>${e.hora_inicio ? e.hora_inicio.slice(0, 5) : "—"}</td>
        <td style="color:${stColor};font-weight:600">${st}</td>
      </tr>`;
    }).join("");

    const alertasItems = [
      conflitos.length > 0 ? `<li><strong>${conflitos.length} conflito(s)</strong> de indisponibilidade nos próximos 7 dias</li>` : "",
      escalasIncompletas.length > 0 ? `<li><strong>${escalasIncompletas.length} escala(s) incompleta(s)</strong> nos próximos 14 dias</li>` : "",
      membrosOciosos.length > 0 ? `<li><strong>${membrosOciosos.length} membro(s)</strong> há mais de 20 dias sem servir</li>` : "",
      membrosSemFuncao > 0 ? `<li><strong>${membrosSemFuncao} membro(s)</strong> sem função atribuída</li>` : "",
    ].filter(Boolean).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório Mensal — ${nomeParoquia}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#0f172a;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header{padding:28px 40px 22px;border-bottom:2px solid #0f172a;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:28px}
  .paroquia-nome{font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;line-height:1.1}
  .subtitle{font-size:11px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:.1em;margin-top:4px}
  .emit{font-size:10px;color:#94a3b8;text-align:right}
  .content{padding:0 40px 40px}
  .section{margin-bottom:28px}
  .section-title{font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:700;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
  .saude-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 22px;display:flex;align-items:center;gap:28px}
  .saude-score{font-family:'Playfair Display',Georgia,serif;font-size:52px;font-weight:700;line-height:1;color:${saudeColor}}
  .saude-label{font-size:13px;font-weight:600;color:${saudeColor};margin-top:4px}
  .saude-bar-bg{height:8px;background:#e2e8f0;border-radius:99px;width:180px;margin-top:10px}
  .saude-bar{height:8px;background:${saudeBar};border-radius:99px;width:${saudePastoral.score}%}
  .saude-comps{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-size:11.5px;color:#475569}
  .saude-comps span{font-weight:700;color:#0f172a}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .kpi-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center}
  .kpi-val{font-size:26px;font-weight:700;font-family:'Playfair Display',Georgia,serif;line-height:1}
  .kpi-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;padding:6px 8px;border-bottom:2px solid #e2e8f0}
  td{padding:7px 8px;border-bottom:1px solid #f1f5f9;color:#0f172a}
  tr:last-child td{border-bottom:none}
  .rank{font-weight:700;color:#94a3b8;width:30px}
  .num{text-align:right;font-weight:700}
  ul{padding-left:18px;space-y:4px}
  li{margin-bottom:4px}
  .empty{color:#94a3b8;font-style:italic;font-size:12px}
  .alert-box{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px}
  .alert-box ul{color:#92400e}
  .ok-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;color:#15803d;font-style:italic;font-size:12px}
  .footer{border-top:1px solid #e2e8f0;margin-top:28px;padding:14px 40px;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}
  @media print{body{font-size:12px}.header{padding:20px 28px 18px}.content{padding:0 28px 28px}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="paroquia-nome">${nomeParoquia}</div>
    <div class="subtitle">Pastoral Litúrgica · Relatório Mensal — ${mesLabelUC}</div>
  </div>
  <div class="emit">Emitido em ${emitidoEm}</div>
</div>
<div class="content">

  <div class="section">
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-val">${totalMembros}</div><div class="kpi-lbl">Membros ativos</div></div>
      <div class="kpi-box"><div class="kpi-val">${escalasDoMes}</div><div class="kpi-lbl">Escalas no mês</div></div>
      <div class="kpi-box"><div class="kpi-val">${taxaPreenchimento !== null ? taxaPreenchimento + "%" : "—"}</div><div class="kpi-lbl">Preenchimento</div></div>
      <div class="kpi-box"><div class="kpi-val">${totalMinisterios}</div><div class="kpi-lbl">Funções ativas</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Saúde da Pastoral</div>
    <div class="saude-box">
      <div>
        <div class="saude-score">${saudePastoral.score}</div>
        <div class="saude-label">${saudePastoral.label}</div>
        <div class="saude-bar-bg"><div class="saude-bar"></div></div>
      </div>
      <div class="saude-comps">
        <div>Preenchimento <span>${saudePastoral.compPreenchimento}%</span></div>
        <div>Atividade <span>${saudePastoral.compAtividade}%</span></div>
        <div>Publicação <span>${saudePastoral.compPublicacao}%</span></div>
        <div>Conflitos <span>${saudePastoral.compConflitos}%</span></div>
      </div>
    </div>
  </div>

  ${topMembrosRaw.length > 0 ? `
  <div class="section">
    <div class="section-title">Participação por Servidor (Top 10)</div>
    <table><thead><tr><th>#</th><th>Nome</th><th style="text-align:right">Pontuação</th></tr></thead>
    <tbody>${topMembrosRows}</tbody></table>
  </div>` : ""}

  ${proximasEscalas.length > 0 ? `
  <div class="section">
    <div class="section-title">Próximas Escalas</div>
    <table><thead><tr><th>Data</th><th>Título</th><th>Hora</th><th>Status</th></tr></thead>
    <tbody>${proximasRows}</tbody></table>
  </div>` : ""}

  ${membrosNovos.length > 0 ? `
  <div class="section">
    <div class="section-title">Membros Novos sem Escala</div>
    <ul>${novosRows}</ul>
  </div>` : ""}

  <div class="section">
    <div class="section-title">Pontos de Atenção</div>
    ${alertasItems ? `<div class="alert-box"><ul>${alertasItems}</ul></div>` : `<div class="ok-box">Nenhum ponto de atenção identificado este mês.</div>`}
  </div>

</div>
<div class="footer">
  <span>${nomeParoquia} — Pastoral Litúrgica</span>
  <span>Gerado em ${emitidoEm}</span>
</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => { win.focus(); win.print(); }, 600); }
  }

  // ── Queries e mutation para substituição de membro conflitado ────────────────
  const { data: substitutosCandidatos = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["substitutos", substituicaoTarget?.escalaId, substituicaoTarget?.ministerioId, substituicaoTarget?.data],
    enabled: !!substituicaoTarget,
    queryFn: async () => {
      if (!substituicaoTarget) return [];
      const { escalaId, ministerioId, data } = substituicaoTarget;
      const [mmRes, jaEscaladosRes, indispRes] = await Promise.all([
        supabase.from("membro_ministerios").select("membro_id").eq("ministerio_id", ministerioId),
        supabase.from("escala_membros").select("membro_id").eq("escala_id", escalaId),
        supabase.from("indisponibilidades").select("membro_id").eq("data", data),
      ]);
      const candidatos = new Set((mmRes.data ?? []).map((r) => r.membro_id));
      const jaEscalados = new Set((jaEscaladosRes.data ?? []).map((r) => r.membro_id));
      const indisponiveis = new Set((indispRes.data ?? []).map((r) => r.membro_id));
      const ids = [...candidatos].filter((id) => !jaEscalados.has(id) && !indisponiveis.has(id));
      if (ids.length === 0) return [];
      const { data: membrosData } = await supabase.from("membros").select("id, nome").in("id", ids).eq("ativo", true).order("nome");
      return (membrosData ?? []) as { id: string; nome: string }[];
    },
  });

  const substituirMutation = useMutation({
    mutationFn: async (novoMembroId: string) => {
      if (!substituicaoTarget) return;
      const { atribuicaoId, escalaId, ministerioId } = substituicaoTarget;
      await supabase.from("escala_membros").delete().eq("id", atribuicaoId);
      await (supabase as any).from("escala_membros").insert({
        escala_id: escalaId,
        membro_id: novoMembroId,
        ministerio_id: ministerioId,
        status: "pendente",
      });
    },
    onSuccess: () => {
      qcDash.invalidateQueries({ queryKey: ["insights-conflitos"] });
      qcDash.invalidateQueries({ queryKey: ["escalas-counts"] });
      qcDash.invalidateQueries({ queryKey: ["pm-escalas"] });
      setSubstituicaoTarget(null);
      toast.success("Membro substituído com sucesso.");
    },
    onError: () => toast.error("Erro ao substituir membro."),
  });

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto space-y-6 pb-24 lg:pb-10">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Painel pastoral</p>
            <h1 className="mt-2 font-serif text-2xl sm:text-4xl text-foreground truncate">{paroquia?.nome ?? "Sua paróquia"}</h1>
            {paroquia?.diocese && (
              <p className="mt-1 text-sm text-muted-foreground truncate">{paroquia.diocese}</p>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-border/70 bg-card shadow-altar overflow-hidden">
        <div className="p-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Painel litúrgico</p>
              <h2 className="mt-2 text-3xl font-serif text-foreground">
                {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                {primaryCelebration
                  ? primaryCelebration.name
                  : "Feria — sem celebração especial registrada."}
              </p>
            </div>
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-muted/70 px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground shrink-0">
              <span className={`h-2.5 w-2.5 rounded-full ${VESTMENT_DOT[todayColor]}`} />
              {`${VESTMENT_LABEL[todayColor]} · ${SEASON_LABELS[season] ?? season}`}
            </div>
          </div>

          {secondaryCelebrations.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {secondaryCelebrations.map((item) => (
                <div key={item.name} className="rounded-3xl border border-border bg-background p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Santo do dia</p>
                  <p className="mt-2 font-semibold text-sm text-foreground truncate">{item.name}</p>
                  {item.rank && <p className="mt-1 text-xs text-muted-foreground">{item.rank}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Link para leituras completas em /espiritualidade */}
          <Link
            to="/espiritualidade"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition group"
          >
            <BookOpen className="h-3 w-3" />
            Ver leituras do dia
            <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </section>

      {/* ── Saúde da pastoral — ACIMA dos KPIs (informação de diagnóstico mais útil) ── */}
      <div className="rounded-3xl border border-border bg-card shadow-altar p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold">Saúde da pastoral</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">Índice composto das últimas 4 semanas</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0 rounded-xl" onClick={gerarRelatorioMensal}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />Relatório
          </Button>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground sr-only">Saúde da pastoral</p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className={`text-5xl font-serif ${saudePastoral.color}`}>{saudePastoral.score}</span>
              <span className="text-muted-foreground text-sm">/100</span>
              <span className={`text-sm font-semibold ${saudePastoral.color}`}>{saudePastoral.label}</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden w-full max-w-xs">
              <div
                className={`h-full rounded-full transition-all duration-700 ${saudePastoral.barColor}`}
                style={{ width: `${saudePastoral.score}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span>Preenchimento</span>
              <span className="font-semibold text-foreground">{saudePastoral.compPreenchimento}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Atividade</span>
              <span className="font-semibold text-foreground">{saudePastoral.compAtividade}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Publicação</span>
              <span className="font-semibold text-foreground">{saudePastoral.compPublicacao}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Conflitos</span>
              <span className="font-semibold text-foreground">{saudePastoral.compConflitos}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Alertas urgentes — só aparece quando há itens críticos ── */}
      {(conflitos.length > 0 || escalasIncompletas.length > 0 || alertasLiturgicos.length > 0) && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-200/60 dark:border-amber-800/60">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
              Precisa de atenção
            </p>
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
              {conflitos.length + escalasIncompletas.length + alertasLiturgicos.length}
            </span>
          </div>
          <div className="divide-y divide-amber-200/50 dark:divide-amber-800/40">
            {escalasIncompletas.slice(0, 2).map((e) => (
              <Link
                key={e.id}
                to="/escalas"
                search={{ abrir: e.id } as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <CalendarOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-red-600 font-semibold">{e.abertas} vaga{e.abertas !== 1 ? "s" : ""} em aberto</span>
                    {" — "}{e.titulo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(e.data + "T00:00:00"), "d 'de' MMMM", { locale: ptBR })}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition" />
              </Link>
            ))}
            {conflitos.slice(0, 2).map((c) => (
              <div key={`${c.membroNome}-${c.data}`} className="flex items-center gap-3 px-4 py-3">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    Conflito: <span className="font-semibold">{c.membroNome}</span> em {format(new Date(c.data + "T00:00:00"), "d/MM", { locale: ptBR })}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{c.escalaTitulo}</p>
                </div>
                <button
                  onClick={() => setSubstituicaoTarget({ escalaId: c.escalaId, atribuicaoId: c.atribuicaoId, ministerioId: c.ministerioId, membroNome: c.membroNome, data: c.data })}
                  className="text-xs font-semibold text-primary hover:underline shrink-0"
                >
                  Substituir
                </button>
              </div>
            ))}
            {alertasLiturgicos.slice(0, 1).map((a) => (
              <Link
                key={a.date}
                to="/escalas"
                search={{} as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <CalendarRange className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {a.rank === "solenidade" ? "Solenidade" : "Festa"} sem escala em{" "}
                    <span className="font-semibold">{a.dias} dia{a.dias !== 1 ? "s" : ""}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{a.name}</p>
                </div>
                <span className="text-xs font-semibold text-primary shrink-0 group-hover:underline">
                  Criar escala →
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <DashboardMetricCard
            key={item.label}
            label={item.label}
            value={item.value}
            hint={item.hint}
            href={item.href}
            icon={item.icon}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-border bg-card shadow-altar overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5 border-b border-border">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Próximas Escalas</p>
                <h2 className="mt-2 font-serif text-xl">Escalas agrupadas por data</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/escalas" search={{}}>Ver todas <ChevronRight className="h-4 w-4" /></Link>
              </Button>
            </div>
            {groupedEscalas.length === 0 ? (
              <div className="p-8 text-center">
                <Calendar className="h-6 w-6 mx-auto text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Nenhuma escala futura encontrada.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {groupedEscalas.map((group) => (
                  <div key={group.date} className="px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                          {format(new Date(group.date + "T00:00:00"), "EEEE, d 'de' MMM", { locale: ptBR })}
                        </p>
                        <p className="mt-2 text-sm text-foreground">
                          {group.items.length} escala{group.items.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {group.items.map((e) => {
                        const cfg = STATUS_CONFIG[e.status] ?? STATUS_CONFIG.rascunho;
                        return (
                          <div key={e.id} className="rounded-3xl border border-border bg-background p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{e.titulo}</p>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {e.hora_inicio && <span>{e.hora_inicio.slice(0, 5)}</span>}
                                  {e.local && <span>{e.local}</span>}
                                </div>
                              </div>
                              <Badge variant={cfg.variant} className="text-[11px] uppercase">
                                {cfg.label}
                              </Badge>
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

          <div className="rounded-3xl border border-border bg-card shadow-altar p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Agenda rápida</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">Próximos eventos</h2>
              </div>
              <CalendarRange className="h-6 w-6 text-primary" />
            </div>
            <div className="mt-5 space-y-3">
              {agendaItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum evento agendado para as próximas duas semanas.</p>
              ) : (
                agendaItems.slice(0, 5).map((event) => (
                  <div key={event.id} className="rounded-3xl border border-border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{event.titulo}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(event.data + "T00:00:00"), "d MMM", { locale: ptBR })}
                          {event.hora ? ` · ${event.hora}` : ""}
                        </p>
                      </div>
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-primary">
                        {event.tipo}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <InsightsPanel
            membrosOciosos={membrosOciosos}
            membrosNovos={membrosNovos}
            conflitos={conflitos}
            escalasIncompletas={escalasIncompletas}
            membrosSemFuncao={membrosSemFuncao}
            funcoesSemMembros={funcaoDistrib.filter((f) => f.membros === 0)}
            alertasLiturgicos={alertasLiturgicos}
            onSugerirSubstituto={setSubstituicaoTarget}
          />

          <div className="rounded-3xl border border-border bg-card shadow-altar p-5">
            <div className="mb-4 flex items-center gap-3">
              <Cake className="h-5 w-5 text-pink-500 shrink-0" />
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Aniversariantes</p>
              {aniversariantesHoje.length > 0 && (
                <span className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-pink-500 text-white text-[10px] font-bold">
                  {aniversariantesHoje.length}
                </span>
              )}
            </div>
            <Tabs value={anivTab} onValueChange={(v) => setAnivTab(v as typeof anivTab)}>
              <TabsList className="w-full mb-4">
                <TabsTrigger value="hoje" className="flex-1 text-xs">
                  Hoje{aniversariantesHoje.length > 0 ? ` (${aniversariantesHoje.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="semana" className="flex-1 text-xs">
                  Semana{aniversariantesSemana.length > 0 ? ` (${aniversariantesSemana.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="mes" className="flex-1 text-xs">
                  Mês{aniversariantes.length > 0 ? ` (${aniversariantes.length})` : ""}
                </TabsTrigger>
              </TabsList>

              {(["hoje", "semana", "mes"] as const).map((tab) => {
                const lista =
                  tab === "hoje"   ? aniversariantesHoje :
                  tab === "semana" ? aniversariantesSemana :
                  aniversariantes;
                return (
                  <TabsContent key={tab} value={tab} className="mt-0 space-y-2">
                    {lista.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {tab === "hoje"   ? "Nenhum aniversariante hoje." :
                         tab === "semana" ? "Nenhum aniversariante esta semana." :
                         "Nenhum aniversariante este mês."}
                      </p>
                    ) : (
                      lista.slice(0, 5).map((m) => {
                        const dia = new Date(m.data_nascimento + "T12:00:00").getDate();
                        const mes = new Date(m.data_nascimento + "T12:00:00").toLocaleString("pt-BR", { month: "short" });
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between rounded-3xl border border-border bg-background px-4 py-3"
                          >
                            <p className="font-medium truncate text-sm">{m.nome}</p>
                            <span className="text-xs text-muted-foreground shrink-0 ml-2">
                              {tab === "mes" ? `${dia} ${mes}` : `Dia ${dia}`}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h2 className="font-serif text-lg mb-1">Participação por membro</h2>
          <p className="text-xs text-muted-foreground mb-5">Top 10 servidores por pontuação acumulada</p>
          {topMembros.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-muted-foreground">Sem dados de participação ainda.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topMembros} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="nome"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} name="Score">
                  {topMembros.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === 0 ? "hsl(var(--primary))" : `hsl(var(--primary) / ${Math.max(0.25, 1 - i * 0.08)})`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h2 className="font-serif text-lg mb-1">Distribuição de funções</h2>
          <p className="text-xs text-muted-foreground mb-5">Membros atribuídos por função litúrgica</p>
          {funcaoDistrib.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-muted-foreground">Nenhuma função configurada ainda.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funcaoDistrib} margin={{ left: 0, right: 8, top: 0, bottom: 32 }}>
                <XAxis
                  dataKey="nome"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="membros" radius={[4, 4, 0, 0]} name="Membros">
                  {funcaoDistrib.map((entry, i) => (
                    <Cell key={i} fill={entry.cor ?? "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Dialog substituição de membro ─────────────────────────────────── */}
      <Dialog open={!!substituicaoTarget} onOpenChange={(o) => { if (!o) setSubstituicaoTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sugerir substituto</DialogTitle>
          </DialogHeader>
          <div className="py-1 space-y-3">
            <p className="text-sm text-muted-foreground">
              Substituir <strong>{substituicaoTarget?.membroNome}</strong> por um membro disponível no mesmo grupo e data.
            </p>
            {!substituicaoTarget ? null : substitutosCandidatos.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">Nenhum substituto disponível no grupo para esta data.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {substitutosCandidatos.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                    <span className="text-sm font-medium">{m.nome}</span>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={substituirMutation.isPending}
                      onClick={() => substituirMutation.mutate(m.id)}
                    >
                      {substituirMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Substituir
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubstituicaoTarget(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── InsightsPanel ─────────────────────────────────────────────────────────────

type InsightItem = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  iconCls: string;
  label: string;
  desc: string;
  href: string;
  hrefSearch?: Record<string, string>;
  severity: "info" | "warning" | "danger";
  borderColor: string;
  actionLabel?: string;
  onAction?: () => void;
};

function InsightsPanel({
  membrosOciosos, membrosNovos, conflitos, escalasIncompletas,
  membrosSemFuncao, funcoesSemMembros, alertasLiturgicos, onSugerirSubstituto,
}: {
  membrosOciosos: { id: string; nome: string }[];
  membrosNovos: { id: string; nome: string }[];
  conflitos: { escalaId: string; escalaTitulo: string; membroId: string; membroNome: string; atribuicaoId: string; ministerioId: string; data: string }[];
  escalasIncompletas: { id: string; titulo: string; data: string; abertas: number; vagas: number }[];
  membrosSemFuncao: number;
  funcoesSemMembros: { nome: string }[];
  alertasLiturgicos: { name: string; date: string; rank: "solenidade" | "festa"; dias: number }[];
  onSugerirSubstituto: (t: SubstituicaoTarget) => void;
}) {
  const insights: InsightItem[] = [];

  alertasLiturgicos.forEach((a) => {
    insights.push({
      id: `liturgico-${a.date}`,
      icon: a.rank === "solenidade" ? CalendarRange : Calendar,
      iconCls: a.rank === "solenidade" ? "text-amber-600" : "text-blue-500",
      borderColor: a.rank === "solenidade" ? "#d97706" : "#3b82f6",
      label: `${a.rank === "solenidade" ? "Solenidade" : "Festa"}: ${a.name}`,
      desc: `Em ${a.dias} dia${a.dias !== 1 ? "s" : ""} — nenhuma escala criada para essa data.`,
      href: "/escalas",
      hrefSearch: {},
      severity: a.rank === "solenidade" ? "warning" : "info",
    });
  });

  escalasIncompletas.slice(0, 3).forEach((e) => {
    insights.push({
      id: `incompleta-${e.id}`, icon: CalendarOff, iconCls: "text-red-500", borderColor: "#ef4444",
      label: `Escala "${e.titulo}" incompleta`,
      desc: `${e.abertas} vaga${e.abertas !== 1 ? "s" : ""} em aberto — ${format(new Date(e.data + "T00:00:00"), "d/MM", { locale: ptBR })}`,
      href: "/escalas", hrefSearch: { abrir: e.id }, severity: "danger",
    });
  });

  conflitos.slice(0, 2).forEach((c) => {
    insights.push({
      id: `conflito-${c.membroNome}-${c.data}`, icon: AlertTriangle, iconCls: "text-amber-500", borderColor: "#f59e0b",
      label: `Conflito: ${c.membroNome}`,
      desc: `Escalado em "${c.escalaTitulo}" mas tem indisponibilidade em ${format(new Date(c.data + "T00:00:00"), "d/MM", { locale: ptBR })}`,
      href: "/escalas", hrefSearch: { abrir: c.escalaId }, severity: "warning",
      actionLabel: "Substituir",
      onAction: () => onSugerirSubstituto({ escalaId: c.escalaId, atribuicaoId: c.atribuicaoId, ministerioId: c.ministerioId, membroNome: c.membroNome, data: c.data }),
    });
  });

  if (membrosOciosos.length > 0) {
    insights.push({
      id: "ociosos", icon: UserX, iconCls: "text-blue-500", borderColor: "#3b82f6",
      label: `${membrosOciosos.length} membro${membrosOciosos.length !== 1 ? "s" : ""} há mais de 20 dias sem servir`,
      desc: membrosOciosos.slice(0, 3).map((m) => m.nome.split(" ")[0]).join(", ") + (membrosOciosos.length > 3 ? "…" : ""),
      href: "/membros",
      hrefSearch: membrosOciosos.length === 1 ? { abrir: membrosOciosos[0].id } : undefined,
      severity: "info",
    });
  }

  if (membrosNovos.length > 0) {
    insights.push({
      id: "novos-sem-escala", icon: UserCheck, iconCls: "text-emerald-500", borderColor: "#22c55e",
      label: `${membrosNovos.length} membro${membrosNovos.length !== 1 ? "s" : ""} novo${membrosNovos.length !== 1 ? "s" : ""} ainda sem escala`,
      desc: membrosNovos.slice(0, 3).map((m) => m.nome.split(" ")[0]).join(", "),
      href: "/membros",
      hrefSearch: membrosNovos.length === 1 ? { abrir: membrosNovos[0].id } : undefined,
      severity: "info",
    });
  }

  if (membrosSemFuncao > 0) {
    insights.push({
      id: "sem-funcao", icon: Users, iconCls: "text-orange-500", borderColor: "#f97316",
      label: `${membrosSemFuncao} membro${membrosSemFuncao !== 1 ? "s" : ""} sem função atribuída`,
      desc: "Não aparecem nas sugestões do motor de escalas.",
      href: "/membros", severity: "warning",
    });
  }

  funcoesSemMembros.slice(0, 2).forEach((f) => {
    insights.push({
      id: `funcao-${f.nome}`, icon: Sparkles, iconCls: "text-purple-500", borderColor: "#8b5cf6",
      label: `Função "${f.nome}" sem membros`,
      desc: "Atribua membros em Membros → editar perfil.",
      href: "/membros", severity: "warning",
    });
  });

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
      <div className="p-5 border-b border-border flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-xl">Insights</h2>
        {insights.length > 0 && (
          <span className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
            {insights.length}
          </span>
        )}
      </div>

      {insights.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
          <p className="text-sm font-semibold text-emerald-700">Tudo em ordem!</p>
          <p className="text-xs text-muted-foreground mt-1">Nenhuma atenção necessária no momento.</p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-y-auto max-h-[420px]">
          {insights.map((ins) => {
            const Icon = ins.icon;
            if (ins.onAction) {
              return (
                <div
                  key={ins.id}
                  className="flex items-start gap-3 px-4 py-3.5 border-l-4 border-b border-border/40"
                  style={{ borderLeftColor: ins.borderColor }}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${ins.iconCls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{ins.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{ins.desc}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0 mt-0.5">
                    <button
                      onClick={ins.onAction}
                      className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                    >
                      {ins.actionLabel}
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <Link to={ins.href as any} search={ins.hrefSearch as any} className="text-xs text-muted-foreground hover:underline whitespace-nowrap">
                      Ver
                    </Link>
                  </div>
                </div>
              );
            }
            return (
              <Link
                key={ins.id}
                to={ins.href as any}
                search={ins.hrefSearch as any}
                className="flex items-start gap-3 px-4 py-3.5 border-l-4 hover:bg-muted/30 transition block"
                style={{ borderLeftColor: ins.borderColor }}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${ins.iconCls}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{ins.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{ins.desc}</p>
                </div>
              </Link>
            );
          })}
          <div className="px-5 py-3">
            <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
              <Link to="/notificacoes">Central de notificações <ChevronRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
