import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Activity, Search } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSetPageTabs } from "@/contexts/page-tabs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/auditoria")({
  component: AtividadePage,
  head: () => ({ meta: [{ title: "Atividade do Sistema — Lumen Pastoral" }] }),
});

type AuditLog = {
  id: string;
  actor_nome: string | null;
  entidade: string;
  entidade_id: string | null;
  acao: "INSERT" | "UPDATE" | "DELETE";
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  created_at: string;
};

// ── Formatação em linguagem humana ───────────────────────────────────────────

const CATEGORIA_MAP: Record<string, string> = {
  escalas:                 "escalas",
  escala_membros:          "escalas",
  historico_participacoes: "presenças",
  membros:                 "membros",
  user_roles:              "configurações",
  paroquias:               "configurações",
  ocorrencias_membros:     "membros",
  substituicoes:           "substituições",
};

function categoriaEvento(log: AuditLog): string {
  return CATEGORIA_MAP[log.entidade] ?? "outros";
}

function nomeCurto(nome: string | null): string {
  if (!nome) return "Sistema";
  const partes = nome.trim().split(" ");
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function formatarAtividade(log: AuditLog): { emoji: string; texto: string; detalhe?: string } {
  const actor = nomeCurto(log.actor_nome);
  const novo = log.dados_novos ?? {};
  const ant = log.dados_anteriores ?? {};

  switch (log.entidade) {
    case "escalas": {
      const titulo = str(novo.titulo ?? ant.titulo) || "escala sem título";
      const data = str(novo.data ?? ant.data);
      const dataFmt = data ? ` do dia ${format(new Date(data + "T00:00:00"), "d 'de' MMM", { locale: ptBR })}` : "";
      if (log.acao === "INSERT") return { emoji: "📅", texto: `${actor} criou a escala "${titulo}"`, detalhe: dataFmt ? `Escala${dataFmt}` : undefined };
      if (log.acao === "DELETE") return { emoji: "🗑️", texto: `${actor} excluiu a escala "${titulo}"` };
      const novoStatus = str(novo.status);
      const antStatus = str(ant.status);
      if (novoStatus === "publicada" && antStatus !== "publicada")
        return { emoji: "✅", texto: `${actor} publicou a escala "${titulo}"` };
      if (novoStatus === "arquivada")
        return { emoji: "📦", texto: `${actor} arquivou a escala "${titulo}"` };
      if (novoStatus === "rascunho")
        return { emoji: "✏️", texto: `${actor} voltou a escala "${titulo}" para rascunho` };
      return { emoji: "✏️", texto: `${actor} editou a escala "${titulo}"` };
    }

    case "escala_membros": {
      const novoStatus = str(novo.status);
      const antStatus = str(ant.status);
      const finalStatuses = ["presente", "faltou", "atrasado", "justificou"];
      if (finalStatuses.includes(novoStatus) && !finalStatuses.includes(antStatus)) {
        const label: Record<string, string> = { presente: "presença", faltou: "falta", atrasado: "atraso", justificou: "justificativa" };
        return { emoji: "📋", texto: `${actor} registrou ${label[novoStatus] ?? novoStatus} de um servidor` };
      }
      if (log.acao === "INSERT")
        return { emoji: "➕", texto: `${actor} adicionou um servidor a uma escala` };
      if (log.acao === "DELETE")
        return { emoji: "➖", texto: `${actor} removeu um servidor de uma escala` };
      return { emoji: "🔄", texto: `${actor} atualizou atribuição em uma escala` };
    }

    case "historico_participacoes": {
      if (log.acao === "INSERT")
        return { emoji: "🏅", texto: `${actor} registrou participação/pontuação de um servidor` };
      return { emoji: "🔄", texto: `${actor} atualizou histórico de participação` };
    }

    case "membros": {
      const nome = str(novo.nome ?? ant.nome) || "membro";
      if (log.acao === "INSERT") return { emoji: "👤", texto: `Novo membro cadastrado: ${nome}` };
      if (log.acao === "DELETE") return { emoji: "🗑️", texto: `${actor} removeu o membro ${nome}` };
      if (novo.conta_ativada === true && ant.conta_ativada !== true)
        return { emoji: "🔑", texto: `${nome} ativou sua conta` };
      if (novo.perfil_completo === true && ant.perfil_completo !== true)
        return { emoji: "✅", texto: `${nome} completou seu perfil` };
      return { emoji: "✏️", texto: `${actor} editou o perfil de ${nome}` };
    }

    case "ocorrencias_membros": {
      const tipo = str(novo.tipo ?? ant.tipo).replace(/_/g, " ") || "ocorrência";
      if (log.acao === "INSERT")
        return { emoji: "📣", texto: `Nova ocorrência registrada: ${tipo}` };
      const novoStatus = str(novo.status);
      if (novoStatus === "resolvida") return { emoji: "✅", texto: `${actor} resolveu uma ocorrência` };
      if (novoStatus === "arquivada") return { emoji: "📦", texto: `${actor} arquivou uma ocorrência` };
      if (novoStatus === "em_analise") return { emoji: "🔍", texto: `${actor} colocou ocorrência em análise` };
      return { emoji: "💬", texto: `${actor} respondeu a uma ocorrência` };
    }

    case "substituicoes": {
      if (log.acao === "INSERT") return { emoji: "🔄", texto: `${actor} solicitou uma substituição` };
      const novoStatus = str(novo.status);
      if (novoStatus === "aceita") return { emoji: "✅", texto: `Uma substituição foi aceita` };
      if (novoStatus === "recusada") return { emoji: "❌", texto: `Uma substituição foi recusada` };
      return { emoji: "🔄", texto: `${actor} atualizou uma substituição` };
    }

    case "user_roles": {
      const role = str(novo.role ?? ant.role);
      const ROLE_LABELS: Record<string, string> = { admin: "administrador", coordenador: "coordenador", auxiliar: "auxiliar" };
      if (log.acao === "INSERT")
        return { emoji: "🔐", texto: `${actor} adicionou um usuário como ${ROLE_LABELS[role] ?? role}` };
      if (log.acao === "DELETE")
        return { emoji: "🔓", texto: `${actor} removeu acesso de um usuário` };
      return { emoji: "🔐", texto: `${actor} alterou permissão de um usuário para ${ROLE_LABELS[role] ?? role}` };
    }

    case "paroquias": {
      return { emoji: "⛪", texto: `${actor} atualizou as configurações da paróquia` };
    }

    default: {
      const labels: Record<string, string> = { INSERT: "criou", UPDATE: "editou", DELETE: "excluiu" };
      return {
        emoji: "⚙️",
        texto: `${actor} ${labels[log.acao] ?? log.acao} em ${log.entidade}`,
      };
    }
  }
}

// ── Filtros de categoria ──────────────────────────────────────────────────────

const FILTROS = [
  { value: "todos",         label: "Todos" },
  { value: "escalas",       label: "Escalas" },
  { value: "membros",       label: "Membros" },
  { value: "substituições", label: "Substituições" },
  { value: "presenças",     label: "Presenças" },
  { value: "configurações", label: "Configurações" },
];

const PERIOD_OPTIONS = [
  { value: "1",  label: "Últimas 24h" },
  { value: "7",  label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
];

// ── Componente ────────────────────────────────────────────────────────────────

function AtividadePage() {
  const { isAdmin, isCoordenador } = useAuth();
  const [period, setPeriod]       = useState("7");
  const [filtro, setFiltro]       = useState("todos");
  const [search, setSearch]       = useState("");

  const desde = startOfDay(subDays(new Date(), Number(period)));
  const ate   = endOfDay(new Date());

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["audit-logs", period],
    enabled: isAdmin || isCoordenador,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("audit_logs")
        .select("id, actor_nome, entidade, entidade_id, acao, dados_anteriores, dados_novos, created_at")
        .gte("created_at", desde.toISOString())
        .lte("created_at", ate.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });

  const filtered = logs.filter((l) => {
    if (filtro !== "todos" && categoriaEvento(l) !== filtro) return false;
    if (search.trim()) {
      const { texto } = formatarAtividade(l);
      if (!texto.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  useSetPageTabs([
    { label: "Geral",       to: "/configuracoes/paroquia",        isActive: false },
    { label: "Motor",       to: "/configuracoes-escalas",         isActive: false },
    { label: "Coordenação", to: "/configuracoes/administradores", isActive: false },
    { label: "Auditoria",   to: "/auditoria",                     isActive: true  },
  ]);

  if (!isAdmin && !isCoordenador) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Acesso restrito a administradores e coordenadores.
      </div>
    );
  }

  const grupos = filtered.reduce<Record<string, AuditLog[]>>((acc, log) => {
    const dia = format(new Date(log.created_at), "yyyy-MM-dd");
    if (!acc[dia]) acc[dia] = [];
    acc[dia].push(log);
    return acc;
  }, {});

  const diasOrdenados = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">

      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Configurações</p>
        <h1 className="mt-2 font-serif text-2xl sm:text-4xl">Atividade do Sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registro de ações realizadas na paróquia.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar atividade…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Chips de categoria */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar mb-5">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFiltro(f.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              filtro === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma atividade encontrada.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {diasOrdenados.map((dia) => {
            const d = new Date(dia + "T00:00:00");
            const hoje = format(new Date(), "yyyy-MM-dd");
            const ontem = format(subDays(new Date(), 1), "yyyy-MM-dd");
            const label =
              dia === hoje ? "Hoje"
              : dia === ontem ? "Ontem"
              : format(d, "d 'de' MMMM", { locale: ptBR });

            return (
              <div key={dia}>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  {label}
                </p>
                <div className="space-y-1">
                  {grupos[dia].map((log) => {
                    const { emoji, texto, detalhe } = formatarAtividade(log);
                    return (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 hover:bg-muted/20 transition"
                      >
                        <span className="text-lg leading-none mt-0.5 shrink-0">{emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground/90 leading-snug">{texto}</p>
                          {detalhe && (
                            <p className="text-xs text-muted-foreground mt-0.5">{detalhe}</p>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">
                          {format(new Date(log.created_at), "HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 500 && (
            <p className="text-xs text-center text-muted-foreground pt-2">
              Exibindo os 500 eventos mais recentes. Use filtros para refinar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
