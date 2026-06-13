import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserCheck, UserX, Mail, AlertCircle, CheckCircle2, RefreshCw,
  Loader2, MessageCircle, X, ChevronDown, ChevronRight, Link2,
  ShieldAlert, ShieldCheck, Clock, Send, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccessInvitationService } from "@/lib/invitation-service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

// ── Types ──────────────────────────────────────────────────────────────────────

type AtivacaoStats = {
  total_membros: number;
  pendentes_ativacao: number;
  convite_enviado: number;
  nunca_convidados: number;
  conta_ativada: number;
  sem_email: number;
  sem_auth_user: number;
  sem_profile: number;
  sem_role: number;
  logins_realizados: number;
  sem_login_pos_ativacao: number;
};

type MembroInconsistente = {
  membro_id: string;
  nome: string;
  email: string | null;
  tipo_problema: string;
  detalhe: string;
  ativacao_enviada_em: string | null;
  auth_user_id: string | null;
  token_acesso: string | null;
  ultimo_login: string | null;
  criado_em: string | null;
};

type EmailLogsStat = {
  total_enviados: number;
  entregues: number;
  com_erro: number;
  via_fallback: number;
  ultimo_envio: string | null;
  ativacoes_novas: number;
  reenvios: number;
  resets_senha: number;
};

type EmailLogRecente = {
  id: string;
  tipo: string;
  destinatario: string;
  status: string;
  provider: string | null;
  erro: string | null;
  created_at: string;
};

