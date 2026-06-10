import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2, ShieldCheck, Search, ChevronDown, ChevronUp,
  User, Calendar, Database, Activity,
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/auditoria")({
  component: AuditoriaPage,
  head: () => ({ meta: [{ title: "Auditoria — Lumen Pastoral" }] }),
});

type AuditLog = {
  id: string;
  actor_nome: string | null;
  actor_user_id: string | null;
  entidade: string;
  entidade_id: string | null;
  acao: "INSERT" | "UPDATE" | "DELETE";
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

const ENTIDADE_LABEL: Record<string, string> = {
  membros: "Membros",
  escalas: "Escalas",
  escala_membros: "Escala — atribuições",
  historico_participacoes: "Histórico / Pontuação",
  ocorrencias_membros: "Ocorrências",
  user_roles: "Permissões",
  paroquias: "Configurações da paróquia",
};

const ACAO_COLOR: Record<string, string> = {
  INSERT: "text-green-600 bg-green-50 border-green-200",
  UPDATE: "text-amber-600 bg-amber-50 border-amber-200",
  DELETE: "text-destructive bg-destructive/5 border-destructive/20",
};

const ACAO_LABEL: Record<string, string> = {
  INSERT: "Criação",
  UPDATE: "Edição",
  DELETE: "Exclusão",
};

const PERIOD_OPTIONS = [
  { value: "1",  label: "Últimas 24h" },
  { value: "7",  label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
];

function AuditoriaPage() {
  const { isAdmin, isCoordenador } = useAuth();
  const [period, setPeriod]       = useState("7");
  const [entidade, setEntidade]   = useState("todas");
  const [acao, setAcao]           = useState("todas");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);

  const desde = startOfDay(subDays(new Date(), Number(period)));
  const ate   = endOfDay(new Date());

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["audit-logs", period, entidade, acao],
    enabled: isAdmin || isCoordenador,
    staleTime: 30_000,
    queryFn: async () => {
      let q = anyDb
        .from("audit_logs")
        .select("id, actor_nome, actor_user_id, entidade, entidade_id, acao, dados_anteriores, dados_novos, ip, created_at")
        .gte("created_at", desde.toISOString())
        .lte("created_at", ate.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);

      if (entidade !== "todas") q = q.eq("entidade", entidade);
      if (acao !== "todas")     q = q.eq("acao", acao);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });

  const filtered = logs.filter((l) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (l.actor_nome ?? "").toLowerCase().includes(s) ||
      l.entidade.toLowerCase().includes(s) ||
      (l.entidade_id ?? "").toLowerCase().includes(s)
    );
  });

  if (!isAdmin && !isCoordenador) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm">
        Acesso restrito a administradores e coordenadores.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            Auditoria
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registro de todas as ações críticas realizadas na paróquia.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-1.5">
          <Activity className="h-3.5 w-3.5" />
          {filtered.length} evento{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Período</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Entidade</Label>
          <Select value={entidade} onValueChange={setEntidade}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {Object.entries(ENTIDADE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Ação</Label>
          <Select value={acao} onValueChange={setAcao}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="INSERT">Criações</SelectItem>
              <SelectItem value="UPDATE">Edições</SelectItem>
              <SelectItem value="DELETE">Exclusões</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Usuário, entidade…"
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nenhum evento encontrado para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((log) => (
            <LogItem
              key={log.id}
              log={log}
              expanded={expanded === log.id}
              onToggle={() => setExpanded(expanded === log.id ? null : log.id)}
            />
          ))}
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

// ── Log Item ──────────────────────────────────────────────────────────────────

function LogItem({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const acaoClass = ACAO_COLOR[log.acao] ?? "text-muted-foreground bg-muted border-border";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition"
      >
        {/* Badge ação */}
        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider border rounded-md px-2 py-0.5 ${acaoClass}`}>
          {ACAO_LABEL[log.acao] ?? log.acao}
        </span>

        {/* Entidade */}
        <span className="flex items-center gap-1.5 text-sm font-medium min-w-0 flex-1">
          <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{ENTIDADE_LABEL[log.entidade] ?? log.entidade}</span>
        </span>

        {/* Actor */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <User className="h-3 w-3" />
          {log.actor_nome ?? "Sistema"}
        </span>

        {/* Data */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 ml-2">
          <Calendar className="h-3 w-3" />
          {format(new Date(log.created_at), "dd MMM HH:mm", { locale: ptBR })}
        </span>

        {/* Chevron */}
        <span className="ml-1 text-muted-foreground shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground mb-0.5">ID do registro</p>
              <code className="font-mono text-foreground/70 break-all">{log.entidade_id ?? "—"}</code>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">ID do usuário</p>
              <code className="font-mono text-foreground/70 break-all">{log.actor_user_id ?? "sistema"}</code>
            </div>
            {log.ip && (
              <div>
                <p className="text-muted-foreground mb-0.5">IP</p>
                <code className="font-mono text-foreground/70">{log.ip}</code>
              </div>
            )}
            <div>
              <p className="text-muted-foreground mb-0.5">Data/hora completa</p>
              <span className="text-foreground/70">
                {format(new Date(log.created_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {log.dados_anteriores && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Estado anterior</p>
                <pre className="text-xs bg-background border border-border rounded-lg p-2.5 overflow-auto max-h-48 text-foreground/70 whitespace-pre-wrap">
                  {JSON.stringify(log.dados_anteriores, null, 2)}
                </pre>
              </div>
            )}
            {log.dados_novos && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  {log.acao === "INSERT" ? "Dados criados" : "Dados atualizados"}
                </p>
                <pre className="text-xs bg-background border border-border rounded-lg p-2.5 overflow-auto max-h-48 text-foreground/70 whitespace-pre-wrap">
                  {JSON.stringify(log.dados_novos, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
