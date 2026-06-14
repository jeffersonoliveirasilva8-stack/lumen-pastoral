import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserCheck, UserX, Mail, AlertCircle, CheckCircle2, RefreshCw,
  Loader2, Link2, ShieldAlert, ShieldCheck, Clock, Activity, Key,
  LogIn, UserCog, TriangleAlert, WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AccessInvitationService } from "@/lib/invitation-service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

// ── Types ────────────────────────────────────────────────────────────────────

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
};

type AuthSemMembro = {
  auth_user_id: string;
  email: string;
  criado_em: string;
  ultimo_login: string | null;
  email_confirmado: boolean;
  tem_profile: boolean;
  tem_role: boolean;
};

type AtivadoSemLogin = {
  membro_id: string;
  nome: string;
  email: string | null;
  auth_user_id: string | null;
  conta_ativada: boolean;
  ultimo_login: string | null;
  ativado_em: string | null;
  token_acesso: string | null;
  token_expirado: boolean;
};

type EmailLogsStat = {
  total_enviados: number;
  entregues: number;
  com_erro: number;
  via_fallback: number;
  ultimo_envio: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function dt(s: string | null) {
  if (!s) return "—";
  return format(new Date(s), "dd/MM/yy HH:mm", { locale: ptBR });
}

function ago(s: string | null) {
  if (!s) return "—";
  return formatDistanceToNow(new Date(s), { addSuffix: true, locale: ptBR });
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, color = "text-foreground", alert = false,
}: { icon: typeof Users; label: string; value: number | undefined; color?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 flex items-center gap-3 ${alert && (value ?? 0) > 0 ? "border-destructive/30" : "border-border"}`}>
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${alert && (value ?? 0) > 0 ? "bg-destructive/10" : "bg-muted"}`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={`text-xl font-bold ${color}`}>{value ?? "—"}</p>
      </div>
    </div>
  );
}

