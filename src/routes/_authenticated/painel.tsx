import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Calendar, CalendarRange, Users, Sparkles, Activity, ChevronRight,
  AlertTriangle, Cake, CheckCircle2, UserX, UserCheck,
  CalendarOff, Zap, Loader2, FileText, BookOpen, ClipboardList,
  TrendingUp, ArrowLeftRight, Clock, HandHelping, ChevronDown,
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
type CandidaturaTarget = { escalaId: string; ministerioId: string; titulo: string; data: string; hora_inicio: string | null; ministerio_nome: string };

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
  status?: string;
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
  const { profile, hasAdminAccess, isAdmin, isCoordenador } = useAuth();
  const isCoord = isAdmin || isCoordenador;
  const pid = profile?.paroquia_id;
  const [showSecondary, setShowSecondary] = useState(false);

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
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("paroquias").select("nome, diocese").eq("id", pid!).maybeSingle();
      return data;
    },
  });

  const { data: totalMembros = 0, isLoading: loadingStats } = useQuery({
    queryKey: ["stats-membros", pid],
    enabled: !!pid,
    staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
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
    staleTime: 3 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
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
    enabled: showSecondary && !!pid,
    staleTime: 5 * 60 * 1000,
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
    staleTime: 3 * 60 * 1000,
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
    staleTime: 3 * 60 * 1000,
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
  const { data: topMembrosRaw = [] } = useRankingTop(showSecondary ? pid ?? undefined : undefined, 10);
  // Formata para o gráfico (primeiro nome + score)
  const topMembros = topMembrosRaw.map((m) => ({
    nome: m.nome.split(" ")[0],
    score: m.score,
  }));

  // ── BI: Distribuição de funções ───────────────────────────────────────────────
  const { data: funcaoDistrib = [] } = useQuery({
    queryKey: ["stats-funcao-distrib", pid],
    enabled: showSecondary && !!pid,
    staleTime: 10 * 60 * 1000,
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

  // ── Stats: distribuição de membros por pastoral / sexo / faixa etária ─────────
  const { data: memberStats } = useQuery({
    queryKey: ["stats-membros-distrib", pid],
    enabled: showSecondary && !!pid,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [{ data: mbs }, { data: atuacoes }, { data: matuacoes }] = await Promise.all([
        supabase.from("membros").select("id, sexo, data_nascimento").eq("paroquia_id", pid!).eq("ativo", true),
        anyDb.from("atuacoes_pastorais").select("id, nome, cor").eq("paroquia_id", pid!).eq("ativo", true).order("ordem"),
        anyDb.from("membro_atuacoes").select("membro_id, atuacao_id"),
      ]);

      // By sex
      const sc: Record<string, number> = { M: 0, F: 0 };
      (mbs ?? []).forEach((m: { sexo: string | null }) => { if (m.sexo === "M") sc.M++; else if (m.sexo === "F") sc.F++; });
      const bySex = [
        { nome: "Masculino", membros: sc.M, cor: "#3b82f6" },
        { nome: "Feminino",  membros: sc.F, cor: "#ec4899" },
      ].filter((x) => x.membros > 0);

      // By age
      const now = new Date();
      const ag: Record<string, number> = { "<18": 0, "18–29": 0, "30–44": 0, "45–59": 0, "60+": 0 };
      (mbs ?? []).forEach((m: { data_nascimento: string | null }) => {
        if (!m.data_nascimento) return;
        const age = now.getFullYear() - new Date(m.data_nascimento + "T12:00:00").getFullYear();
        if (age < 18) ag["<18"]++;
        else if (age < 30) ag["18–29"]++;
        else if (age < 45) ag["30–44"]++;
        else if (age < 60) ag["45–59"]++;
        else ag["60+"]++;
      });
      const byAge = Object.entries(ag).filter(([, v]) => v > 0).map(([nome, membros]) => ({ nome, membros }));

      // By pastoral
      const ids = new Set((mbs ?? []).map((m: { id: string }) => m.id));
      const ac: Record<string, number> = {};
      (matuacoes ?? []).filter((r: { membro_id: string }) => ids.has(r.membro_id)).forEach((r: { atuacao_id: string }) => {
        ac[r.atuacao_id] = (ac[r.atuacao_id] ?? 0) + 1;
      });
      const byPastoral = (atuacoes ?? [])
        .map((a: { id: string; nome: string; cor: string }) => ({ nome: a.nome, membros: ac[a.id] ?? 0, cor: a.cor }))
        .filter((x: { membros: number }) => x.membros > 0)
        .sort((a: { membros: number }, b: { membros: number }) => b.membros - a.membros);

      return { bySex, byAge, byPastoral };
    },
  });

  // ── Aniversariantes do mês ───────────────────────────────────────────────────
  const mesAtual = today.getMonth() + 1;
  const { data: aniversariantes = [] } = useQuery<{ id: string; nome: string; data_nascimento: string }[]>({
    queryKey: ["aniversariantes", pid, mesAtual],
    enabled: showSecondary && !!pid,
    staleTime: 60 * 60 * 1000,
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
  const [candidaturaTarget, setCandidaturaTarget] = useState<CandidaturaTarget | null>(null);
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
    enabled: showSecondary && !!pid,
    staleTime: 10 * 60 * 1000,
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
    enabled: showSecondary && !!pid,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const ate = format(addDays(new Date(), 14), "yyyy-MM-dd");

      const [escalaResult, formacaoResult] = await Promise.all([
        supabase
          .from("escalas")
          .select("id,titulo,data,hora_inicio,local,solene,status")
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
        cor: item.solene ? "#f59e0b" : "#6366f1",
        status: item.status,
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
        .slice(0, 10);
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

  // ── Escalas com presenças pendentes (últimos 14 dias) ────────────────────────
  const { data: escalasPresencaPendente = [] } = useQuery<{ id: string; titulo: string; data: string; pendentes: number }[]>({
    queryKey: ["insights-presenca-pendente", pid],
    enabled: !!pid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em14Atras = format(addDays(new Date(), -14), "yyyy-MM-dd");
      const { data: escalas } = await supabase
        .from("escalas")
        .select("id, titulo, data")
        .eq("paroquia_id", pid!)
        .lt("data", hoje)
        .gte("data", em14Atras)
        .eq("status", "publicada");
      if (!escalas?.length) return [];
      const ids = escalas.map((e) => e.id);
      const { data: membros } = await supabase
        .from("escala_membros")
        .select("escala_id, status")
        .in("escala_id", ids);
      const pendentesCount: Record<string, number> = {};
      (membros ?? []).forEach((m) => {
        if (m.status === "pendente" || m.status === "confirmado") {
          pendentesCount[m.escala_id] = (pendentesCount[m.escala_id] ?? 0) + 1;
        }
      });
      return escalas
        .filter((e) => (pendentesCount[e.id] ?? 0) > 0)
        .map((e) => ({ ...e, pendentes: pendentesCount[e.id] ?? 0 }))
        .slice(0, 3);
    },
  });

  // ── Presença do mês atual ─────────────────────────────────────────────────────
  const { data: presencaMes } = useQuery<{ presente: number; faltou: number; atraso: number; justificou: number; total: number } | null>({
    queryKey: ["stats-presenca-mes", pid],
    enabled: showSecondary && !!pid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const inicio = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
      const hoje = format(now, "yyyy-MM-dd");
      const { data: esc } = await supabase
        .from("escalas")
        .select("id")
        .eq("paroquia_id", pid!)
        .eq("status", "publicada")
        .gte("data", inicio)
        .lt("data", hoje);
      if (!esc?.length) return null;
      const ids = esc.map((e) => e.id);
      const { data } = await supabase
        .from("escala_membros")
        .select("status")
        .in("escala_id", ids)
        .in("status", ["presente", "faltou", "atrasado", "justificou"]);
      const counts = { presente: 0, faltou: 0, atraso: 0, justificou: 0, total: 0 };
      (data ?? []).forEach((r) => {
        const s = r.status;
        if (s === "presente")   { counts.presente++;  counts.total++; }
        else if (s === "faltou")     { counts.faltou++;   counts.total++; }
        else if (s === "atrasado")   { counts.atraso++;   counts.total++; }
        else if (s === "justificou") { counts.justificou++; counts.total++; }
      });
      return counts.total > 0 ? counts : null;
    },
  });

  // ── Confirmações pendentes (próximos 7 dias, publicadas) ──────────────────────
  const { data: confirmacoesPendentes = 0 } = useQuery<number>({
    queryKey: ["stats-confirmacoes-pendentes", pid],
    enabled: !!pid,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
      const { data: esc } = await supabase
        .from("escalas")
        .select("id")
        .eq("paroquia_id", pid!)
        .eq("status", "publicada")
        .gte("data", hoje)
        .lte("data", em7);
      if (!esc?.length) return 0;
      const { count } = await supabase
        .from("escala_membros")
        .select("*", { count: "exact", head: true })
        .in("escala_id", esc.map((e) => e.id))
        .eq("status", "pendente");
      return count ?? 0;
    },
  });

  // ── Escalas futuras em rascunho ───────────────────────────────────────────────
  const { data: escalasRascunhoCount = 0 } = useQuery<number>({
    queryKey: ["stats-rascunhos-futuros", pid],
    enabled: !!pid,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      const { count } = await supabase
        .from("escalas")
        .select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!)
        .eq("status", "rascunho")
        .gte("data", format(new Date(), "yyyy-MM-dd"));
      return count ?? 0;
    },
  });

  // ── Membros sem conta ativada (coord only) ────────────────────────────────────
  const { data: membrosNaoAtivados = 0 } = useQuery<number>({
    queryKey: ["stats-nao-ativados", pid],
    enabled: !!pid && isCoord,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { count } = await anyDb
        .from("membros")
        .select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!)
        .eq("ativo", true)
        .eq("conta_ativada", false);
      return count ?? 0;
    },
  });

  // ── Indisponibilidades ativas (próximos 30 dias) ──────────────────────────────
  const { data: indispAtivasCount = 0 } = useQuery<number>({
    queryKey: ["stats-indisp-ativas", pid],
    enabled: !!pid && isCoord,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const em30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const { count } = await anyDb
        .from("indisponibilidades")
        .select("*", { count: "exact", head: true })
        .eq("paroquia_id", pid!)
        .eq("cancelada", false)
        .gte("data", hoje)
        .lte("data", em30);
      return count ?? 0;
    },
  });

  // ── Substituições pendentes ───────────────────────────────────────────────────
  const { data: substituicoesPendentesCount = 0 } = useQuery<number>({
    queryKey: ["stats-substituicoes-pendentes", pid],
    enabled: !!pid,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      const { count } = await anyDb
        .from("substituicoes")
        .select("*", { count: "exact", head: true })
        .in("status", ["solicitada", "com_voluntario"]);
      return count ?? 0;
    },
  });

  // ── Próximas 7 celebrações com vagas info ─────────────────────────────────────
  const { data: proximasCelebracoes = [] } = useQuery<{
    id: string; titulo: string; data: string; hora_inicio: string | null;
    local: string | null; status: string; vagas: number; escalados: number; abertas: number;
  }[]>({
    queryKey: ["proximas-celebracoes-detalhe", pid],
    enabled: !!pid,
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      const { data: escalas } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio, local, status")
        .eq("paroquia_id", pid!)
        .neq("status", "arquivada")
        .gte("data", format(new Date(), "yyyy-MM-dd"))
        .order("data").order("hora_inicio")
        .limit(7);
      if (!escalas?.length) return [];
      const ids = escalas.map((e) => e.id);
      const [vagasResult, escaladosResult] = await Promise.all([
        supabase.from("escala_funcoes").select("escala_id, quantidade").in("escala_id", ids),
        supabase.from("escala_membros").select("escala_id").in("escala_id", ids),
      ]);
      const vagasMap: Record<string, number> = {};
      const escMap: Record<string, number> = {};
      (vagasResult.data ?? []).forEach((r) => { vagasMap[r.escala_id] = (vagasMap[r.escala_id] ?? 0) + ((r.quantidade as number) ?? 1); });
      (escaladosResult.data ?? []).forEach((r) => { escMap[r.escala_id] = (escMap[r.escala_id] ?? 0) + 1; });
      return escalas.map((e) => ({
        ...e,
        vagas: vagasMap[e.id] ?? 0,
        escalados: escMap[e.id] ?? 0,
        abertas: Math.max(0, (vagasMap[e.id] ?? 0) - (escMap[e.id] ?? 0)),
      }));
    },
  });

  // ── Missas compatíveis (portal do membro) ─────────────────────────────────────
  type MissaParaMembro = { id: string; escalaId: string; ministerioId: string; titulo: string; data: string; hora_inicio: string | null; ministerio_nome: string; abertas: number };
  const { data: missasParaMembro = [] } = useQuery<MissaParaMembro[]>({
    queryKey: ["missas-para-membro", pid, profile?.id],
    enabled: !!pid && !!profile?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MissaParaMembro[]> => {
      if (!profile?.id) return [];
      const { data: mins } = await anyDb.from("membro_ministerios").select("ministerio_id, ministerios(nome)").eq("membro_id", profile.id);
      if (!mins?.length) return [];
      const minIds = (mins as { ministerio_id: string; ministerios: { nome: string } | null }[]).map((m) => m.ministerio_id);
      const hoje = format(new Date(), "yyyy-MM-dd");
      const em14 = format(addDays(new Date(), 14), "yyyy-MM-dd");
      const { data: esc } = await supabase
        .from("escalas")
        .select("id, titulo, data, hora_inicio")
        .eq("paroquia_id", pid!)
        .eq("status", "publicada")
        .gte("data", hoje)
        .lte("data", em14)
        .order("data");
      if (!esc?.length) return [];
      const ids = esc.map((e) => e.id);
      const [vagasResult, escaladosResult] = await Promise.all([
        supabase.from("escala_funcoes").select("escala_id, ministerio_id, quantidade").in("escala_id", ids).in("ministerio_id", minIds),
        supabase.from("escala_membros").select("escala_id, ministerio_id").in("escala_id", ids).in("ministerio_id", minIds),
      ]);
      const result: MissaParaMembro[] = [];
      for (const escala of esc) {
        for (const ministerioId of minIds) {
          const vagasForMin = (vagasResult.data ?? []).filter((v: any) => v.escala_id === escala.id && v.ministerio_id === ministerioId);
          const totalVagas = vagasForMin.reduce((s: number, v: any) => s + ((v.quantidade as number) ?? 1), 0);
          const escaladosForMin = (escaladosResult.data ?? []).filter((v: any) => v.escala_id === escala.id && v.ministerio_id === ministerioId).length;
          const abertas = Math.max(0, totalVagas - escaladosForMin);
          if (abertas > 0) {
            const min = mins.find((m: { ministerio_id: string }) => m.ministerio_id === ministerioId) as { ministerio_id: string; ministerios: { nome: string } | null } | undefined;
            result.push({
              id: `${escala.id}-${ministerioId}`,
              escalaId: escala.id,
              ministerioId,
              titulo: escala.titulo,
              data: escala.data,
              hora_inicio: escala.hora_inicio,
              ministerio_nome: min?.ministerios?.nome ?? "Função",
              abertas,
            });
          }
        }
      }
      return result.slice(0, 5);
    },
  });

  // ── KPI: total de presenças pendentes (soma de escalasPresencaPendente) ────────
  const presencasPendentesTotal = escalasPresencaPendente.reduce((s, e) => s + e.pendentes, 0);

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

  const candidatarMutation = useMutation({
    mutationFn: async ({ escalaId, ministerioId }: { escalaId: string; ministerioId: string }) => {
      if (!profile?.id) throw new Error("Usuário não identificado.");
      const { data: existing } = await supabase.from("escala_membros").select("id").eq("escala_id", escalaId).eq("membro_id", profile.id).eq("ministerio_id", ministerioId).maybeSingle();
      if (existing) throw new Error("Você já está escalado(a) para esta função nesta missa.");
      const [vagasRes, escaladosRes] = await Promise.all([
        supabase.from("escala_funcoes").select("quantidade").eq("escala_id", escalaId).eq("ministerio_id", ministerioId),
        supabase.from("escala_membros").select("id").eq("escala_id", escalaId).eq("ministerio_id", ministerioId),
      ]);
      const totalVagas = ((vagasRes.data ?? []) as any[]).reduce((s: number, v: any) => s + ((v.quantidade as number) ?? 1), 0);
      if ((escaladosRes.data ?? []).length >= totalVagas) throw new Error("Esta vaga já foi preenchida por outro servidor.");
      const { error } = await supabase.from("escala_membros").insert({ escala_id: escalaId, membro_id: profile.id, ministerio_id: ministerioId, status: "pendente" });
      if (error) throw error;
    },
    onSuccess: () => {
      qcDash.invalidateQueries({ queryKey: ["missas-para-membro"] });
      qcDash.invalidateQueries({ queryKey: ["escala-membros"] });
      qcDash.invalidateQueries({ queryKey: ["pm-escalas"] });
      qcDash.invalidateQueries({ queryKey: ["proximas-celebracoes-detalhe"] });
      setCandidaturaTarget(null);
      toast.success("Disponibilidade registrada! A coordenação será notificada.");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao registrar disponibilidade."),
  });

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loadingStats) {
    return (
      <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24 lg:pb-10">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-10">

      {/* Header + chip litúrgico inline */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-xl sm:text-3xl text-foreground truncate">{paroquia?.nome ?? "Sua paróquia"}</h1>
          {paroquia?.diocese && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{paroquia.diocese}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/espiritualidade"
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${VESTMENT_DOT[todayColor]}`} />
            <span className="hidden sm:inline">{VESTMENT_LABEL[todayColor]} · {SEASON_LABELS[season] ?? season}</span>
            <span className="sm:hidden">{VESTMENT_LABEL[todayColor]}</span>
          </Link>
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0 rounded-xl" onClick={gerarRelatorioMensal}>
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline ml-1.5">Relatório</span>
          </Button>
        </div>
      </div>

      {/* ── Portal do membro: Missas precisando de servidores ── */}
      {!hasAdminAccess && missasParaMembro.length > 0 && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-primary/20">
            <HandHelping className="h-3.5 w-3.5 text-primary shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
              Missas precisando de servidores
            </p>
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
              {missasParaMembro.length}
            </span>
          </div>
          <div className="divide-y divide-primary/10">
            {missasParaMembro.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setCandidaturaTarget({ escalaId: m.escalaId, ministerioId: m.ministerioId, titulo: m.titulo, data: m.data, hora_inicio: m.hora_inicio, ministerio_nome: m.ministerio_nome })}
                className="flex items-center gap-3 px-4 py-3 hover:bg-primary/10 transition group w-full text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug truncate">{m.titulo}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(m.data + "T00:00:00"), "EEE, d 'de' MMM", { locale: ptBR })}
                    {m.hora_inicio ? ` · ${m.hora_inicio.slice(0, 5)}` : ""}
                    {" · "}<span className="font-medium">{m.ministerio_nome}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-amber-600">{m.abertas} vaga{m.abertas !== 1 ? "s" : ""}</p>
                  <p className="text-[10px] text-primary font-semibold">Consigo servir →</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── AGIR AGORA — 4 KPIs operacionais ── */}
      {hasAdminAccess && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold mb-3">Agir agora</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link to="/escalas" className="rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition block">
              <p className={`text-3xl font-serif font-bold ${escalasRascunhoCount > 0 ? "text-amber-600" : "text-muted-foreground/40"}`}>{escalasRascunhoCount}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Escalas sem publicar</p>
            </Link>
            <Link to="/sacristia" className="rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition block">
              <p className={`text-3xl font-serif font-bold ${presencasPendentesTotal > 0 ? "text-orange-600" : "text-muted-foreground/40"}`}>{presencasPendentesTotal}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Presenças pendentes</p>
            </Link>
            <Link to="/substituicoes" className="rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition block">
              <p className={`text-3xl font-serif font-bold ${substituicoesPendentesCount > 0 ? "text-violet-600" : "text-muted-foreground/40"}`}>{substituicoesPendentesCount}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Substituições aguardando</p>
            </Link>
            <Link to="/membros" className="rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition block">
              <p className={`text-3xl font-serif font-bold ${membrosNaoAtivados > 0 ? "text-slate-600" : "text-muted-foreground/40"}`}>{membrosNaoAtivados}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Membros sem ativação</p>
            </Link>
          </div>
        </div>
      )}

      {/* ── Alertas urgentes — só aparece quando há itens críticos ── */}
      {(conflitos.length > 0 || escalasIncompletas.length > 0 || alertasLiturgicos.length > 0 || escalasPresencaPendente.length > 0 || substituicoesPendentesCount > 0 || confirmacoesPendentes > 0 || membrosNaoAtivados > 0 || indispAtivasCount > 0 || escalasRascunhoCount > 0) && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-200/60 dark:border-amber-800/60">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
              Precisa de atenção
            </p>
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
              {conflitos.length + escalasIncompletas.length + alertasLiturgicos.length + escalasPresencaPendente.length + (substituicoesPendentesCount > 0 ? 1 : 0) + (confirmacoesPendentes > 0 ? 1 : 0) + (membrosNaoAtivados > 0 ? 1 : 0) + (indispAtivasCount > 0 ? 1 : 0) + (escalasRascunhoCount > 0 ? 1 : 0)}
            </span>
          </div>
          <div className="divide-y divide-amber-200/50 dark:divide-amber-800/40">
            {escalasRascunhoCount > 0 && (
              <Link
                to="/escalas"
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <Calendar className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-amber-600 font-semibold">{escalasRascunhoCount} escala{escalasRascunhoCount !== 1 ? "s" : ""}</span>{" "}
                    {escalasRascunhoCount !== 1 ? "aguardam" : "aguarda"} publicação
                  </p>
                  <p className="text-xs text-muted-foreground">Escalas futuras ainda em rascunho</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            )}
            {escalasPresencaPendente.slice(0, 2).map((e) => (
              <Link
                key={`presenca-${e.id}`}
                to="/escalas"
                search={{ abrir: e.id } as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <ClipboardList className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug line-clamp-1">
                    <span className="text-orange-600 font-semibold">{e.pendentes} presença{e.pendentes !== 1 ? "s" : ""} não registrada{e.pendentes !== 1 ? "s" : ""}</span>
                    {" — "}{e.titulo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Escala de {format(new Date(e.data + "T00:00:00"), "d 'de' MMMM", { locale: ptBR })}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            ))}
            {escalasIncompletas.slice(0, 2).map((e) => (
              <Link
                key={e.id}
                to="/escalas"
                search={{ abrir: e.id } as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <CalendarOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug line-clamp-1">
                    <span className="text-red-600 font-semibold">{e.abertas} vaga{e.abertas !== 1 ? "s" : ""} em aberto</span>
                    {" — "}{e.titulo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(e.data + "T00:00:00"), "d 'de' MMMM", { locale: ptBR })}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            ))}
            {conflitos.slice(0, 2).map((c) => (
              <div key={`${c.membroNome}-${c.data}`} className="flex items-center gap-3 px-4 py-3">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug line-clamp-1">
                    Conflito: <span className="font-semibold">{c.membroNome}</span> em {format(new Date(c.data + "T00:00:00"), "d/MM", { locale: ptBR })}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{c.escalaTitulo}</p>
                </div>
                <button
                  onClick={() => setSubstituicaoTarget({ escalaId: c.escalaId, atribuicaoId: c.atribuicaoId, ministerioId: c.ministerioId, membroNome: c.membroNome, data: c.data })}
                  className="text-xs font-semibold text-primary hover:underline shrink-0 ml-2"
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
                  <p className="text-xs text-muted-foreground truncate">{a.name}</p>
                </div>
                <span className="text-xs font-semibold text-primary shrink-0 group-hover:underline">
                  Criar →
                </span>
              </Link>
            ))}
            {isCoord && indispAtivasCount > 0 && (
              <Link
                to="/escalas"
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <CalendarOff className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-amber-600 font-semibold">{indispAtivasCount} indisponibilidade{indispAtivasCount !== 1 ? "s" : ""}</span> ativa{indispAtivasCount !== 1 ? "s" : ""} nos próximos 30 dias
                  </p>
                  <p className="text-xs text-muted-foreground">Verifique antes de publicar escalas</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            )}
            {substituicoesPendentesCount > 0 && (
              <Link
                to="/substituicoes"
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-violet-600 font-semibold">{substituicoesPendentesCount} substituição{substituicoesPendentesCount !== 1 ? "ões" : ""}</span> aguardando aprovação
                  </p>
                  <p className="text-xs text-muted-foreground">Clique para gerenciar</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            )}
            {confirmacoesPendentes > 0 && (
              <Link
                to="/escalas"
                search={{} as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <Clock className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-sky-600 font-semibold">{confirmacoesPendentes} membro{confirmacoesPendentes !== 1 ? "s" : ""}</span> ainda não respondeu{confirmacoesPendentes !== 1 ? "ram" : ""} a escala
                  </p>
                  <p className="text-xs text-muted-foreground">Próximos 7 dias · escalas publicadas</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            )}
            {isCoord && membrosNaoAtivados > 0 && (
              <Link
                to="/membros"
                search={{} as any}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition group"
              >
                <UserX className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    <span className="text-slate-600 dark:text-slate-400 font-semibold">{membrosNaoAtivados} membro{membrosNaoAtivados !== 1 ? "s" : ""}</span> sem conta ativada
                  </p>
                  <p className="text-xs text-muted-foreground">Não conseguem acessar o portal</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition shrink-0" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Próximas celebrações ── */}
      {proximasCelebracoes.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Próximas celebrações</p>
              <h2 className="mt-0.5 font-serif text-lg leading-snug">Escalas publicadas e rascunhos</h2>
            </div>
            <Link to="/escalas" search={{} as any}>
              <Button variant="ghost" size="sm" className="h-8 text-xs rounded-xl">
                Ver todas <ChevronRight className="h-3 w-3 ml-0.5" />
              </Button>
            </Link>
          </div>
          <div className="divide-y divide-border/60">
            {proximasCelebracoes.map((e) => {
              const d = new Date(e.data + "T00:00:00");
              const isToday = e.data === format(new Date(), "yyyy-MM-dd");
              return (
                <Link
                  key={e.id}
                  to="/escalas"
                  search={{ abrir: e.id } as any}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition group"
                >
                  <div className="w-12 shrink-0 text-center">
                    <p className={`text-xs font-bold uppercase ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                      {format(d, "EEE", { locale: ptBR })}
                    </p>
                    <p className={`text-xl font-serif leading-none ${isToday ? "text-primary" : "text-foreground"}`}>
                      {format(d, "d")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{format(d, "MMM", { locale: ptBR })}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {e.hora_inicio ? e.hora_inicio.slice(0, 5) : "—"}
                      {e.local ? ` · ${e.local}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {e.vagas > 0 ? (
                      <>
                        <p className={`text-sm font-semibold ${e.abertas > 0 ? "text-amber-600" : "text-green-600"}`}>
                          {e.escalados}/{e.vagas}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{e.abertas > 0 ? `${e.abertas} vaga${e.abertas !== 1 ? "s" : ""} livre${e.abertas !== 1 ? "s" : ""}` : "completa"}</p>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">sem vagas</span>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Badge variant={e.status === "publicada" ? "default" : "secondary"} className="text-[10px] uppercase">
                      {e.status === "publicada" ? "Pub." : "Rasc."}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Saúde da pastoral ── */}
      <div className="rounded-3xl border border-border bg-card shadow-altar p-5">
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold">Saúde da pastoral</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">Índice composto das últimas 4 semanas</p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground mt-3 sm:mt-0 shrink-0">
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

      {/* ── Seção secundária (lazy) ── */}
      <div>
        <button
          type="button"
          onClick={() => setShowSecondary((v) => !v)}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition"
        >
          {showSecondary ? "Ocultar estatísticas" : "Ver estatísticas detalhadas"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSecondary ? "rotate-180" : ""}`} />
        </button>

        {showSecondary && (
          <div className="mt-4 space-y-4">

            {/* Presença do mês + Membros por atuação */}
            <div className="grid gap-4 sm:grid-cols-2">
              {presencaMes && (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Presença do mês</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-center">
                      <p className="text-2xl font-serif font-bold text-green-600">{presencaMes.presente}</p>
                      <p className="text-[10px] uppercase tracking-wide text-green-700/70 mt-0.5">Presentes</p>
                    </div>
                    <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-center">
                      <p className="text-2xl font-serif font-bold text-red-600">{presencaMes.faltou}</p>
                      <p className="text-[10px] uppercase tracking-wide text-red-700/70 mt-0.5">Faltas</p>
                    </div>
                    <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 px-3 py-2.5 text-center">
                      <p className="text-2xl font-serif font-bold text-orange-600">{presencaMes.atraso}</p>
                      <p className="text-[10px] uppercase tracking-wide text-orange-700/70 mt-0.5">Atrasos</p>
                    </div>
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-center">
                      <p className="text-2xl font-serif font-bold text-amber-600">{presencaMes.justificou}</p>
                      <p className="text-[10px] uppercase tracking-wide text-amber-700/70 mt-0.5">Justificadas</p>
                    </div>
                  </div>
                  {presencaMes.total > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500"
                          style={{ width: `${Math.round((presencaMes.presente / presencaMes.total) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-green-600 shrink-0">
                        {Math.round((presencaMes.presente / presencaMes.total) * 100)}% presença
                      </span>
                    </div>
                  )}
                </div>
              )}
              {memberStats && memberStats.byPastoral.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Membros por atuação</p>
                  </div>
                  <div className="space-y-2">
                    {memberStats.byPastoral.slice(0, 6).map((p: { nome: string; membros: number; cor: string }) => (
                      <div key={p.nome} className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.cor ?? "#6B7280" }} />
                        <span className="text-sm flex-1 truncate text-foreground/80">{p.nome}</span>
                        <span className="text-sm font-semibold tabular-nums">{p.membros}</span>
                      </div>
                    ))}
                    <div className="pt-1 border-t border-border/50 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Total ativo</span>
                      <span className="text-sm font-bold">{totalMembros}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Agenda Pastoral */}
            <div className="rounded-3xl border border-border bg-card shadow-altar overflow-hidden min-w-0">
              <div className="flex items-center justify-between gap-2 p-4 sm:p-5 border-b border-border">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Agenda Pastoral</p>
                  <h2 className="mt-1 font-serif text-lg sm:text-xl leading-snug">Próximas escalas e eventos</h2>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
                    <Link to="/formacoes" search={{}}>Agenda <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
                    <Link to="/escalas" search={{}}>Escalas <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
                  </Button>
                </div>
              </div>
              {agendaItems.length === 0 ? (
                <div className="p-8 text-center">
                  <CalendarRange className="h-6 w-6 mx-auto text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">Nenhum evento ou escala nas próximas duas semanas.</p>
                </div>
              ) : (() => {
                const dateGroups = new Map<string, AgendaEvent[]>();
                agendaItems.forEach((ev) => {
                  const list = dateGroups.get(ev.data) ?? [];
                  list.push(ev);
                  dateGroups.set(ev.data, list);
                });
                const grouped = Array.from(dateGroups.entries()).sort(([a], [b]) => a.localeCompare(b));
                return (
                  <div className="divide-y divide-border/60">
                    {grouped.map(([date, items]) => {
                      const d = new Date(date + "T00:00:00");
                      const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                      return (
                        <div key={date} className={`px-4 py-3 ${isToday ? "bg-primary/3" : ""}`}>
                          <p className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-2.5 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                            {isToday ? "Hoje — " : ""}{format(d, "EEE, d 'de' MMM", { locale: ptBR })}
                          </p>
                          <div className="space-y-2">
                            {items.map((ev) => {
                              const escalaStatus = ev.status ? (STATUS_CONFIG[ev.status] ?? STATUS_CONFIG.rascunho) : null;
                              return (
                                <div key={ev.id} className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background px-3 py-2.5 min-w-0 overflow-hidden">
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ev.cor }} />
                                  <div className="flex-1 min-w-0 overflow-hidden">
                                    <p className="text-sm font-medium truncate leading-snug">{ev.titulo}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                      {ev.hora ? ev.hora.slice(0,5) : ""}
                                      {ev.local ? (ev.hora ? ` · ${ev.local}` : ev.local) : ""}
                                    </p>
                                  </div>
                                  {ev.tipo === "Escala" && escalaStatus ? (
                                    <Badge variant={escalaStatus.variant} className="text-[10px] uppercase shrink-0 max-w-[80px] truncate">
                                      {escalaStatus.label}
                                    </Badge>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-blue-600 shrink-0">
                                      {ev.tipo}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Ranking + Distribuição de funções */}
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
                      <YAxis type="category" dataKey="nome" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={72} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                      <Bar dataKey="score" radius={[0, 4, 4, 0]} name="Score">
                        {topMembros.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "hsl(var(--primary))" : `hsl(var(--primary) / ${Math.max(0.25, 1 - i * 0.08)})`} />
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
                      <XAxis dataKey="nome" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" interval={0} />
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

            {/* Insights + Aniversariantes */}
            <div className="grid gap-6 xl:grid-cols-2">
              <InsightsPanel
                membrosOciosos={membrosOciosos}
                membrosNovos={membrosNovos}
                conflitos={conflitos}
                escalasIncompletas={escalasIncompletas}
                escalasPresencaPendente={escalasPresencaPendente}
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
                    const lista = tab === "hoje" ? aniversariantesHoje : tab === "semana" ? aniversariantesSemana : aniversariantes;
                    return (
                      <TabsContent key={tab} value={tab} className="mt-0 space-y-2">
                        {lista.length === 0 ? (
                          <p className="py-4 text-center text-sm text-muted-foreground">
                            {tab === "hoje" ? "Nenhum aniversariante hoje." : tab === "semana" ? "Nenhum aniversariante esta semana." : "Nenhum aniversariante este mês."}
                          </p>
                        ) : (
                          lista.slice(0, 5).map((m) => {
                            const dia = new Date(m.data_nascimento + "T12:00:00").getDate();
                            const mes = new Date(m.data_nascimento + "T12:00:00").toLocaleString("pt-BR", { month: "short" });
                            return (
                              <div key={m.id} className="flex items-center justify-between rounded-3xl border border-border bg-background px-4 py-3">
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
        )}
      </div>

      {/* ── Dialog Consigo Servir ─────────────────────────────────────────── */}
      <Dialog open={!!candidaturaTarget} onOpenChange={(o) => { if (!o) setCandidaturaTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar disponibilidade</DialogTitle>
          </DialogHeader>
          {candidaturaTarget && (
            <div className="py-2 space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Missa</span>
                  <span className="font-medium text-right">{candidaturaTarget.titulo}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Data</span>
                  <span className="font-medium">
                    {format(new Date(candidaturaTarget.data + "T00:00:00"), "EEE, d 'de' MMMM", { locale: ptBR })}
                  </span>
                </div>
                {candidaturaTarget.hora_inicio && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">Horário</span>
                    <span className="font-medium">{candidaturaTarget.hora_inicio.slice(0, 5)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Função</span>
                  <span className="font-medium text-primary">{candidaturaTarget.ministerio_nome}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Ao confirmar, você será adicionado(a) à lista de presença. A coordenação poderá ajustar conforme necessário.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setCandidaturaTarget(null)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={candidatarMutation.isPending || !candidaturaTarget}
              onClick={() => candidaturaTarget && candidatarMutation.mutate({ escalaId: candidaturaTarget.escalaId, ministerioId: candidaturaTarget.ministerioId })}
            >
              {candidatarMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmar presença
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  escalasPresencaPendente,
  membrosSemFuncao, funcoesSemMembros, alertasLiturgicos, onSugerirSubstituto,
}: {
  membrosOciosos: { id: string; nome: string }[];
  membrosNovos: { id: string; nome: string }[];
  conflitos: { escalaId: string; escalaTitulo: string; membroId: string; membroNome: string; atribuicaoId: string; ministerioId: string; data: string }[];
  escalasIncompletas: { id: string; titulo: string; data: string; abertas: number; vagas: number }[];
  escalasPresencaPendente: { id: string; titulo: string; data: string; pendentes: number }[];
  membrosSemFuncao: number;
  funcoesSemMembros: { nome: string }[];
  alertasLiturgicos: { name: string; date: string; rank: "solenidade" | "festa"; dias: number }[];
  onSugerirSubstituto: (t: SubstituicaoTarget) => void;
}) {
  const insights: InsightItem[] = [];

  escalasPresencaPendente.slice(0, 3).forEach((e) => {
    insights.push({
      id: `presenca-${e.id}`, icon: ClipboardList, iconCls: "text-orange-500", borderColor: "#f97316",
      label: `Presenças não registradas: ${e.titulo}`,
      desc: `${e.pendentes} membro${e.pendentes !== 1 ? "s" : ""} sem presença confirmada — ${format(new Date(e.data + "T00:00:00"), "d/MM", { locale: ptBR })}`,
      href: "/escalas", hrefSearch: { abrir: e.id }, severity: "warning",
    });
  });

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
                className="flex items-start gap-3 px-4 py-3.5 border-l-4 hover:bg-muted/30 transition"
                style={{ borderLeftColor: ins.borderColor }}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${ins.iconCls}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug truncate">{ins.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{ins.desc}</p>
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
