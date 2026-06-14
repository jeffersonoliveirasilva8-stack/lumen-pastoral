import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserCheck, UserX, Mail, AlertCircle, CheckCircle2, RefreshCw,
  Loader2, MessageCircle, X, ChevronDown, ChevronRight, Link2,
  ShieldAlert, ShieldCheck, Clock, Send, Activity, Copy, Key,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccessInvitationService, isCooldownError, parseCooldownSeconds } from "@/lib/invitation-service";

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

type BatchResult = {
  membro_id: string;
  nome: string;
  email: string | null;
  status: "ok" | "erro" | "sem_email" | "sem_token" | "cooldown";
  mensagem?: string;
  cooldownSeconds?: number;
};

type FilterKey =
  | "todos"
  | "nunca_convidado"
  | "aguardando_ativacao"
  | "sem_profile"
  | "sem_role"
  | "sem_email"
  | "com_erro_email";

// ── Constantes ─────────────────────────────────────────────────────────────────

const PROBLEMA_CFG: Record<string, { label: string; cor: string; icon: typeof AlertCircle }> = {
  nunca_convidado:     { label: "Nunca convidado",      cor: "text-orange-600 bg-orange-50 border-orange-200",  icon: Mail },
  aguardando_ativacao: { label: "Aguardando ativação",  cor: "text-amber-600 bg-amber-50 border-amber-200",     icon: Clock },
  sem_profile:         { label: "Sem profile",          cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_role:            { label: "Sem role",             cor: "text-red-600 bg-red-50 border-red-200",           icon: ShieldAlert },
  sem_email:           { label: "Sem e-mail",           cor: "text-slate-600 bg-slate-50 border-slate-200",     icon: AlertCircle },
  com_erro_email:      { label: "Com erro de envio",    cor: "text-rose-600 bg-rose-50 border-rose-200",        icon: TriangleAlert },
};

const ACAO_CFG: Record<string, { label: string; cor: string }> = {
  ativado:               { label: "Ativado",                   cor: "text-green-700 bg-green-50 border-green-200" },
  auth_vinculado:        { label: "Auth vinculado + ativado",  cor: "text-green-700 bg-green-50 border-green-200" },
  correcao_pos_ativacao: { label: "Profile/role corrigidos",   cor: "text-blue-700 bg-blue-50 border-blue-200" },
  sem_auth:              { label: "Precisa de convite",        cor: "text-orange-700 bg-orange-50 border-orange-200" },
};

const ERROR_CATEGORIES: { label: string; cor: string; match: (erro: string | null, provider: string | null) => boolean }[] = [
  { label: "Aguardando cooldown", cor: "text-sky-700 bg-sky-50 border-sky-200",       match: (e) => isCooldownError(e) },
  { label: "Bounce permanente",   cor: "text-red-700 bg-red-50 border-red-200",       match: (e) => !!e && (e.toLowerCase().includes("bounce") || e.toLowerCase().includes("permanent")) },
  { label: "E-mail inválido",     cor: "text-rose-700 bg-rose-50 border-rose-200",    match: (e) => !!e && e.toLowerCase().includes("invalid") && e.toLowerCase().includes("email") },
  { label: "Caixa cheia",         cor: "text-orange-700 bg-orange-50 border-orange-200", match: (e) => !!e && (e.toLowerCase().includes("full") || e.toLowerCase().includes("quota") || e.toLowerCase().includes("mailbox")) },
  { label: "Rate limit",          cor: "text-amber-700 bg-amber-50 border-amber-200", match: (e, p) => p === "rate_limit" || (!!e && e.toLowerCase().includes("rate")) },
  { label: "Domínio rejeitou",    cor: "text-violet-700 bg-violet-50 border-violet-200", match: (e) => !!e && (e.toLowerCase().includes("domain") || e.toLowerCase().includes("rejected") || e.toLowerCase().includes("spf") || e.toLowerCase().includes("dkim")) },
  { label: "Falha Supabase/OTP",  cor: "text-blue-700 bg-blue-50 border-blue-200",   match: (e, p) => p === "supabase_otp" || (!!e && (e.toLowerCase().includes("supabase") || e.toLowerCase().includes("otp"))) },
  { label: "Sessão expirada",     cor: "text-slate-700 bg-slate-50 border-slate-200", match: (e) => !!e && e.toLowerCase().includes("expir") },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function classifyEmailError(erro: string | null, provider: string | null): string {
  for (const cat of ERROR_CATEGORIES) {
    if (cat.match(erro, provider)) return cat.label;
  }
  return "Erro desconhecido";
}

function fmtData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDataCurta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color, alert, active, onClick,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  sub?: string;
  color: string;
  alert?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const isAlert = alert && (value ?? 0) > 0;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={[
        "rounded-2xl border p-4 space-y-2 text-left w-full transition-all",
        isAlert ? "border-destructive/30 bg-destructive/5" : "border-border bg-card",
        onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/30 hover:shadow-sm" : "",
        active ? "ring-2 ring-primary/60 shadow-sm" : "",
      ].join(" ")}
    >
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
    </Wrapper>
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

function ErrorCategoryBadge({ erro, provider }: { erro: string | null; provider: string | null }) {
  const cat = ERROR_CATEGORIES.find((c) => c.match(erro, provider));
  const label = cat?.label ?? "Erro desconhecido";
  const cor   = cat?.cor   ?? "text-slate-600 bg-slate-50 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cor}`}>
      <TriangleAlert className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── Diálogo de reprocessamento ─────────────────────────────────────────────────

function ReprocessarDialog({ open, onClose, paroquiaNome }: { open: boolean; onClose: () => void; paroquiaNome: string }) {
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
        <DialogHeader><DialogTitle>Reprocessar membros pendentes</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!running && resultados === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Esta ação irá, para cada membro ativo com conta não ativada:</p>
              <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Vincular <code className="text-xs bg-muted px-1 rounded">auth_user_id</code> pelo e-mail</li>
                <li>Criar registro em <code className="text-xs bg-muted px-1 rounded">profiles</code> se ausente</li>
                <li>Criar <code className="text-xs bg-muted px-1 rounded">role</code> de membro se ausente</li>
                <li>Marcar <code className="text-xs bg-muted px-1 rounded">conta_ativada = true</code> quando vinculado</li>
              </ol>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                Membros sem usuário auth <strong>não serão ativados automaticamente</strong> — precisam receber e clicar no link de convite.
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
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-3 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">{ativados.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Recuperados automaticamente</p>
                </div>
                <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20 p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{manuais.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Exigem ação manual</p>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {resultados.map((r, i) => {
                  const cfg = ACAO_CFG[r.acao] ?? { label: r.acao, cor: "text-muted-foreground bg-muted" };
                  return (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.nome}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{r.email ?? "sem e-mail"}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cor}`}>{cfg.label}</span>
                    </div>
                  );
                })}
                {resultados.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">Nenhum membro pendente — tudo em ordem!</p>
                )}
              </div>
              <Button className="w-full" onClick={() => { setResultados(null); onClose(); }}>Fechar</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Diálogo de progresso de envio em lote ──────────────────────────────────────

function BatchProgressDialog({
  open, onClose,
  members, paroquiaNome,
  action, onMemberCooldown,
}: {
  open: boolean;
  onClose: () => void;
  members: MembroInconsistente[];
  paroquiaNome: string;
  action: "email" | "senha";
  onMemberCooldown: (memberId: string, seconds: number) => void;
}) {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [currentNome, setCurrentNome] = useState("");
  const [results, setResults] = useState<BatchResult[] | null>(null);

  const total = members.length;

  async function handleRun() {
    setRunning(true);
    setCurrent(0);
    setCurrentNome(members[0]?.nome ?? "");
    const out: BatchResult[] = [];

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      setCurrent(i);
      setCurrentNome(m.nome);

      if (!m.email) {
        out.push({ membro_id: m.membro_id, nome: m.nome, email: null, status: "sem_email" });
        continue;
      }
      if (!m.token_acesso && action === "email") {
        out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "sem_token" });
        continue;
      }

      try {
        if (action === "email") {
          const result = await AccessInvitationService.sendEmail({
            email: m.email,
            nome: m.nome,
            paroquiaNome,
            tokenAcesso: m.token_acesso!,
            template: "reenvio_ativacao",
          });
          if (result.ok) {
            out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "ok" });
          } else if (result.cooldown) {
            const secs = result.cooldown;
            onMemberCooldown(m.membro_id, secs);
            out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "cooldown", cooldownSeconds: secs, mensagem: result.error });
            // Cooldown não é falha — continua a fila sem espera adicional
          } else {
            out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "erro", mensagem: result.error });
          }
        } else {
          const { error } = await supabase.auth.resetPasswordForEmail(m.email, {
            redirectTo: `${window.location.origin}/membro/primeiro-acesso`,
          });
          if (error && isCooldownError(error.message)) {
            const secs = parseCooldownSeconds(error.message) ?? 60;
            onMemberCooldown(m.membro_id, secs);
            out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "cooldown", cooldownSeconds: secs, mensagem: error.message });
          } else {
            out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: error ? "erro" : "ok", mensagem: error?.message });
          }
        }
      } catch (err) {
        out.push({ membro_id: m.membro_id, nome: m.nome, email: m.email, status: "erro", mensagem: String(err) });
      }

      // Respeita rate limit: 500ms entre envios
      if (i < members.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    setCurrent(total);
    setResults(out);
    setRunning(false);
  }

  function handleClose() {
    if (running) return;
    setRunning(false);
    setCurrent(0);
    setResults(null);
    onClose();
  }

  const ok        = results?.filter((r) => r.status === "ok").length ?? 0;
  const erros     = results?.filter((r) => r.status === "erro").length ?? 0;
  const cooldowns = results?.filter((r) => r.status === "cooldown").length ?? 0;
  const skip      = results?.filter((r) => r.status === "sem_email" || r.status === "sem_token").length ?? 0;

  const actionLabel = action === "email" ? "Reenviar link de acesso" : "Recuperação de senha";
  const actionIcon  = action === "email" ? <Mail className="h-4 w-4 mr-1" /> : <Key className="h-4 w-4 mr-1" />;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{actionLabel} — {total} membro{total !== 1 ? "s" : ""}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Confirmação */}
          {!running && results === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {action === "email"
                  ? `Serão enviados e-mails de convite para ${total} membro(s) selecionado(s). Os envios ocorrem em fila com intervalo de 500ms para evitar bloqueio por rate limit.`
                  : `Serão enviados e-mails de recuperação de senha para ${total} membro(s) selecionado(s).`
                }
              </p>
              <div className="rounded-lg border border-muted bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                {members.slice(0, 5).map((m) => (
                  <p key={m.membro_id} className="truncate">· {m.nome} <span className="text-muted-foreground/60">({m.email ?? "sem e-mail"})</span></p>
                ))}
                {members.length > 5 && <p className="text-muted-foreground/60">... e mais {members.length - 5}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleClose}>Cancelar</Button>
                <Button className="flex-1" onClick={handleRun}>
                  {actionIcon} Iniciar fila
                </Button>
              </div>
            </div>
          )}

          {/* Progresso */}
          {running && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span className="truncate">Enviando para <strong>{currentNome}</strong>…</span>
              </div>
              <div className="space-y-1.5">
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${(current / total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">{current} / {total} processados</p>
              </div>
              <p className="text-xs text-muted-foreground text-center">Não feche esta janela durante o envio.</p>
            </div>
          )}

          {/* Relatório final */}
          {!running && results !== null && (
            <div className="space-y-4">
              {/* Resumo — 4 colunas */}
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-2.5 text-center">
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">{ok}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Enviados</p>
                </div>
                <div className={`rounded-xl border p-2.5 text-center ${erros > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/10"}`}>
                  <p className={`text-xl font-bold ${erros > 0 ? "text-destructive" : "text-muted-foreground"}`}>{erros}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Falhas reais</p>
                </div>
                <div className={`rounded-xl border p-2.5 text-center ${cooldowns > 0 ? "border-sky-200 bg-sky-50" : "border-border bg-muted/10"}`}>
                  <p className={`text-xl font-bold ${cooldowns > 0 ? "text-sky-700" : "text-muted-foreground"}`}>{cooldowns}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Cooldown</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/10 p-2.5 text-center">
                  <p className="text-xl font-bold text-muted-foreground">{skip}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Ignorados</p>
                </div>
              </div>

              {/* Lista de resultados */}
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {results.map((r) => (
                  <div key={r.membro_id} className="flex items-center gap-2 px-3 py-2">
                    {r.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : r.status === "cooldown" ? (
                      <Clock className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    ) : r.status === "erro" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{r.nome}</p>
                      {r.status === "cooldown" && (
                        <p className="text-[11px] text-sky-600">
                          Aguardando cooldown — tente novamente em {r.cooldownSeconds ?? 60}s
                        </p>
                      )}
                      {r.status === "erro" && r.mensagem && (
                        <p className="text-[11px] text-destructive truncate">{r.mensagem}</p>
                      )}
                      {r.status === "sem_email" && (
                        <p className="text-[11px] text-muted-foreground">Sem e-mail cadastrado</p>
                      )}
                      {r.status === "sem_token" && (
                        <p className="text-[11px] text-muted-foreground">Sem token de acesso</p>
                      )}
                    </div>
                    {/* WhatsApp fallback para falhas e cooldown */}
                    {(r.status === "erro" || r.status === "sem_email" || r.status === "cooldown") && (() => {
                      const orig = members.find((m) => m.membro_id === r.membro_id);
                      if (!orig || !orig.token_acesso) return null;
                      return (
                        <button
                          onClick={() => AccessInvitationService.whatsApp(orig.token_acesso!, orig.nome)}
                          className="shrink-0 p-1 rounded hover:bg-green-50 text-green-600 hover:text-green-700 transition"
                          title="Enviar pelo WhatsApp como alternativa"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      );
                    })()}
                  </div>
                ))}
              </div>

              {(erros > 0 || cooldowns > 0) && (
                <p className="text-xs text-muted-foreground text-center">
                  Clique no <MessageCircle className="inline h-3 w-3 text-green-600" /> para enviar via WhatsApp.
                  {cooldowns > 0 && <> · <span className="text-sky-600">{cooldowns} em cooldown — aguarde antes de reenviar por e-mail.</span></>}
                </p>
              )}

              <Button className="w-full" onClick={handleClose}>Fechar</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Diálogo WhatsApp em lote ───────────────────────────────────────────────────

function WhatsAppLoteDialog({
  open, onClose,
  queue, paroquiaNome,
}: {
  open: boolean;
  onClose: () => void;
  queue: MembroInconsistente[];
  paroquiaNome: string;
}) {
  const [idx, setIdx] = useState(0);

  function handleNext() {
    const m = queue[idx];
    if (m?.token_acesso) {
      const link = AccessInvitationService.getLink(m.token_acesso);
      const msg = [
        `Olá, ${m.nome}!`,
        ``,
        `Seu acesso ao Portal Lumen — ${paroquiaNome} — foi liberado.`,
        ``,
        `Caso não tenha recebido o e-mail, utilize o link abaixo para criar sua senha:`,
        link,
        ``,
        `Qualquer dúvida, entre em contato com a coordenação.`,
      ].join("\n");
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    }
    if (idx + 1 < queue.length) {
      setIdx((i) => i + 1);
    } else {
      setIdx(0);
      onClose();
      toast.success("WhatsApp em lote concluído!");
    }
  }

  if (queue.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setIdx(0); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>WhatsApp em lote</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {idx + 1} de {queue.length}: <strong>{queue[idx]?.nome}</strong>
          </p>
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all duration-300" style={{ width: `${(idx / queue.length) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground text-right">{idx} / {queue.length} enviados</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 px-3 py-2.5 text-xs text-green-800 dark:text-green-300">
            Clique em "Abrir WhatsApp" para enviar a mensagem pré-formatada com o link. Após enviar, clique em "Próximo".
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setIdx(0); onClose(); }}>
              <X className="h-3.5 w-3.5 mr-1" /> Encerrar
            </Button>
            <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleNext}>
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              {idx + 1 < queue.length ? "Abrir WhatsApp + Próximo" : "Último — Concluir"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function AuditoriaAtivacao({ paroquia }: { paroquia: { nome: string; slug: string | null } | null | undefined }) {
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  // ── State ──────────────────────────────────────────────────────────────────
  const [filtroAtivacao,   setFiltroAtivacao]   = useState<FilterKey>("todos");
  const [expandedId,       setExpandedId]        = useState<string | null>(null);
  const [selectedIds,      setSelectedIds]        = useState<Set<string>>(new Set());
  const [reprocessarOpen,  setReprocessarOpen]   = useState(false);
  const [batchOpen,        setBatchOpen]          = useState(false);
  const [batchAction,      setBatchAction]        = useState<"email" | "senha">("email");
  const [whatsappOpen,     setWhatsappOpen]       = useState(false);
  const [whatsappQueue,    setWhatsappQueue]      = useState<MembroInconsistente[]>([]);
  const [enviandoId,       setEnviandoId]         = useState<string | null>(null);
  const [showEmailLog,     setShowEmailLog]       = useState(false);
  const [emailStatusFilter,setEmailStatusFilter]  = useState<"todos" | "erro" | "enviado" | "fallback">("todos");

  // Cooldown por membro: memberId → timestamp de expiração (ms)
  const cooldownMap = useRef<Map<string, number>>(new Map());
  const [, setCooldownTick] = useState(0);

  // Tick a cada 1s para atualizar os contadores regressivos
  useEffect(() => {
    const timer = setInterval(() => {
      let hasActive = false;
      cooldownMap.current.forEach((exp) => { if (exp > Date.now()) hasActive = true; });
      if (hasActive) setCooldownTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: stats, isLoading: loadingStats, refetch: refetchStats } = useQuery<AtivacaoStats>({
    queryKey: ["ativacao-stats"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_ativacao_stats");
      if (error) throw error;
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

  const { data: emailStats, isLoading: loadingEmailStats } = useQuery<EmailLogsStat>({
    queryKey: ["email-logs-stats"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_email_logs_stats");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as EmailLogsStat;
    },
    staleTime: 60_000,
  });

  // Carrega sempre — necessário para cross-reference de erros nos cards de membro
  const { data: allEmailLogs = [], isLoading: loadingLogs } = useQuery<EmailLogRecente[]>({
    queryKey: ["email-logs-recentes"],
    queryFn: async () => {
      const { data, error } = await anyDb.rpc("admin_get_email_logs_recentes", { p_limit: 150 });
      if (error) throw error;
      return (data ?? []) as EmailLogRecente[];
    },
    staleTime: 60_000,
  });

  // ── Dados derivados ────────────────────────────────────────────────────────

  // Emails com erro → Set para lookup rápido
  const emailsComErro = useMemo(() => {
    const s = new Set<string>();
    allEmailLogs.forEach((l) => { if (l.status === "erro") s.add(l.destinatario.toLowerCase()); });
    return s;
  }, [allEmailLogs]);

  // Mapa email → lista de erros (para histórico de tentativas)
  const errosPorEmail = useMemo(() => {
    const map: Record<string, EmailLogRecente[]> = {};
    allEmailLogs.filter((l) => l.status === "erro").forEach((l) => {
      const k = l.destinatario.toLowerCase();
      if (!map[k]) map[k] = [];
      map[k].push(l);
    });
    return map;
  }, [allEmailLogs]);

  // Membros com erro de e-mail (dentro de inconsistências)
  const membrosComErroEmail = useMemo(
    () => inconsistencias.filter((m) => m.email && emailsComErro.has(m.email.toLowerCase())),
    [inconsistencias, emailsComErro]
  );

  // Tipos de problema presentes (para chips de filtro)
  const tiposPresentes = useMemo(() => {
    const s = new Set(inconsistencias.map((i) => i.tipo_problema));
    return [...s];
  }, [inconsistencias]);

  // Lista filtrada de inconsistências
  const filtradas = useMemo(() => {
    if (filtroAtivacao === "com_erro_email") return membrosComErroEmail;
    if (filtroAtivacao === "todos") return inconsistencias;
    return inconsistencias.filter((i) => i.tipo_problema === filtroAtivacao);
  }, [inconsistencias, membrosComErroEmail, filtroAtivacao]);

  // Membros selecionados (dentre os filtrados)
  const selectedMembers = useMemo(
    () => filtradas.filter((m) => selectedIds.has(m.membro_id)),
    [filtradas, selectedIds]
  );

  const isAllSelected = filtradas.length > 0 && filtradas.every((m) => selectedIds.has(m.membro_id));
  const isSomeSelected = selectedIds.size > 0;

  // Logs filtrados por status (para seção de e-mail)
  const logsExibidos = useMemo(() => {
    let logs = allEmailLogs;
    if (emailStatusFilter !== "todos") logs = logs.filter((l) => l.status === emailStatusFilter);
    return logs.slice(0, 60);
  }, [allEmailLogs, emailStatusFilter]);

  const paroquiaNome = paroquia?.nome ?? "Pastoral";
  const totalInconsistencias = inconsistencias.length;

  // ── Helpers de cooldown ────────────────────────────────────────────────────

  function getCooldownRemaining(memberId: string): number {
    const exp = cooldownMap.current.get(memberId);
    if (!exp) return 0;
    return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
  }

  function setCooldownForMember(memberId: string, seconds: number) {
    cooldownMap.current.set(memberId, Date.now() + seconds * 1000);
    setCooldownTick((n) => n + 1);
  }

  // ── Helpers de navegação (KPI → lista) ────────────────────────────────────

  function navegarParaFiltro(filtro: FilterKey) {
    setFiltroAtivacao(filtro);
    setSelectedIds(new Set());
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function handleKpiClick(filtro: FilterKey | null, count: number | undefined, infoMsg?: string) {
    if (filtro === null) {
      toast.info(infoMsg ?? `${count ?? 0} membros encontrados.`);
      return;
    }
    if ((count ?? 0) === 0) { toast.info("Nenhum membro nesta categoria."); return; }
    navegarParaFiltro(filtro);
  }

  // ── Ações individuais ──────────────────────────────────────────────────────

  async function handleReenviarEmail(m: MembroInconsistente) {
    if (!m.email || !m.token_acesso) { toast.error("Membro sem e-mail ou token de acesso."); return; }

    const remaining = getCooldownRemaining(m.membro_id);
    if (remaining > 0) {
      toast.info(`Convite enviado recentemente. Aguarde ${remaining}s para reenviar.`);
      return;
    }

    setEnviandoId(m.membro_id);
    try {
      const result = await AccessInvitationService.sendEmail({
        email: m.email,
        nome: m.nome,
        paroquiaNome,
        tokenAcesso: m.token_acesso,
        template: "reenvio_ativacao",
      });
      if (result.ok) {
        toast.success(`Link enviado para ${m.email}`);
        refetchIncons();
        refetchStats();
      } else if (result.cooldown) {
        setCooldownForMember(m.membro_id, result.cooldown);
        toast.info(`Convite enviado recentemente. Aguarde ${result.cooldown}s para reenviar.`);
      } else {
        toast.error("Falha ao enviar: " + (result.error ?? ""));
      }
    } finally {
      setEnviandoId(null);
    }
  }

  function handleWhatsApp(m: MembroInconsistente) {
    if (!m.token_acesso) { toast.error("Sem token de acesso."); return; }
    const link = AccessInvitationService.getLink(m.token_acesso);
    const msg = [
      `Olá, ${m.nome}!`,
      ``,
      `Seu acesso ao Portal Lumen — ${paroquiaNome} — foi liberado.`,
      ``,
      `Caso não tenha recebido o e-mail, utilize o link abaixo para criar sua senha:`,
      link,
      ``,
      `Qualquer dúvida, entre em contato com a coordenação.`,
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function copiarLink(m: MembroInconsistente) {
    if (!m.token_acesso) { toast.error("Sem token de acesso."); return; }
    AccessInvitationService.copy(m.token_acesso);
    toast.success("Link copiado!");
  }

  // ── Seleção ────────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtradas.map((m) => m.membro_id)));
    }
  }

  // ── Ações em lote ──────────────────────────────────────────────────────────

  function abrirBatch(action: "email" | "senha") {
    if (selectedMembers.length === 0) { toast.info("Selecione ao menos um membro."); return; }
    setBatchAction(action);
    setBatchOpen(true);
  }

  function abrirWhatsAppLote() {
    const elegíveis = selectedMembers.length > 0
      ? selectedMembers.filter((m) => m.token_acesso)
      : inconsistencias.filter((m) => (m.tipo_problema === "nunca_convidado" || m.tipo_problema === "aguardando_ativacao") && m.token_acesso);
    if (elegíveis.length === 0) { toast.info("Nenhum membro elegível para WhatsApp em lote."); return; }
    setWhatsappQueue(elegíveis);
    setWhatsappOpen(true);
  }

  function copiarTodosLinks() {
    const links = selectedMembers
      .filter((m) => m.token_acesso)
      .map((m) => `${m.nome}: ${AccessInvitationService.getLink(m.token_acesso!)}`);
    if (links.length === 0) { toast.error("Nenhum membro selecionado tem token de acesso."); return; }
    navigator.clipboard.writeText(links.join("\n"));
    toast.success(`${links.length} link(s) copiado(s)!`);
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mt-4">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">Auditoria de ativação</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Clique em qualquer indicador para ver a lista correspondente.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { refetchStats(); refetchIncons(); qc.invalidateQueries({ queryKey: ["email-logs-stats"] }); qc.invalidateQueries({ queryKey: ["email-logs-recentes"] }); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setReprocessarOpen(true)} className="bg-amber-600 hover:bg-amber-700 text-white">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reprocessar pendentes
          </Button>
        </div>
      </div>

      {/* ── Dashboard de KPIs (todos clicáveis) ── */}
      {loadingStats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 h-20 animate-pulse bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard icon={Users}       label="Total membros ativos"     value={stats?.total_membros}          color="text-foreground"
            onClick={() => handleKpiClick(null, stats?.total_membros, `${stats?.total_membros ?? 0} membros ativos cadastrados.`)} />
          <StatCard icon={UserCheck}   label="Conta ativada"            value={stats?.conta_ativada}          color="text-green-600"
            onClick={() => handleKpiClick(null, stats?.conta_ativada, `${stats?.conta_ativada ?? 0} membros com conta ativada — nenhuma ação necessária.`)} />
          <StatCard icon={UserX}       label="Pendentes de ativação"    value={stats?.pendentes_ativacao}     color="text-amber-600" alert
            active={filtroAtivacao === "todos" && isSomeSelected}
            onClick={() => handleKpiClick("todos", stats?.pendentes_ativacao)} />
          <StatCard icon={Send}        label="Convite enviado"          value={stats?.convite_enviado}        color="text-blue-600"  sub="aguardando clique"
            active={filtroAtivacao === "aguardando_ativacao"}
            onClick={() => handleKpiClick("aguardando_ativacao", stats?.convite_enviado)} />
          <StatCard icon={Mail}        label="Nunca convidados"         value={stats?.nunca_convidados}       color="text-orange-600" alert sub="têm e-mail, sem convite"
            active={filtroAtivacao === "nunca_convidado"}
            onClick={() => handleKpiClick("nunca_convidado", stats?.nunca_convidados)} />
          <StatCard icon={Activity}    label="Logins realizados"        value={stats?.logins_realizados}      color="text-primary"
            onClick={() => handleKpiClick(null, stats?.logins_realizados, `${stats?.logins_realizados ?? 0} membros já fizeram login no portal.`)} />
          <StatCard icon={Clock}       label="Ativados sem retorno"     value={stats?.sem_login_pos_ativacao} color="text-slate-500"  sub="criaram senha mas não voltaram"
            onClick={() => handleKpiClick(null, stats?.sem_login_pos_ativacao, `${stats?.sem_login_pos_ativacao ?? 0} membros ativaram a conta mas ainda não voltaram ao portal.`)} />
          <StatCard icon={AlertCircle} label="Inconsistências"         value={totalInconsistencias}           color="text-destructive" alert sub="profile, role, auth ausentes"
            active={filtroAtivacao === "todos"}
            onClick={() => handleKpiClick("todos", totalInconsistencias)} />
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
            {showEmailLog ? "Ocultar histórico" : "Ver histórico"}
          </button>
        </div>

        {loadingEmailStats ? (
          <div className="h-12 animate-pulse rounded-lg bg-muted/30" />
        ) : emailStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { label: "Total enviados",  value: emailStats.total_enviados,  color: "text-foreground",   filter: "todos"    as const, action: () => { setShowEmailLog(true); setEmailStatusFilter("todos"); } },
              { label: "Entregues",       value: emailStats.entregues,        color: "text-green-600",    filter: "enviado"  as const, action: () => { setShowEmailLog(true); setEmailStatusFilter("enviado"); } },
              { label: "Com erro",        value: emailStats.com_erro,         color: "text-destructive",  filter: "erro"     as const, action: () => { handleKpiClick("com_erro_email", emailStats.com_erro); setShowEmailLog(true); setEmailStatusFilter("erro"); } },
              { label: "Via OTP (falb.)", value: emailStats.via_fallback,     color: "text-amber-600",    filter: "fallback" as const, action: () => { setShowEmailLog(true); setEmailStatusFilter("fallback"); } },
            ] as const).map((s) => (
              <button
                key={s.label}
                onClick={s.action}
                className="rounded-xl border border-border bg-muted/20 p-3 text-center hover:ring-2 hover:ring-primary/30 hover:shadow-sm transition cursor-pointer"
              >
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum dado de e-mail disponível.</p>
        )}

        {emailStats?.ultimo_envio && (
          <p className="text-[11px] text-muted-foreground">
            Último envio: {fmtData(emailStats.ultimo_envio)}
            {" · "}Ativações novas: {emailStats.ativacoes_novas}
            {" · "}Reenvios: {emailStats.reenvios}
            {" · "}Resets de senha: {emailStats.resets_senha}
          </p>
        )}

        {/* Histórico de logs com filtros */}
        {showEmailLog && (
          <div className="space-y-2 pt-2 border-t border-border/40">
            {/* Filtros de status */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Histórico</p>
              <div className="flex gap-1">
                {(["todos", "enviado", "erro", "fallback"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setEmailStatusFilter(s)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition ${emailStatusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
                  >
                    {s === "todos" ? "Todos" : s === "enviado" ? "Entregues" : s === "erro" ? "Erros" : "Fallback"}
                  </button>
                ))}
              </div>
            </div>

            {loadingLogs ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : logsExibidos.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nenhum registro encontrado.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border text-xs">
                {logsExibidos.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                    {l.status === "enviado" ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    ) : l.status === "erro" ? (
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                    ) : (
                      <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                    )}
                    <span className="flex-1 truncate text-muted-foreground">{l.destinatario}</span>
                    {l.status === "erro" && (
                      <ErrorCategoryBadge erro={l.erro} provider={l.provider} />
                    )}
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {l.tipo?.replace(/_/g, " ")}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">{fmtDataCurta(l.created_at)}</span>
                    {l.erro && l.status === "erro" && (
                      <span className="shrink-0 text-[10px] text-destructive truncate max-w-[100px]" title={l.erro}>{l.erro}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Lista de Inconsistências / Filtro ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden" ref={listRef}>
        {/* Cabeçalho da seção */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold">
              {filtroAtivacao === "com_erro_email" ? "Membros com erro de e-mail" : "Inconsistências"}
              {filtradas.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-white text-[10px] font-bold px-1">
                  {filtradas.length}
                </span>
              )}
            </h3>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs border-green-400/50 text-green-700 hover:bg-green-50 dark:text-green-400" onClick={abrirWhatsAppLote}>
            <MessageCircle className="h-3.5 w-3.5 mr-1 text-green-600" /> WhatsApp em lote
          </Button>
        </div>

        {/* Filtros por tipo */}
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-border/40 no-scrollbar">
          <button
            onClick={() => { setFiltroAtivacao("todos"); setSelectedIds(new Set()); }}
            className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition border ${filtroAtivacao === "todos" ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
          >
            Todos ({inconsistencias.length})
          </button>
          {tiposPresentes.map((tipo) => {
            const cfg = PROBLEMA_CFG[tipo];
            const count = inconsistencias.filter((i) => i.tipo_problema === tipo).length;
            return (
              <button
                key={tipo}
                onClick={() => { setFiltroAtivacao(tipo as FilterKey); setSelectedIds(new Set()); }}
                className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition border ${filtroAtivacao === tipo ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
              >
                {cfg?.label ?? tipo} ({count})
              </button>
            );
          })}
          {membrosComErroEmail.length > 0 && (
            <button
              onClick={() => { setFiltroAtivacao("com_erro_email"); setSelectedIds(new Set()); }}
              className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition border ${filtroAtivacao === "com_erro_email" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-rose-300/60 bg-rose-50/40 text-rose-600 hover:bg-rose-50"}`}
            >
              <TriangleAlert className="inline h-3 w-3 mr-1" />
              Com erro ({membrosComErroEmail.length})
            </button>
          )}
        </div>

        {/* Barra de seleção em lote */}
        {filtradas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/40 bg-muted/10">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={toggleSelectAll}
              className="h-4 w-4"
            />
            <span className="text-xs text-muted-foreground">
              {isAllSelected
                ? `Todos os ${filtradas.length} selecionados`
                : isSomeSelected
                ? `${selectedIds.size} selecionado(s)`
                : `Selecionar todos os ${filtradas.length}`}
            </span>

            {isSomeSelected && (
              <>
                <div className="h-4 border-l border-border mx-1" />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => abrirBatch("email")}>
                  <Mail className="h-3.5 w-3.5 mr-1" /> Reenviar acesso ({selectedIds.size})
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => abrirBatch("senha")}>
                  <Key className="h-3.5 w-3.5 mr-1" /> Recuperar senha ({selectedIds.size})
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs border-green-400/50 text-green-700 hover:bg-green-50" onClick={() => { setWhatsappQueue(selectedMembers.filter((m) => m.token_acesso)); setWhatsappOpen(true); }}>
                  <MessageCircle className="h-3.5 w-3.5 mr-1 text-green-600" /> WhatsApp ({selectedIds.size})
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copiarTodosLinks}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copiar links ({selectedIds.size})
                </Button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="h-3.5 w-3.5" /> Limpar seleção
                </button>
              </>
            )}
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
              {totalInconsistencias === 0
                ? "Nenhuma inconsistência encontrada!"
                : "Nenhum item para o filtro selecionado."}
            </p>
            {totalInconsistencias === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Todos os membros estão com perfil e acesso em ordem.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtradas.map((m) => {
              const key              = `${m.membro_id}-${m.tipo_problema}`;
              const expanded         = expandedId === key;
              const isEnviando       = enviandoId === m.membro_id;
              const selected         = selectedIds.has(m.membro_id);
              const podeEnviar       = !!m.email && !!m.token_acesso;
              const podeWhats        = !!m.token_acesso;
              const errosDoMembro    = m.email ? (errosPorEmail[m.email.toLowerCase()] ?? []) : [];
              const cooldownRemain   = getCooldownRemaining(m.membro_id);
              const emCooldown       = cooldownRemain > 0;

              return (
                <div
                  key={key}
                  className={`px-4 py-3 hover:bg-muted/20 transition ${selected ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected} onCheckedChange={() => toggleSelect(m.membro_id)} className="h-4 w-4" />
                    </div>

                    {/* Avatar */}
                    <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {m.nome.charAt(0).toUpperCase()}
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{m.nome}</span>
                        <TipoBadge tipo={m.tipo_problema} />
                        {errosDoMembro.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-rose-600 bg-rose-50 border-rose-200">
                            <TriangleAlert className="h-3 w-3" /> {errosDoMembro.length} erro{errosDoMembro.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {m.email ?? "sem e-mail"}
                        {m.ultimo_login ? ` · último login: ${fmtData(m.ultimo_login)}` : ""}
                      </p>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1 shrink-0">
                      {podeEnviar && (
                        <button
                          onClick={() => handleReenviarEmail(m)}
                          disabled={isEnviando || emCooldown}
                          className={`p-1.5 rounded-lg transition ${emCooldown ? "text-sky-500 bg-sky-50 cursor-not-allowed" : "hover:bg-muted text-muted-foreground hover:text-primary"}`}
                          title={emCooldown ? `Aguarde ${cooldownRemain}s para reenviar` : "Enviar link por e-mail"}
                        >
                          {isEnviando ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : emCooldown ? (
                            <span className="text-[10px] font-mono font-bold leading-none w-6 text-center block">{cooldownRemain}s</span>
                          ) : (
                            <Mail className="h-3.5 w-3.5" />
                          )}
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
                        title="Ver detalhes"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Detalhes expandidos */}
                  {expanded && (
                    <div className="mt-3 ml-14 rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2 text-xs text-muted-foreground">
                      <p><strong className="text-foreground">Problema:</strong> {m.detalhe}</p>
                      {m.ativacao_enviada_em && <p><strong className="text-foreground">Convite enviado em:</strong> {fmtData(m.ativacao_enviada_em)}</p>}
                      {m.auth_user_id && <p><strong className="text-foreground">auth_user_id:</strong> <code className="bg-muted px-1 rounded text-[10px]">{m.auth_user_id}</code></p>}
                      {m.token_acesso && <p><strong className="text-foreground">token_acesso:</strong> <code className="bg-muted px-1 rounded text-[10px]">{m.token_acesso}</code></p>}
                      {m.criado_em && <p><strong className="text-foreground">Membro cadastrado em:</strong> {fmtData(m.criado_em)}</p>}

                      {/* Histórico de tentativas de e-mail */}
                      {errosDoMembro.length > 0 && (
                        <div className="pt-1.5 border-t border-border/40">
                          <p className="font-semibold text-foreground mb-1.5">
                            <TriangleAlert className="inline h-3 w-3 text-rose-600 mr-1" />
                            Histórico de erros de e-mail ({errosDoMembro.length})
                          </p>
                          <div className="space-y-1">
                            {errosDoMembro.slice(0, 5).map((log) => (
                              <div key={log.id} className="flex items-start gap-2 rounded bg-rose-50/60 border border-rose-100 px-2 py-1">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <ErrorCategoryBadge erro={log.erro} provider={log.provider} />
                                    <span className="text-[10px] text-muted-foreground">{fmtData(log.created_at)}</span>
                                    <span className="text-[10px] bg-muted px-1 rounded">{log.tipo?.replace(/_/g, " ")}</span>
                                  </div>
                                  {log.erro && <p className="text-[10px] text-destructive mt-0.5 truncate">{log.erro}</p>}
                                </div>
                              </div>
                            ))}
                            {errosDoMembro.length > 5 && (
                              <p className="text-[10px] text-muted-foreground">... e mais {errosDoMembro.length - 5} erros</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Diálogos ── */}
      <ReprocessarDialog open={reprocessarOpen} onClose={() => setReprocessarOpen(false)} paroquiaNome={paroquiaNome} />

      <BatchProgressDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        members={selectedMembers}
        paroquiaNome={paroquiaNome}
        action={batchAction}
        onMemberCooldown={setCooldownForMember}
      />

      <WhatsAppLoteDialog
        open={whatsappOpen}
        onClose={() => setWhatsappOpen(false)}
        queue={whatsappQueue}
        paroquiaNome={paroquiaNome}
      />
    </div>
  );
}
