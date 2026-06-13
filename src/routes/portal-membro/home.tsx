import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useEffect, useState } from "react";
import { format, isToday, isTomorrow, differenceInDays, parseISO, subMonths, startOfMonth, endOfMonth, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar, Clock, MapPin,
  Trophy, Loader2, CheckCircle2, Cake, Play,
  CalendarDays, BookOpen, Bell, User, ChevronRight,
} from "lucide-react";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { getLiturgicalDays } from "@/lib/liturgical-calendar";
import { useRankingPos } from "@/lib/ranking";
import { useLiturgiaHoje } from "@/hooks/use-liturgia";
import { useHomiliaHoje } from "@/hooks/use-homilia";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/home")({
  component: PortalMembroHome,
  head: () => ({ meta: [{ title: "Início — Portal do Servidor" }] }),
});

const LITURGY_HEX: Record<string, string> = {
  branco: "#d1d5db", roxo: "#9333ea", vermelho: "#dc2626",
  verde: "#16a34a", preto: "#374151", dourado: "#f59e0b", rosa: "#ec4899",
};
const LITURGY_LABEL: Record<string, string> = {
  branco: "Branco", roxo: "Roxo", vermelho: "Vermelho",
  verde: "Verde", preto: "Preto", dourado: "Dourado", rosa: "Rosa",
};
const SEASON_LABEL: Record<string, string> = {
  advento: "Advento", natal: "Natal", comum: "Tempo Comum",
  quaresma: "Quaresma", triduo: "Tríduo", pascoa: "Páscoa",
};

type EscalaItem = {
  escala_membro_id: string;
  status: string;
  escala_id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  local: string | null;
  solene: boolean;
  ministerio_nome: string;
  ministerio_cor: string;
};

type Aniversariante = {
  id: string;
  nome: string;
  data_nascimento: string;
};

type ChartPoint = {
  mes: string;
  Presentes: number;
  Ausências: number;
  Eventos: number;
};