const TIPO_CFG: Record<string, { label: string; cor: string; icon: typeof AlertCircle }> = {
  nunca_convidado:     { label: "Nunca convidado",      cor: "text-orange-600 bg-orange-50 border-orange-200",  icon: Mail },
  aguardando_ativacao: { label: "Aguardando ativação",  cor: "text-amber-600 bg-amber-50 border-amber-200",     icon: Clock },
  sem_profile:         { label: "Sem profile",          cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_role:            { label: "Sem role",             cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_email:           { label: "Sem e-mail",           cor: "text-slate-500 bg-slate-50 border-slate-200",     icon: WifiOff },
};

// ── Main Component ──────────────────────────────────────────────────────────

type Tab = "geral" | "problemas" | "auth_sem_membro" | "sem_login";

export default function DiagnosticoAtivacao() {
  const qc = useQueryClient();
  const [tab, setTab]                   = useState<Tab>("geral");
  const [filtroTipo, setFiltroTipo]     = useState<string | null>(null);
  const [reparando, setReparando]       = useState<string | null>(null);
  const [paroquiaNome, setParoquiaNome] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────

  useQuery({
    queryKey: ["diag-paroquia"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await anyDb.from("profiles").select("paroquia_id, paroquias!inner(nome)").eq("id", user.id).maybeSingle();
      const nome = (data?.paroquias as any)?.nome ?? "";
      setParoquiaNome(nome);
      return nome;
    },
  });

  const { data: stats, isLoading: loadingStats, refetch: refetchStats } = useQuery<AtivacaoStats>({
    queryKey: ["diag-stats"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_ativacao_stats");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const { data: emailStats } = useQuery<EmailLogsStat>({
    queryKey: ["diag-email-stats"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_email_logs_stats");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const { data: inconsistentes = [], isLoading: loadingIncons, refetch: refetchIncons } = useQuery<MembroInconsistente[]>({
    queryKey: ["diag-inconsistentes"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_membros_inconsistentes");
      if (error) throw error;
      return (data ?? []) as MembroInconsistente[];
    },
  });

  const { data: authSemMembro = [], isLoading: loadingAuth, refetch: refetchAuth } = useQuery<AuthSemMembro[]>({
    queryKey: ["diag-auth-sem-membro"],
    enabled: tab === "auth_sem_membro",
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_auth_sem_membro");
      if (error) throw error;
      return (data ?? []) as AuthSemMembro[];
    },
  });

  const { data: ativadosSemLogin = [], isLoading: loadingSemLogin, refetch: refetchSemLogin } = useQuery<AtivadoSemLogin[]>({
    queryKey: ["diag-ativados-sem-login"],
    enabled: tab === "sem_login",
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_ativados_sem_login");
      if (error) throw error;
      return (data ?? []) as AtivadoSemLogin[];
    },
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  async function reenviarEmail(m: MembroInconsistente) {
    if (!m.email || !m.token_acesso) { toast.error("Membro sem e-mail ou token"); return; }
    setReparando(m.membro_id + ":email");
    try {
      const r = await AccessInvitationService.sendEmail({
        email: m.email, nome: m.nome, paroquiaNome,
        tokenAcesso: m.token_acesso, template: "reenvio_ativacao",
      });
      if (r.ok) { toast.success(`Link enviado para ${m.nome}`); refetchIncons(); refetchStats(); }
      else if (r.cooldown) toast.info(`Aguarde ${r.cooldown}s para reenviar.`);
      else toast.error("Erro: " + r.error);
    } finally { setReparando(null); }
  }

  async function vincularAuth(m: MembroInconsistente) {
    setReparando(m.membro_id + ":vincular");
    try {
      const { data, error } = await anyDb.rpc("admin_vincular_auth_membro", { p_membro_id: m.membro_id });
      if (error) throw error;
      if (data?.success) {
        const msg = data.acao === "already_linked" ? "Já estava vinculado." : "auth_user_id vinculado com sucesso.";
        toast.success(msg);
        invalidateAll();
      } else {
        const msgs: Record<string, string> = {
          no_email: "Membro não tem e-mail cadastrado.",
          auth_user_not_found: "Nenhum usuário auth encontrado com este e-mail. O membro precisa clicar no link de ativação primeiro.",
          member_not_found: "Membro não encontrado nesta paróquia.",
        };
        toast.error(msgs[data?.error] ?? "Erro: " + data?.error);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setReparando(null); }
  }

  async function recriarProfileRole(memberId: string, nome: string) {
    setReparando(memberId + ":profile");
    try {
      const { data, error } = await anyDb.rpc("admin_recriar_profile_role", { p_membro_id: memberId });
      if (error) throw error;
      if (data?.success) { toast.success(`Profile e role de ${nome} recriados.`); invalidateAll(); }
      else {
        const msgs: Record<string, string> = {
          sem_auth_user_id: "Membro não tem auth_user_id. Vincule antes de recriar o perfil.",
        };
        toast.error(msgs[data?.error] ?? "Erro: " + data?.error);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setReparando(null); }
  }

  async function reprocessarTodos() {
    setReparando("reprocessar");
    try {
      const { data, error } = await anyDb.rpc("admin_reprocessar_pendentes");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const ok = rows.filter((r) => r.acao !== "sem_auth").length;
      const semAuth = rows.filter((r) => r.acao === "sem_auth").length;
      toast.success(`Reprocessamento concluído: ${ok} ativados${semAuth > 0 ? `, ${semAuth} aguardam convite` : ""}.`);
      invalidateAll();
    } catch (e: any) { toast.error(e.message); }
    finally { setReparando(null); }
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["diag-stats"] });
    qc.invalidateQueries({ queryKey: ["diag-inconsistentes"] });
    qc.invalidateQueries({ queryKey: ["diag-auth-sem-membro"] });
    qc.invalidateQueries({ queryKey: ["diag-ativados-sem-login"] });
  }

  // ── Filtered problems ────────────────────────────────────────────────────

  const problemasFiltrados = filtroTipo
    ? inconsistentes.filter((m) => m.tipo_problema === filtroTipo)
    : inconsistentes;

  const tiposPresentes = Array.from(new Set(inconsistentes.map((m) => m.tipo_problema)));

  // ── Render ───────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: "geral",          label: "Visão Geral" },
    { key: "problemas",      label: "Problemas",         count: inconsistentes.length },
    { key: "auth_sem_membro",label: "Auth sem Membro",   count: authSemMembro.length > 0 ? authSemMembro.length : undefined },
    { key: "sem_login",      label: "Ativados sem Login" },
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-serif">Diagnóstico de Ativação</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Saúde técnica do fluxo de ativação — dados em tempo real do banco.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => { invalidateAll(); refetchStats(); }}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
          <Button
            size="sm" variant="destructive"
            disabled={reparando === "reprocessar"}
            onClick={reprocessarTodos}
            className="gap-1.5"
          >
            {reparando === "reprocessar"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Activity className="h-3.5 w-3.5" />
            }
            Reprocessar todos
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${
                tab === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Visão Geral ─────────────────────────────────────────────── */}
      {tab === "geral" && (
        <div className="space-y-6">

          {/* KPIs de membros */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Membros</p>
            {loadingStats ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <KpiCard icon={Users}      label="Total membros ativos"     value={stats?.total_membros}      color="text-foreground" />
                <KpiCard icon={CheckCircle2} label="Conta ativada"           value={stats?.conta_ativada}      color="text-green-600" />
                <KpiCard icon={Clock}      label="Pendentes de ativação"    value={stats?.pendentes_ativacao} color="text-amber-600" alert />
                <KpiCard icon={Mail}       label="Convite enviado"          value={stats?.convite_enviado}    color="text-blue-600" />
                <KpiCard icon={UserX}      label="Nunca convidados"         value={stats?.nunca_convidados}   color="text-orange-600" alert />
                <KpiCard icon={LogIn}      label="Logins realizados"        value={stats?.logins_realizados}  color="text-green-600" />
                <KpiCard icon={UserCog}    label="Ativados sem login"       value={stats?.sem_login_pos_ativacao} color="text-sky-600" alert />
                <KpiCard icon={WifiOff}    label="Sem e-mail"               value={stats?.sem_email}          color="text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Estado técnico */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Estado técnico</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KpiCard icon={Link2}      label="Sem auth_user_id"      value={stats?.sem_auth_user} color="text-red-600" alert />
              <KpiCard icon={ShieldAlert} label="Sem profile"           value={stats?.sem_profile}   color="text-red-600" alert />
              <KpiCard icon={Key}        label="Sem role"               value={stats?.sem_role}      color="text-red-600" alert />
            </div>
          </div>

          {/* Entregabilidade */}
          {emailStats && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Entregabilidade de e-mail</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard icon={Mail}        label="Total enviados"  value={emailStats.total_enviados} color="text-foreground" />
                <KpiCard icon={CheckCircle2} label="Entregues"      value={emailStats.entregues}      color="text-green-600" />
                <KpiCard icon={AlertCircle} label="Com erro"        value={emailStats.com_erro}       color="text-destructive" alert />
                <KpiCard icon={Activity}    label="Via fallback"    value={emailStats.via_fallback}   color="text-sky-600" />
              </div>
              {emailStats.ultimo_envio && (
                <p className="text-xs text-muted-foreground mt-2">
                  Último envio: {ago(emailStats.ultimo_envio)}
                </p>
              )}
            </div>
          )}

          {/* Fluxograma resumido */}
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Fluxo de ativação — pontos de falha rastreados</p>
            <ol className="space-y-2 text-sm">
              {[
                { step: "1", label: "Admin aprova solicitação",        ok: true },
                { step: "2", label: "Edge Function envia e-mail (Resend)", ok: !!emailStats && emailStats.com_erro === 0 },
                { step: "3", label: "Membro clica no link → /membro/primeiro-acesso", ok: true },
                { step: "4", label: "PASSWORD_RECOVERY → AuthSync não redireciona (P0 corrigido)", ok: true },
                { step: "5", label: "Membro define senha → ativar_conta_membro()", ok: true },
                { step: "6", label: "portal_auto_link_by_email() → profile + role criados", ok: (stats?.sem_profile ?? 0) === 0 && (stats?.sem_role ?? 0) === 0 },
                { step: "7", label: "Login com email+senha → getPostLoginRoute → /portal-membro/home", ok: true },
              ].map(({ step, label, ok }) => (
                <li key={step} className="flex items-start gap-2">
                  <span className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${ok ? "bg-green-100 text-green-700" : "bg-destructive/10 text-destructive"}`}>
                    {step}
                  </span>
                  <span className={ok ? "text-foreground" : "text-destructive font-medium"}>{label}</span>
                  {!ok && <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* ── Tab: Problemas ───────────────────────────────────────────────── */}
      {tab === "problemas" && (
        <div className="space-y-4">

          {/* Filtros por tipo */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFiltroTipo(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${!filtroTipo ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              Todos ({inconsistentes.length})
            </button>
            {tiposPresentes.map((tipo) => {
              const cfg = TIPO_CFG[tipo] ?? { label: tipo, cor: "text-muted-foreground bg-muted border-border", icon: AlertCircle };
              const count = inconsistentes.filter((m) => m.tipo_problema === tipo).length;
              return (
                <button
                  key={tipo}
                  onClick={() => setFiltroTipo(filtroTipo === tipo ? null : tipo)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${filtroTipo === tipo ? `${cfg.cor} ring-1 ring-current/30` : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>

          {loadingIncons ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : problemasFiltrados.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center gap-2">
              <ShieldCheck className="h-8 w-8 text-green-500" />
              <p className="font-medium text-green-700">Nenhum problema encontrado</p>
              <p className="text-sm text-muted-foreground">Todos os membros estão com o fluxo de ativação íntegro.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {problemasFiltrados.map((m) => {
                const cfg = TIPO_CFG[m.tipo_problema] ?? { label: m.tipo_problema, cor: "text-muted-foreground bg-muted border-border", icon: AlertCircle };
                const Icon = cfg.icon;
                const isReparando = (key: string) => reparando === `${m.membro_id}:${key}`;

                return (
                  <div key={`${m.membro_id}-${m.tipo_problema}`} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.cor}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{m.nome}</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.cor}`}>
                            {cfg.label}
                          </span>
                          {m.auth_user_id && (
                            <span className="text-[10px] text-muted-foreground font-mono bg-muted rounded px-1.5 py-0.5">
                              auth ✓
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.email ?? "sem e-mail"}</p>
                        <p className="text-xs text-muted-foreground mt-1">{m.detalhe}</p>
                        {m.ativacao_enviada_em && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Último convite: {ago(m.ativacao_enviada_em)}
                          </p>
                        )}
                      </div>

                      {/* Ações por tipo */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {(m.tipo_problema === "nunca_convidado" || m.tipo_problema === "aguardando_ativacao") && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando || !m.email || !m.token_acesso}
                            onClick={() => reenviarEmail(m)}
                          >
                            {isReparando("email")
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Mail className="h-3 w-3" />
                            }
                            Enviar link
                          </Button>
                        )}

                        {m.tipo_problema === "nunca_convidado" && !m.auth_user_id && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando || !m.email}
                            onClick={() => vincularAuth(m)}
                          >
                            {isReparando("vincular")
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Link2 className="h-3 w-3" />
                            }
                            Vincular auth
                          </Button>
                        )}

                        {(m.tipo_problema === "sem_profile" || m.tipo_problema === "sem_role") && m.auth_user_id && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando}
                            onClick={() => recriarProfileRole(m.membro_id, m.nome)}
                          >
                            {isReparando("profile")
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <UserCheck className="h-3 w-3" />
                            }
                            Recriar perfil
                          </Button>
                        )}

                        {(m.tipo_problema === "sem_profile" || m.tipo_problema === "sem_role") && !m.auth_user_id && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando || !m.email}
                            onClick={() => vincularAuth(m)}
                          >
                            {isReparando("vincular")
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Link2 className="h-3 w-3" />
                            }
                            Vincular + recriar
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Auth sem Membro ────────────────────────────────────────── */}
      {tab === "auth_sem_membro" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <strong>O que são:</strong> usuários que têm perfil nesta paróquia mas não estão vinculados a nenhum membro aprovado.
            Podem ser ex-membros desvinculados, duplicatas, ou usuários criados fora do fluxo de aprovação.
          </div>

          {loadingAuth ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : authSemMembro.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center gap-2">
              <ShieldCheck className="h-8 w-8 text-green-500" />
              <p className="font-medium text-green-700">Nenhum usuário auth órfão</p>
              <p className="text-sm text-muted-foreground">Todos os usuários auth desta paróquia estão vinculados a membros.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {authSemMembro.map((u) => (
                <div key={u.auth_user_id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <UserX className="h-3.5 w-3.5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{u.email}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">Criado: {dt(u.criado_em)}</span>
                        <span className="text-[11px] text-muted-foreground">Último login: {u.ultimo_login ? ago(u.ultimo_login) : "nunca"}</span>
                        {u.email_confirmado
                          ? <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">E-mail confirmado</span>
                          : <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">E-mail não confirmado</span>
                        }
                        {u.tem_profile
                          ? <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">Tem profile</span>
                          : <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Sem profile</span>
                        }
                        {u.tem_role
                          ? <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">Tem role</span>
                          : <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Sem role</span>
                        }
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">{u.auth_user_id}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm" variant="ghost" className="gap-1.5"
            onClick={() => refetchAuth()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Recarregar
          </Button>
        </div>
      )}

      {/* ── Tab: Ativados sem Login ──────────────────────────────────────── */}
      {tab === "sem_login" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-800 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
            <strong>O que são:</strong> membros com <code className="bg-sky-100 rounded px-1">conta_ativada = true</code> mas
            que nunca voltaram a fazer login após criar a senha.
            O acesso ao portal foi configurado mas não está sendo usado.
          </div>

          {loadingSemLogin ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : ativadosSemLogin.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="font-medium text-green-700">Todos os membros ativos já fizeram login</p>
            </div>
          ) : (
            <div className="space-y-2">
              {ativadosSemLogin.map((m) => {
                const isRep = reparando === `${m.membro_id}:email_sl`;
                return (
                  <div key={m.membro_id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-lg bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center shrink-0">
                        <UserCog className="h-3.5 w-3.5 text-sky-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{m.nome}</p>
                        <p className="text-xs text-muted-foreground">{m.email ?? "sem e-mail"}</p>
                        <div className="flex gap-3 mt-1 flex-wrap">
                          {m.ativado_em && (
                            <span className="text-[11px] text-muted-foreground">Ativado: {ago(m.ativado_em)}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground">Último login: nunca</span>
                          {m.token_expirado && (
                            <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                              Token expirado
                            </span>
                          )}
                          {!m.auth_user_id && (
                            <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                              Sem auth_user_id
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {m.email && m.token_acesso && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando}
                            onClick={async () => {
                              setReparando(`${m.membro_id}:email_sl`);
                              try {
                                const r = await AccessInvitationService.sendEmail({
                                  email: m.email!, nome: m.nome, paroquiaNome,
                                  tokenAcesso: m.token_acesso!, template: "reenvio_ativacao",
                                });
                                if (r.ok) { toast.success(`Link de acesso reenviado para ${m.nome}`); refetchSemLogin(); }
                                else if (r.cooldown) toast.info(`Aguarde ${r.cooldown}s.`);
                                else toast.error("Erro: " + r.error);
                              } finally { setReparando(null); }
                            }}
                          >
                            {isRep ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                            Reenviar link
                          </Button>
                        )}
                        {m.auth_user_id && (
                          <Button
                            size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                            disabled={!!reparando}
                            onClick={() => recriarProfileRole(m.membro_id, m.nome)}
                          >
                            {reparando === `${m.membro_id}:profile`
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <UserCheck className="h-3 w-3" />
                            }
                            Recriar perfil
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Button
            size="sm" variant="ghost" className="gap-1.5"
            onClick={() => refetchSemLogin()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Recarregar
          </Button>
        </div>
      )}

      {/* Rodapé de diagnóstico */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground text-sm mb-2">Ações críticas pendentes (P0 → P2)</p>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
          <span><strong>P0 CORRIGIDO</strong> — AuthSync não redireciona para /reset-senha quando RLS bloqueia query de membros (commit 5eb5323)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
          <span><strong>P0 CORRIGIDO</strong> — Migrations 034+035 incluem check_email_rate_limit, store_admin_mfa_code e ativar_conta_membro com nome_completo</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
          <span><strong>P0 MANUAL</strong> — Verificar se domínio lumenpastoral.com.br está verificado no Resend; se não, emails retornam 502</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
          <span><strong>P1</strong> — Confirmar VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY nas variáveis de ambiente do Vercel</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
          <span><strong>P2</strong> — console.* removidos em produção (esbuild drop); integrar Sentry para observabilidade</span>
        </div>
      </div>
    </div>
  );
}