type ResultadoReprocessamento = {
  membro_id: string;
  nome: string;
  email: string | null;
  acao: string;
  resultado: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const PROBLEMA_CFG: Record<string, { label: string; cor: string; icon: typeof AlertCircle }> = {
  nunca_convidado:     { label: "Nunca convidado",      cor: "text-orange-600 bg-orange-50 border-orange-200",  icon: Mail },
  aguardando_ativacao: { label: "Aguardando ativação",  cor: "text-amber-600 bg-amber-50 border-amber-200",     icon: Clock },
  sem_profile:         { label: "Sem profile",          cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_role:            { label: "Sem role",             cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_email:           { label: "Sem e-mail",           cor: "text-slate-600 bg-slate-50 border-slate-200",     icon: AlertCircle },
};

const ACAO_CFG: Record<string, { label: string; cor: string }> = {
  ativado:              { label: "Ativado",                    cor: "text-green-700 bg-green-50 border-green-200" },
  auth_vinculado:       { label: "Auth vinculado + ativado",   cor: "text-green-700 bg-green-50 border-green-200" },
  correcao_pos_ativacao:{ label: "Profile/role corrigidos",    cor: "text-blue-700 bg-blue-50 border-blue-200" },
  sem_auth:             { label: "Precisa de convite",         cor: "text-orange-700 bg-orange-50 border-orange-200" },
};

function fmtData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color, alert,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  sub?: string;
  color: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${alert && (value ?? 0) > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <span className={`text-2xl font-bold tabular-nums ${color}`}>
          {value === undefined ? "—" : value.toLocaleString("pt-BR")}
        </span>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function TipoBadge({ tipo }: { tipo: string }) {
  const cfg = PROBLEMA_CFG[tipo];
  if (!cfg) return <span className="text-xs text-muted-foreground">{tipo}</span>;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cor}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Diálogo de reprocessamento ─────────────────────────────────────────────────

function ReprocessarDialog({
  open, onClose, paroquiaNome,
}: {
  open: boolean;
  onClose: () => void;
  paroquiaNome: string;
}) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [resultados, setResultados] = useState<ResultadoReprocessamento[] | null>(null);

  async function handleReprocessar() {
    setRunning(true);
    setResultados(null);
    try {
      const { data, error } = await anyDb.rpc("admin_reprocessar_pendentes");
      if (error) throw error;
      setResultados((data ?? []) as ResultadoReprocessamento[]);
      qc.invalidateQueries({ queryKey: ["ativacao-stats"] });
      qc.invalidateQueries({ queryKey: ["ativacao-inconsistencias"] });
      qc.invalidateQueries({ queryKey: ["membros"] });
    } catch (err) {
      toast.error("Erro ao reprocessar: " + (err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const ativados = resultados?.filter((r) => r.acao !== "sem_auth") ?? [];
  const manuais  = resultados?.filter((r) => r.acao === "sem_auth") ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onClose(); if (!o) setResultados(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reprocessar membros pendentes</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!running && resultados === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Esta ação irá, para cada membro ativo com conta não ativada:
              </p>
              <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Vincular <code className="text-xs bg-muted px-1 rounded">auth_user_id</code> pelo e-mail (se disponível)</li>
                <li>Criar registro em <code className="text-xs bg-muted px-1 rounded">profiles</code> se ausente</li>
                <li>Criar <code className="text-xs bg-muted px-1 rounded">role</code> de membro em <code className="text-xs bg-muted px-1 rounded">user_roles</code> se ausente</li>
                <li>Marcar <code className="text-xs bg-muted px-1 rounded">conta_ativada = true</code> quando vinculado</li>
              </ol>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                Membros sem usuário auth (que ainda não clicaram no link de convite) <strong>não serão ativados automaticamente</strong> — precisam receber e clicar no link.
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
                <Button className="flex-1" onClick={handleReprocessar}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Reprocessar agora
                </Button>
              </div>
            </div>
          )}

          {running && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Reprocessando membros pendentes…</p>
            </div>
          )}

          {!running && resultados !== null && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-3 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">{ativados.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Recuperados automaticamente</p>
                </div>
                <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20 p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{manuais.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Exigem ação manual (reenviar convite)</p>
                </div>
              </div>

              {/* Lista de resultados */}
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {resultados.map((r, i) => {
                  const cfg = ACAO_CFG[r.acao] ?? { label: r.acao, cor: "text-muted-foreground bg-muted" };
                  return (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.nome}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{r.email ?? "sem e-mail"}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cor}`}>
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
                {resultados.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Nenhum membro pendente encontrado — tudo em ordem!
                  </p>
                )}
              </div>

              <Button className="w-full" onClick={() => { setResultados(null); onClose(); }}>
                Fechar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function AuditoriaAtivacao({
  paroquia,
}: {
  paroquia: { nome: string; slug: string | null } | null | undefined;
}) {
  const [filtroProblema, setFiltroProblema] = useState<string>("todos");
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [reprocessarOpen, setReprocessarOpen] = useState(false);
  const [showEmailLog, setShowEmailLog]       = useState(false);
  const [whatsappQueue, setWhatsappQueue]     = useState<MembroInconsistente[]>([]);
  const [whatsappIdx, setWhatsappIdx]         = useState(0);
  const [whatsappOpen, setWhatsappOpen]       = useState(false);
  const [enviandoId, setEnviandoId]           = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: stats, isLoading: loadingStats, refetch: refetchStats } = useQuery<AtivacaoStats>({
    queryKey: ["ativacao-stats"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_ativacao_stats");
      if (error) throw error;
      // rpc com RETURNS TABLE retorna array; pegamos o primeiro elemento
      return (Array.isArray(data) ? data[0] : data) as AtivacaoStats;
    },
    staleTime: 30_000,
  });

  const { data: inconsistencias = [], isLoading: loadingIncons, refetch: refetchIncons } = useQuery<MembroInconsistente[]>({
    queryKey: ["ativacao-inconsistencias"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_membros_inconsistentes");
      if (error) throw error;
      return (data ?? []) as MembroInconsistente[];
    },
    staleTime: 30_000,
  });

  const { data: emailStats, isLoading: loadingEmail } = useQuery<EmailLogsStat>({
    queryKey: ["email-logs-stats"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_email_logs_stats");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as EmailLogsStat;
    },
    staleTime: 60_000,
  });

  const { data: emailLogs = [], isLoading: loadingLogs } = useQuery<EmailLogRecente[]>({
    queryKey: ["email-logs-recentes"],
    enabled: showEmailLog,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_email_logs_recentes", { p_limit: 60 });
      if (error) throw error;
      return (data ?? []) as EmailLogRecente[];
    },
  });

  // ── Filtros ──────────────────────────────────────────────────────────────────

  const tiposPresentes = useMemo(() => {
    const s = new Set(inconsistencias.map((i) => i.tipo_problema));
    return [...s];
  }, [inconsistencias]);

  const filtradas = useMemo(() => {
    if (filtroProblema === "todos") return inconsistencias;
    return inconsistencias.filter((i) => i.tipo_problema === filtroProblema);
  }, [inconsistencias, filtroProblema]);

  // ── Helpers de ação ──────────────────────────────────────────────────────────

  async function handleReenviarEmail(m: MembroInconsistente) {
    if (!m.email || !m.token_acesso) {
      toast.error("Membro sem e-mail ou token de acesso.");
      return;
    }
    setEnviandoId(m.membro_id);
    try {
      const { ok, error } = await AccessInvitationService.sendEmail({
        email: m.email,
        nome: m.nome,
        paroquiaNome: paroquia?.nome ?? "Pastoral",
        tokenAcesso: m.token_acesso,
        template: "reenvio_ativacao",
      });
      if (ok) {
        toast.success(`Link de acesso enviado para ${m.email}`);
        refetchIncons();
        refetchStats();
      } else {
        toast.error("Falha ao enviar: " + (error ?? ""));
      }
    } finally {
      setEnviandoId(null);
    }
  }

  function handleWhatsApp(m: MembroInconsistente) {
    if (!m.token_acesso) { toast.error("Sem token de acesso para este membro."); return; }
    AccessInvitationService.whatsApp(m.token_acesso, m.nome);
  }

  function copiarLink(m: MembroInconsistente) {
    if (!m.token_acesso) { toast.error("Sem token de acesso."); return; }
    AccessInvitationService.copy(m.token_acesso);
    toast.success("Link copiado!");
  }

  // WhatsApp em lote: percorre a fila abrindo uma janela por vez
  function iniciarWhatsAppEmLote() {
    const pendentes = inconsistencias.filter(
      (m) => (m.tipo_problema === "nunca_convidado" || m.tipo_problema === "aguardando_ativacao") && m.token_acesso
    );
    if (pendentes.length === 0) { toast.info("Nenhum membro elegível para WhatsApp em lote."); return; }
    setWhatsappQueue(pendentes);
    setWhatsappIdx(0);
    setWhatsappOpen(true);
  }

  function handleProximoWhatsApp() {
    const m = whatsappQueue[whatsappIdx];
    if (m?.token_acesso) {
      AccessInvitationService.whatsApp(m.token_acesso, m.nome);
    }
    if (whatsappIdx + 1 < whatsappQueue.length) {
      setWhatsappIdx((i) => i + 1);
    } else {
      setWhatsappOpen(false);
      toast.success("WhatsApp em lote concluído!");
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  const totalInconsistencias = inconsistencias.length;

  return (
    <div className="space-y-6 mt-4">

      {/* ── Header com ações ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">Auditoria de ativação</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visibilidade total sobre o processo de ativação dos membros.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => { refetchStats(); refetchIncons(); }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
          </Button>
          <Button
            size="sm"
            onClick={() => setReprocessarOpen(true)}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reprocessar pendentes
          </Button>
        </div>
      </div>

      {/* ── Dashboard de KPIs ── */}
      {loadingStats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 h-20 animate-pulse bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard icon={Users}      label="Total membros ativos"      value={stats?.total_membros}          color="text-foreground" />
          <StatCard icon={UserCheck}  label="Conta ativada"             value={stats?.conta_ativada}          color="text-green-600" />
          <StatCard icon={UserX}      label="Pendentes de ativação"      value={stats?.pendentes_ativacao}     color="text-amber-600" alert />
          <StatCard icon={Send}       label="Convite enviado"            value={stats?.convite_enviado}        color="text-blue-600"  sub="aguardando clique" />
          <StatCard icon={Mail}       label="Nunca convidados"           value={stats?.nunca_convidados}       color="text-orange-600" alert sub="têm e-mail mas não receberam convite" />
          <StatCard icon={Activity}   label="Logins realizados"          value={stats?.logins_realizados}      color="text-primary" />
          <StatCard icon={Clock}      label="Ativados sem retorno"       value={stats?.sem_login_pos_ativacao} color="text-slate-500" sub="criaram senha mas não voltaram" />
          <StatCard icon={AlertCircle} label="Inconsistências"           value={totalInconsistencias}          color="text-destructive" alert sub="profile, role, auth ausentes" />
        </div>
      )}

      {/* ── Entregabilidade de e-mail ── */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Entregabilidade de e-mail</h3>
          </div>
          <button
            className="text-xs text-primary hover:underline flex items-center gap-1"
            onClick={() => setShowEmailLog((v) => !v)}
          >
            {showEmailLog ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showEmailLog ? "Ocultar" : "Ver histórico"}
          </button>
        </div>

        {loadingEmail ? (
          <div className="h-12 animate-pulse rounded-lg bg-muted/30" />
        ) : emailStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total enviados",  value: emailStats.total_enviados,  color: "text-foreground" },
              { label: "Entregues",       value: emailStats.entregues,        color: "text-green-600" },
              { label: "Com erro",        value: emailStats.com_erro,         color: "text-destructive" },
              { label: "Via OTP (falb.)", value: emailStats.via_fallback,     color: "text-amber-600" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-muted/20 p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum dado de e-mail disponível.</p>
        )}

        {emailStats?.ultimo_envio && (
          <p className="text-[11px] text-muted-foreground">
            Último envio: {fmtData(emailStats.ultimo_envio)}
            {" · "}
            Ativações novas: {emailStats.ativacoes_novas}
            {" · "}
            Reenvios: {emailStats.reenvios}
            {" · "}
            Resets de senha: {emailStats.resets_senha}
          </p>
        )}

        {/* Histórico de logs */}
        {showEmailLog && (
          <div className="space-y-2 pt-2 border-t border-border/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Últimas 60 entradas
            </p>
            {loadingLogs ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : emailLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nenhum registro de e-mail encontrado.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border text-xs">
                {emailLogs.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                    {l.status === "enviado" ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    ) : l.status === "erro" ? (
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                    ) : (
                      <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                    )}
                    <span className="flex-1 truncate text-muted-foreground">{l.destinatario}</span>
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {l.tipo?.replace(/_/g, " ")}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {new Date(l.created_at).toLocaleDateString("pt-BR")}
                    </span>
                    {l.erro && (
                      <span className="shrink-0 text-[10px] text-destructive truncate max-w-[120px]" title={l.erro}>
                        {l.erro}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Inconsistências ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold">
              Inconsistências
              {totalInconsistencias > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-white text-[10px] font-bold px-1">
                  {totalInconsistencias}
                </span>
              )}
            </h3>
          </div>

          {/* WhatsApp em lote */}
          <Button size="sm" variant="outline" className="h-7 text-xs border-green-400/50 text-green-700 hover:bg-green-50 dark:text-green-400" onClick={iniciarWhatsAppEmLote}>
            <MessageCircle className="h-3.5 w-3.5 mr-1 text-green-600" /> WhatsApp em lote
          </Button>
        </div>

        {/* Chips de filtro por tipo de problema */}
        {tiposPresentes.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-border/40 no-scrollbar">
            <button
              onClick={() => setFiltroProblema("todos")}
              className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition border ${filtroProblema === "todos" ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
            >
              Todos ({inconsistencias.length})
            </button>
            {tiposPresentes.map((tipo) => {
              const cfg = PROBLEMA_CFG[tipo];
              const count = inconsistencias.filter((i) => i.tipo_problema === tipo).length;
              return (
                <button
                  key={tipo}
                  onClick={() => setFiltroProblema(tipo)}
                  className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition border ${filtroProblema === tipo ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
                >
                  {cfg?.label ?? tipo} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Lista */}
        {loadingIncons ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="py-12 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto text-green-500 mb-3" />
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {totalInconsistencias === 0 ? "Nenhuma inconsistência encontrada!" : "Nenhum item para o filtro selecionado."}
            </p>
            {totalInconsistencias === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Todos os membros estão com perfil e acesso em ordem.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtradas.map((m, idx) => {
              const key = `${m.membro_id}-${m.tipo_problema}`;
              const expanded = expandedId === key;
              const isEnviando = enviandoId === m.membro_id;
              const podeEnviar = !!m.email && !!m.token_acesso;
              const podeWhats  = !!m.token_acesso;

              return (
                <div key={key} className="px-4 py-3 hover:bg-muted/20 transition">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {m.nome.charAt(0).toUpperCase()}
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{m.nome}</span>
                        <TipoBadge tipo={m.tipo_problema} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {m.email ?? "sem e-mail"}{m.ultimo_login ? ` · último login: ${fmtData(m.ultimo_login)}` : ""}
                      </p>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1 shrink-0">
                      {podeEnviar && (
                        <button
                          onClick={() => handleReenviarEmail(m)}
                          disabled={isEnviando}
                          className="p-1.5 rounded-lg hover:bg-muted transition text-muted-foreground hover:text-primary"
                          title="Enviar link por e-mail"
                        >
                          {isEnviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {podeWhats && (
                        <button
                          onClick={() => handleWhatsApp(m)}
                          className="p-1.5 rounded-lg hover:bg-muted transition text-muted-foreground hover:text-green-600"
                          title="Enviar pelo WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {podeWhats && (
                        <button
                          onClick={() => copiarLink(m)}
                          className="p-1.5 rounded-lg hover:bg-muted transition text-muted-foreground hover:text-foreground"
                          title="Copiar link de acesso"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedId(expanded ? null : key)}
                        className="p-1.5 rounded-lg hover:bg-muted transition text-muted-foreground"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Detalhes expandidos */}
                  {expanded && (
                    <div className="mt-3 ml-11 rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5 text-xs text-muted-foreground">
                      <p><strong className="text-foreground">Problema:</strong> {m.detalhe}</p>
                      {m.ativacao_enviada_em && <p><strong className="text-foreground">Convite enviado em:</strong> {fmtData(m.ativacao_enviada_em)}</p>}
                      {m.auth_user_id && <p><strong className="text-foreground">auth_user_id:</strong> <code className="bg-muted px-1 rounded">{m.auth_user_id}</code></p>}
                      {m.token_acesso && <p><strong className="text-foreground">token_acesso:</strong> <code className="bg-muted px-1 rounded">{m.token_acesso}</code></p>}
                      {m.criado_em && <p><strong className="text-foreground">Membro cadastrado em:</strong> {fmtData(m.criado_em)}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Diálogo de reprocessamento ── */}
      <ReprocessarDialog
        open={reprocessarOpen}
        onClose={() => setReprocessarOpen(false)}
        paroquiaNome={paroquia?.nome ?? "Pastoral"}
      />

      {/* ── Diálogo WhatsApp em lote ── */}
      <Dialog open={whatsappOpen} onOpenChange={(o) => !o && setWhatsappOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>WhatsApp em lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {whatsappIdx + 1} de {whatsappQueue.length}: enviando para{" "}
              <strong>{whatsappQueue[whatsappIdx]?.nome}</strong>
            </p>

            {/* Barra de progresso */}
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${((whatsappIdx) / whatsappQueue.length) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {whatsappIdx} / {whatsappQueue.length} enviados
              </p>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 px-3 py-2.5 text-xs text-green-800 dark:text-green-300">
              Clique em "Abrir WhatsApp" para enviar a mensagem. Após enviar, clique em "Próximo" para o membro seguinte.
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setWhatsappOpen(false)}>
                <X className="h-3.5 w-3.5 mr-1" /> Encerrar
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleProximoWhatsApp}
              >
                <MessageCircle className="h-3.5 w-3.5 mr-1" />
                {whatsappIdx + 1 < whatsappQueue.length ? "Abrir WhatsApp + Próximo" : "Último — Concluir"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