function PortalMembroHome() {
  const { membro } = useMembroAuth();
  const qc = useQueryClient();
  const today = useMemo(() => new Date(), []);
  const year = today.getFullYear();

  // Realtime — invalida queries ao vivo quando o usuário está na home
  useEffect(() => {
    if (!membro?.id || !membro?.paroquia_id) return;
    const channel = supabase
      .channel(`pm-home-rt-${membro.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "escala_membros" }, () => {
        qc.invalidateQueries({ queryKey: ["portal-home-escalas", membro.id] });
        qc.invalidateQueries({ queryKey: ["portal-chart-presenca", membro.id] });
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "escalas",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["portal-home-escalas", membro.id] });
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "formacoes_eventos",
        filter: `paroquia_id=eq.${membro.paroquia_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["portal-home-eventos", membro.paroquia_id] });
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "presencas_eventos",
      }, () => {
        qc.invalidateQueries({ queryKey: ["portal-home-presencas", membro.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [membro?.id, membro?.paroquia_id, qc]);

  // Algoritmo local como fallback — usa componentes locais para evitar problema de fuso
  const liturgyLocal = useMemo(() => {
    const days = getLiturgicalDays(year);
    const ty = today.getFullYear(), tm = today.getMonth(), td = today.getDate();
    return days.find((d) =>
      d.date.getFullYear() === ty &&
      d.date.getMonth()    === tm &&
      d.date.getDate()     === td
    );
  }, [today, year]);

  // Fonte primária: hook centralizado (liturgia_base)
  const { data: liturgiaDB }    = useLiturgiaHoje();
  const { data: homiliaHoje }   = useHomiliaHoje();
  const [playerAberto, setPlayerAberto] = useState(false);

  // Mescla: DB tem precedência; algoritmo local serve de fallback
  const liturgy = liturgiaDB
    ? { name: liturgiaDB.titulo, color: liturgiaDB.cor ?? liturgyLocal?.color ?? "verde", season: liturgiaDB.tempo_liturgico ?? liturgyLocal?.season, rank: liturgiaDB.grau }
    : liturgyLocal;

  const { data: escalas = [], isLoading: loadingEscalas } = useQuery<EscalaItem[]>({
    queryKey: ["portal-home-escalas", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      // Query 1 — todas as linhas deste membro em escala_membros (filtro direto na raiz)
      const { data: memRows, error: e1 } = await anyDb
        .from("escala_membros")
        .select("id, escala_id, status, ministerios(nome, cor)")
        .eq("membro_id", membro!.id);
      if (e1) throw e1;
      if (!memRows?.length) return [];

      const escalaIds: string[] = memRows.map((r: any) => r.escala_id);

      // Query 2 — escalas publicadas e futuras por ID (todos os filtros na tabela raiz)
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const { data: escalaRows, error: e2 } = await anyDb
        .from("escalas")
        .select("id, titulo, data, hora_inicio, local, solene")
        .in("id", escalaIds)
        .eq("status", "publicada")
        .gte("data", todayStr)
        .order("data", { ascending: true })
        .order("hora_inicio", { ascending: true })
        .limit(6);
      if (e2) throw e2;

      // Mescla: junta os dados das duas queries
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (escalaRows ?? []).map((esc: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const em = (memRows as any[]).find((r) => r.escala_id === esc.id);
        return {
          escala_membro_id: em?.id ?? "",
          status: em?.status ?? "pendente",
          escala_id: esc.id,
          titulo: esc.titulo,
          data: esc.data,
          hora_inicio: esc.hora_inicio,
          local: esc.local,
          solene: esc.solene ?? false,
          ministerio_nome: em?.ministerios?.nome ?? "—",
          ministerio_cor: em?.ministerios?.cor ?? "#6B7280",
        };
      });

      // Ordenação final no cliente (garante hora_inicio nula no final do dia)
      rows.sort((a: EscalaItem, b: EscalaItem) => {
        const ta = new Date(a.data + "T" + (a.hora_inicio ?? "23:59:59")).getTime();
        const tb = new Date(b.data + "T" + (b.hora_inicio ?? "23:59:59")).getTime();
        return ta - tb;
      });

      return rows;
    },
  });

  const { data: rankingPos } = useRankingPos(membro?.paroquia_id, membro?.id);

  const { data: proximosEventos = [] } = useQuery<{ id: string; titulo: string; tipo: string; data_inicio: string; pontuacao: number }[]>({
    queryKey: ["portal-home-eventos", membro?.paroquia_id],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("formacoes_eventos")
        .select("id,titulo,tipo,data_inicio,pontuacao")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .gte("data_inicio", new Date().toISOString())
        .order("data_inicio", { ascending: true })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: minhasPresencasHome = [] } = useQuery<{ evento_id: string; presente: boolean | null }[]>({
    queryKey: ["portal-home-presencas", membro?.id],
    enabled: !!membro?.id && proximosEventos.length > 0,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("presencas_eventos")
        .select("evento_id,presente")
        .eq("membro_id", membro!.id)
        .in("evento_id", proximosEventos.map((e) => e.id));
      if (error) throw error;
      return data ?? [];
    },
  });

  // Aniversariantes do mês
  const mesAtual = today.getMonth() + 1;
  const { data: aniversariantes = [] } = useQuery<Aniversariante[]>({
    queryKey: ["portal-aniversariantes", membro?.paroquia_id, mesAtual],
    enabled: !!membro?.paroquia_id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("membros")
        .select("id, nome, data_nascimento")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .not("data_nascimento", "is", null);
      if (!data) return [];
      // Filtra pelo mês atual
      return (data as Aniversariante[]).filter((m) => {
        if (!m.data_nascimento) return false;
        const mes = parseInt(m.data_nascimento.slice(5, 7), 10);
        return mes === mesAtual;
      }).sort((a, b) => {
        const diaA = parseInt(a.data_nascimento!.slice(8, 10), 10);
        const diaB = parseInt(b.data_nascimento!.slice(8, 10), 10);
        return diaA - diaB;
      });
    },
  });

  // Gráfico de presença — últimos 5 meses
  const { data: chartData = [] } = useQuery<ChartPoint[]>({
    queryKey: ["portal-chart-presenca", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const meses: ChartPoint[] = [];
      for (let i = 2; i >= 0; i--) {
        const base = subMonths(today, i);
        const inicio = startOfMonth(base).toISOString().slice(0, 10);
        const fim = endOfMonth(base).toISOString().slice(0, 10);
        const mesLabel = format(base, "MMM", { locale: ptBR });

        const { data: hist } = await anyDb
          .from("escala_membros")
          .select("status, escalas!inner(data)")
          .eq("membro_id", membro!.id)
          .gte("escalas.data", inicio)
          .lte("escalas.data", fim)
          .in("status", ["confirmado", "presente", "atrasado", "ausente", "faltou", "justificou"]);

        const rows = (hist ?? []) as any[];
        const presentes = rows.filter((r: any) =>
          r.status === "confirmado" || r.status === "presente" || r.status === "atrasado"
        ).length;
        const ausencias = rows.filter((r: any) =>
          r.status === "ausente" || r.status === "faltou" || r.status === "justificou"
        ).length;

        const { data: eventos } = await anyDb
          .from("presencas_eventos")
          .select(`formacoes_eventos!inner(data_inicio)`)
          .eq("membro_id", membro!.id)
          .eq("presente", true)
          .gte("formacoes_eventos.data_inicio", inicio + "T00:00:00")
          .lte("formacoes_eventos.data_inicio", fim + "T23:59:59");

        meses.push({
          mes: mesLabel,
          Presentes: presentes,
          Ausências: ausencias,
          Eventos: (eventos ?? []).length,
        });
      }
      return meses;
    },
  });

  if (!membro) return null;

  const hora = today.getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  const nextEscala = escalas[0] ?? null;
  const remainingEscalas = escalas.slice(1);

  const myScore = membro.score ?? 0;

  // Verifica se hoje é o aniversário do próprio membro
  const isAniversario = (() => {
    if (!membro.data_nascimento) return false;
    const hojeMD = today.toISOString().slice(5, 10); // "MM-DD"
    const nascMD = membro.data_nascimento.slice(5, 10);
    return hojeMD === nascMD;
  })();

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6 pb-24">

      {/* ── Banner de aniversário (só aparece no dia do próprio membro) ── */}
      {isAniversario && (
        <section>
          <div className="relative overflow-hidden rounded-3xl border-2 border-pink-300 dark:border-pink-700 bg-gradient-to-br from-pink-50 via-rose-50 to-amber-50 dark:from-pink-950/40 dark:via-rose-950/30 dark:to-amber-950/30 p-6 shadow-lg">
            {/* Confetes decorativos (pure CSS) */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {["top-2 left-[8%]", "top-4 left-[22%]", "top-1 left-[42%]", "top-3 left-[60%]", "top-2 left-[78%]", "top-5 left-[90%]"].map((pos, i) => (
                <span
                  key={i}
                  className={`absolute text-base animate-bounce ${pos}`}
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: `${1.4 + i * 0.1}s` }}
                >
                  {["🎊", "✨", "🎉", "⭐", "🌟", "🎈"][i]}
                </span>
              ))}
            </div>

            {/* Conteúdo */}
            <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-4">
              <div className="h-16 w-16 rounded-2xl bg-pink-100 dark:bg-pink-900/50 flex items-center justify-center shrink-0 text-3xl shadow-inner">
                🎂
              </div>
              <div className="text-center sm:text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-pink-500 dark:text-pink-400 mb-1">
                  Feliz Aniversário!
                </p>
                <h2 className="font-serif text-2xl text-foreground leading-tight">
                  {membro.nome.split(" ")[0]}, hoje é seu dia! 🥳
                </h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
                  Que Deus abençoe sua vida com saúde, paz, fé e muitas graças.
                  A comunidade agradece seu serviço e deseja um dia muito especial.
                </p>
                <p className="mt-3 text-xs text-pink-500 dark:text-pink-400 font-medium">
                  Com carinho, da coordenação pastoral 🙏
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Greeting ── */}
      <section>
        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Portal do Servidor</p>
        <h1 className="mt-2 text-3xl font-serif text-foreground">
          {saudacao}, {membro.nome.split(" ")[0]}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {rankingPos && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full">
              <Trophy className="h-3 w-3" />
              {rankingPos}º lugar · {myScore} pts
            </span>
          )}
          {liturgy && (
            <span className="inline-flex items-center gap-1.5 text-[11px] rounded-full border border-border bg-background/80 px-2.5 py-1">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: LITURGY_HEX[liturgy.color] }} />
              <span className="text-muted-foreground truncate max-w-[120px] sm:max-w-[180px]">
                {SEASON_LABEL[(liturgy.season as string)] ?? "Tempo Comum"} · {LITURGY_LABEL[liturgy.color]}
              </span>
            </span>
          )}
        </div>
      </section>

      {/* ── Atalhos rápidos ── */}
      <section>
        <div className="grid grid-cols-4 gap-2">
          {[
            { to: "/portal-membro/escalas",  icon: Calendar,     label: "Escalas"    },
            { to: "/portal-membro/eventos",  icon: CalendarDays, label: "Eventos"    },
            { to: "/portal-membro/liturgia", icon: BookOpen,     label: "Liturgia"   },
            { to: "/portal-membro/notificacoes", icon: Bell,     label: "Avisos"     },
          ].map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-muted/50 border border-border/60 py-3 px-1 text-center hover:bg-muted transition active:scale-95"
            >
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-[10px] font-semibold text-muted-foreground leading-none">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Próxima escala — PRIMEIRO item de conteúdo ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.28em] font-semibold text-muted-foreground">Próxima escala</p>
          <Link to="/portal-membro/escalas" className="text-xs text-primary hover:underline">Ver todas</Link>
        </div>
        {loadingEscalas ? (
          <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Carregando...</span>
          </div>
        ) : !nextEscala ? (
          <div className="rounded-2xl border border-dashed border-border bg-background p-6 text-center">
            <Calendar className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma escala futura publicada.</p>
          </div>
        ) : (
          <NextEscalaHero esc={nextEscala} />
        )}
      </section>

      {/* ── Liturgia e Homilia do dia ── */}
      <section className="space-y-2.5">
        {/* Label da seção */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
            Liturgia &amp; Homilia
          </p>
          <Link
            to="/portal-membro/liturgia"
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Ver tudo →
          </Link>
        </div>

        {/* ── HOMILIA — card principal com player inline ── */}
        {homiliaHoje ? (
          <div className="rounded-2xl bg-card border border-border shadow-altar overflow-hidden">
            {/* Player / Thumbnail */}
            <div className="relative aspect-video w-full bg-black">
              {playerAberto ? (
                /* Iframe do YouTube — sem sair do site */
                <iframe
                  src={`https://www.youtube.com/embed/${homiliaHoje.video_id}?autoplay=1&rel=0&modestbranding=1`}
                  title={homiliaHoje.titulo}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                  loading="lazy"
                />
              ) : (
                /* Thumbnail com botão play */
                <>
                  {homiliaHoje.thumbnail_url ? (
                    <img
                      src={homiliaHoje.thumbnail_url}
                      alt={homiliaHoje.titulo}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-muted" />
                  )}
                  <button
                    type="button"
                    onClick={() => setPlayerAberto(true)}
                    className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/35 transition-colors w-full"
                    aria-label="Assistir homilia"
                  >
                    <div className="h-16 w-16 rounded-full bg-red-600 flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
                      <Play className="h-7 w-7 text-white ml-1" />
                    </div>
                  </button>
                  <div className="absolute bottom-3 left-3 pointer-events-none">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] bg-black/60 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">
                      Homilia do dia
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Info */}
            <div className="px-4 pt-3 pb-3.5">
              <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 mb-0.5">
                {homiliaHoje.titulo}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {homiliaHoje.autor ?? "Pe. Paulo Ricardo"}
              </p>
            </div>
          </div>
        ) : (
          /* Sem homilia: aviso compacto (sem link externo) */
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 px-4 py-3.5">
            <div className="h-10 w-10 rounded-xl bg-red-600/20 flex items-center justify-center shrink-0">
              <Play className="h-4 w-4 text-red-600 ml-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700 dark:text-red-400">Homilia do Dia</p>
              <p className="text-[11px] text-red-600/70 dark:text-red-500/70">Homilia de hoje ainda não disponível — exibindo a mais recente</p>
            </div>
          </div>
        )}

        {/* ── LITURGIA — card secundário (abaixo da homilia) ── */}
        <Link
          to="/portal-membro/liturgia"
          className="block rounded-2xl bg-card border border-border shadow-altar overflow-hidden active:scale-[0.99] transition-transform"
        >
          {/* Barra de cor litúrgica */}
          <div
            className="h-1 w-full"
            style={{ backgroundColor: liturgy ? LITURGY_HEX[liturgy.color] : "#16a34a" }}
          />

          <div className="px-4 pt-3.5 pb-4">
            {/* Tempo + cor — linha de metadados */}
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: liturgy ? LITURGY_HEX[liturgy.color] : "#16a34a" }}
              />
              <p
                className="text-[10px] font-bold uppercase tracking-[0.25em]"
                style={{ color: liturgy ? LITURGY_HEX[liturgy.color] : "#16a34a" }}
              >
                {liturgy
                  ? `${SEASON_LABEL[(liturgy.season as string)] ?? "Tempo Comum"} · ${LITURGY_LABEL[liturgy.color] ?? "Verde"}`
                  : format(today, "EEEE", { locale: ptBR })
                }
              </p>
            </div>

            {/* Nome da celebração */}
            <p className="font-serif text-[1.15rem] leading-snug text-foreground mb-3">
              {liturgy?.name ?? format(today, "d 'de' MMMM", { locale: ptBR })}
            </p>

            {/* CTA para ler as leituras */}
            <div className="border-t border-border/40 pt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {liturgiaDB ? "Leituras e Evangelho disponíveis" : "Calendário litúrgico"}
              </p>
              <span
                className="text-[11px] font-semibold"
                style={{ color: liturgy ? LITURGY_HEX[liturgy.color] : "#16a34a" }}
              >
                Ler leituras →
              </span>
            </div>
          </div>
        </Link>

      </section>

      {remainingEscalas.length > 0 && (
        <div className="space-y-3">
          {remainingEscalas.map((esc) => (
            <EscalaPreviewCard key={esc.escala_membro_id} esc={esc} />
          ))}
        </div>
      )}

      {/* ── Gráfico de presença ── */}
      {chartData.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Participação</p>
              <h2 className="mt-2 text-xl font-serif text-foreground">Últimos 3 meses</h2>
            </div>
            <Link to="/portal-membro/escalas" className="text-sm text-primary hover:underline">Histórico</Link>
          </div>
          <div className="rounded-3xl border border-border bg-card p-4 shadow-altar">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={8} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }}
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Presentes" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Ausências" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Eventos" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── Próximos eventos ── */}
      {proximosEventos.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Formações e Eventos</p>
              <h2 className="mt-2 text-xl font-serif text-foreground">Próximos eventos</h2>
            </div>
            <Link to="/portal-membro/eventos" className="text-sm text-primary hover:underline">Ver todos</Link>
          </div>
          <div className="rounded-3xl border border-border bg-card overflow-hidden divide-y divide-border">
            {proximosEventos.map((ev) => {
              const p = minhasPresencasHome.find((pr) => pr.evento_id === ev.id);
              const confirmado = p !== undefined && p.presente === null;
              const ausente = p?.presente === false;
              return (
                <div key={ev.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0 w-10 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {format(parseISO(ev.data_inicio), "MMM", { locale: ptBR })}
                    </p>
                    <p className="text-lg font-serif leading-tight">
                      {format(parseISO(ev.data_inicio), "d")}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ev.titulo}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(ev.data_inicio), "HH:mm")} · +{ev.pontuacao} pts
                    </p>
                  </div>
                  <div className="shrink-0">
                    {confirmado ? (
                      <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-300 font-medium">
                        Confirmado
                      </span>
                    ) : ausente ? (
                      <span className="text-xs px-2 py-1 rounded-lg bg-red-500/10 text-red-700 border border-red-300 font-medium">
                        Justificado
                      </span>
                    ) : (
                      <Link
                        to="/portal-membro/eventos"
                        className="text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/25 font-medium hover:bg-primary/20 transition"
                      >
                        Responder
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Aniversariantes do mês ── sempre visível ── */}
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Paróquia</p>
          <h2 className="mt-2 text-xl font-serif text-foreground flex items-center gap-2">
            <Cake className="h-5 w-5 text-pink-500" />
            Aniversariantes de {format(today, "MMMM", { locale: ptBR })}
          </h2>
        </div>
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          {aniversariantes.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Cake className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum aniversariante este mês.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">As datas de nascimento precisam estar cadastradas no perfil.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {aniversariantes.map((a) => {
                const dia = parseInt(a.data_nascimento.slice(8, 10), 10);
                const isHoje = dia === today.getDate();
                return (
                  <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${isHoje ? "bg-pink-500/5" : ""}`}>
                    <div className="h-9 w-9 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0">
                      <Cake className={`h-4 w-4 ${isHoje ? "text-pink-500" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isHoje ? "text-pink-600" : ""}`}>
                        {a.nome.split(" ").slice(0, 2).join(" ")}
                        {isHoje && <span className="ml-2 text-xs bg-pink-100 text-pink-700 rounded-full px-2 py-px">Hoje!</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Dia {dia} de {format(today, "MMMM", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Minha pontuação ── */}
      {myScore > 0 && (
        <section className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Sua pontuação</p>
            <h2 className="mt-2 text-xl font-serif text-foreground flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" /> Ranking de Servidores
            </h2>
          </div>
          <Link
            to="/portal-membro/ranking"
            className="block rounded-3xl border border-border bg-card p-5 hover:border-primary/40 transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-5">
              <div className="h-14 w-14 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <span className="text-2xl">
                  {rankingPos === 1 ? "🥇" : rankingPos === 2 ? "🥈" : rankingPos === 3 ? "🥉" : `${rankingPos ?? "—"}º`}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{rankingPos ? `${rankingPos}º lugar` : "—"}</p>
                <p className="font-serif text-3xl leading-none mt-0.5">{myScore}</p>
                <p className="text-xs text-muted-foreground mt-0.5">pontos acumulados</p>
              </div>
              <span className="ml-auto text-xs text-primary font-medium">Ver ranking →</span>
            </div>
          </Link>
        </section>
      )}
    </div>
  );
}

// ── NextEscalaHero ────────────────────────────────────────────────────

function NextEscalaHero({ esc }: { esc: EscalaItem }) {
  const date = new Date(esc.data + "T12:00:00");
  // Diferença em dias calendário (midnight vs midnight — evita imprecisão por horário)
  const diasFaltam = differenceInDays(startOfDay(date), startOfDay(new Date()));

  const dateLabel = isToday(date)
    ? "Hoje"
    : isTomorrow(date)
    ? "Amanhã"
    : diasFaltam <= 7
    ? format(date, "EEEE", { locale: ptBR })
    : format(date, "d 'de' MMMM", { locale: ptBR });

  const dayNum = format(date, "d");
  const monthStr = format(date, "MMM", { locale: ptBR });
  const weekdayLong = format(date, "EEEE", { locale: ptBR });

  return (
    <Link
      to="/portal-membro/escalas"
      className="block rounded-2xl border border-border overflow-hidden hover:border-primary/40 transition active:scale-[0.99]"
      style={{ borderLeftWidth: "4px", borderLeftColor: esc.ministerio_cor }}
    >
      <div className="p-4" style={{ backgroundColor: esc.ministerio_cor + "0a" }}>
        <div className="flex gap-4">
          {/* Bloco de data */}
          <div
            className="flex flex-col items-center justify-center rounded-xl px-3 py-2.5 shrink-0 min-w-[56px]"
            style={{ backgroundColor: esc.ministerio_cor + "22" }}
          >
            <span className="text-2xl font-serif font-bold leading-none" style={{ color: esc.ministerio_cor }}>{dayNum}</span>
            <span className="text-[10px] uppercase tracking-wider mt-0.5 capitalize" style={{ color: esc.ministerio_cor }}>{monthStr}</span>
          </div>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0">
            {/* Linha de labels: dia da semana + badges */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.15em] font-medium text-muted-foreground capitalize">
                {weekdayLong}, {dateLabel !== weekdayLong ? dateLabel : format(date, "d/MM")}
              </span>
              {esc.solene && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/25">Solene</span>
              )}
              {isToday(date) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-400/30 font-medium">Hoje!</span>
              ) : diasFaltam === 1 ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">Amanhã</span>
              ) : diasFaltam > 1 ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  Faltam {diasFaltam} dias
                </span>
              ) : null}
            </div>

            {/* Título da celebração */}
            <p className="font-semibold text-base leading-snug">{esc.titulo}</p>

            {/* Detalhes: função, hora, local */}
            <div className="flex flex-col gap-1 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: esc.ministerio_cor }} />
                <span className="text-muted-foreground/60 shrink-0">Função:</span>
                <span className="font-medium" style={{ color: esc.ministerio_cor }}>{esc.ministerio_nome}</span>
              </div>
              {esc.hora_inicio && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{esc.hora_inicio.slice(0, 5)}</span>
                </div>
              )}
              {esc.local && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{esc.local}</span>
                </div>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div className="shrink-0 self-start pt-0.5">
            {esc.status === "confirmado" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : esc.status === "pendente" ? (
              <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 whitespace-nowrap border border-amber-400/30">
                Responder
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── EscalaPreviewCard ────────────────────────────────────────────────

function EscalaPreviewCard({ esc }: { esc: EscalaItem }) {
  const date = new Date(esc.data + "T12:00:00");
  const diff = differenceInDays(date, new Date());

  const dateLabel = isToday(date)
    ? "Hoje"
    : isTomorrow(date)
    ? "Amanhã"
    : diff <= 7
    ? format(date, "EEEE", { locale: ptBR })
    : format(date, "d 'de' MMM", { locale: ptBR });

  const statusColor: Record<string, string> = {
    pendente: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    confirmado: "bg-green-500/15 text-green-700 dark:text-green-400",
    recusado: "bg-red-500/15 text-red-600",
  };

  return (
    <Link
      to="/portal-membro/escalas"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 hover:border-primary/40 hover:bg-primary/5 transition active:scale-[0.99]"
    >
      <div
        className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: esc.ministerio_cor }}
      >
        {esc.ministerio_nome.slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{esc.titulo}</p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span className="capitalize">{dateLabel}</span>
          {esc.hora_inicio && (
            <><span>·</span><Clock className="h-3 w-3" />{esc.hora_inicio.slice(0, 5)}</>
          )}
          {esc.local && (
            <><span>·</span><MapPin className="h-3 w-3" /><span className="truncate max-w-[140px]">{esc.local}</span></>
          )}
        </div>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor[esc.status] ?? "text-muted-foreground"}`}>
        {esc.status === "confirmado" ? "Confirmado" : esc.status === "pendente" ? "Responder" : esc.status}
      </span>
    </Link>
  );
}
