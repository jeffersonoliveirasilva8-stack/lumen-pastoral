import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Flame, Loader2, KeyRound, Eye, EyeOff, ArrowRight,
  CheckCircle2, AlertCircle, RefreshCw, Mail,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AccessInvitationService } from "@/lib/invitation-service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/membro/primeiro-acesso")({
  component: PrimeiroAcessoPage,
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  head: () => ({ meta: [{ title: "Primeiro Acesso — Lumen Pastoral" }] }),
});

type Estado =
  | "carregando"     // validando token / aguardando sessão
  | "token_invalido" // token não encontrado ou membro inativo
  | "link_expirado"  // URL tem ?error=access_denied | otp_expired
  | "ja_ativo"       // conta já ativada → redireciona
  | "sem_auth"       // token válido, sem sessão → oferecer reenvio
  | "email_enviado"  // e-mail despachado, aguardando clique
  | "formulario"     // autenticado + conta pendente → criar senha
  | "redirecionando";

type InfoMembro = {
  nome: string;
  email_masked: string;
  conta_ativada: boolean;
  paroquia_nome: string;
};

function validarSenha(s: string): string | null {
  if (s.length < 8)        return "Mínimo de 8 caracteres";
  if (!/[a-zA-Z]/.test(s)) return "Deve conter pelo menos uma letra";
  if (!/[0-9]/.test(s))    return "Deve conter pelo menos um número";
  return null;
}

function PrimeiroAcessoPage() {
  const navigate  = useNavigate();
  const { token } = Route.useSearch();

  const [estado, setEstado]       = useState<Estado>("carregando");
  const [info, setInfo]           = useState<InfoMembro | null>(null);
  const [senha, setSenha]         = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvando, setSalvando]   = useState(false);
  const [enviando, setEnviando]   = useState(false);

  const initialised = useRef(false);

  // ── Inicialização ────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const params  = new URLSearchParams(window.location.search);
    const urlErr  = params.get("error");
    if (urlErr === "access_denied" || urlErr === "otp_expired") {
      setEstado("link_expirado");
      return;
    }
    if (!token) { setEstado("token_invalido"); return; }

    carregarEstado();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Escuta SIGNED_IN: magic link processado enquanto loading ─────────────
  // Quando o usuário clica no link de e-mail, o hash #access_token=... é
  // processado assincronamente. Este listener avança o estado assim que
  // a sessão fica disponível.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (_event === "SIGNED_IN" && session?.user && estado === "carregando") {
          // Hash processado: se token já foi validado como não-ativo → formulário
          if (info && !info.conta_ativada) {
            setEstado("formulario");
          } else if (!info) {
            // Token ainda não validado (corrida de inicialização) — recarrega tudo
            carregarEstado();
          }
        }
      },
    );
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, info]);

  async function carregarEstado() {
    if (!token) { setEstado("token_invalido"); return; }

    // 1. Valida token (RPC acessível por anon)
    const { data: memInfo, error: rpcErr } = await anyDb.rpc(
      "portal_get_membro_por_token",
      { p_token: token },
    );
    if (rpcErr || !memInfo?.valid) {
      console.warn("[primeiro-acesso] token inválido", rpcErr?.message ?? memInfo?.error,
        "| token:", token);
      setEstado("token_invalido");
      return;
    }

    const infoData: InfoMembro = {
      nome:          memInfo.nome          ?? "",
      email_masked:  memInfo.email_masked  ?? "",
      conta_ativada: memInfo.conta_ativada ?? false,
      paroquia_nome: memInfo.paroquia_nome ?? "",
    };
    setInfo(infoData);

    // 2. Conta já ativada → redireciona ao login
    if (infoData.conta_ativada) {
      setEstado("ja_ativo");
      setTimeout(() => navigate({ to: "/membro/login" }), 2500);
      return;
    }

    // 3. Sessão já existe
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) { setEstado("formulario"); return; }

    // 4. Hash de magic link presente → mantém "carregando", SIGNED_IN virá
    if (window.location.hash.includes("access_token=")) return;

    // 5. Sem sessão, sem hash → oferecer reenvio de e-mail
    setEstado("sem_auth");
  }

  async function handleReenviarEmail() {
    if (!token) return;
    setEnviando(true);
    try {
      const { ok, error } = await AccessInvitationService.sendByToken(token);
      if (!ok) throw new Error(error ?? "Erro ao enviar");
      setEstado("email_enviado");
      toast.success("E-mail enviado! Verifique sua caixa de entrada.");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      const isRate = msg.toLowerCase().includes("rate") || msg.toLowerCase().includes("many");
      toast.error(
        isRate
          ? "Aguarde alguns minutos antes de reenviar."
          : "Erro ao enviar e-mail. Tente novamente.",
      );
    } finally {
      setEnviando(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validarSenha(senha);
    if (err) { toast.error(err); return; }
    if (senha !== confirmar) { toast.error("As senhas não conferem."); return; }

    setSalvando(true);
    try {
      const { error: authErr } = await supabase.auth.updateUser({ password: senha });
      if (authErr) {
        toast.error("Erro ao salvar senha: " + authErr.message);
        return;
      }

      // Ativa conta + garante profiles/user_roles (SECURITY DEFINER, ignora RLS)
      const { data: activResult } = await anyDb.rpc("ativar_conta_membro");
      console.info("[primeiro-acesso] ativar_conta_membro →", activResult);

      setEstado("redirecionando");
      toast.success("Conta ativada! Bem-vindo ao portal.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal-membro/completar-cadastro" as any, replace: true });
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (estado === "carregando" || estado === "redirecionando") {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Verificando seu acesso…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-gold">
            <Flame className="h-4 w-4" />
          </div>
          <span className="font-serif text-lg">Lumen Pastoral</span>
        </div>

        {/* ── Link expirado ── */}
        {estado === "link_expirado" && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6 space-y-4 text-center">
            <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Link expirado</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Este link expirou ou já foi utilizado. Peça ao seu coordenador
                para reenviar o convite.
              </p>
            </div>
            <button
              onClick={() => navigate({ to: "/membro/login" })}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition"
            >
              <RefreshCw className="h-4 w-4" />
              Ir para o login
            </button>
          </div>
        )}

        {/* ── Token inválido ── */}
        {estado === "token_invalido" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Link inválido</h2>
              <p className="text-sm text-muted-foreground">
                Este link de convite não é válido ou já expirou.
                Entre em contato com seu coordenador.
              </p>
            </div>
            <button
              onClick={() => navigate({ to: "/membro/login" })}
              className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition"
            >
              Ir para o login
            </button>
          </div>
        )}

        {/* ── Conta já ativa ── */}
        {estado === "ja_ativo" && (
          <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Conta já ativa</h2>
              <p className="text-sm text-muted-foreground">
                {info?.nome ? `${info.nome.split(" ")[0]}, sua` : "Sua"} conta
                já foi ativada anteriormente. Redirecionando para o login…
              </p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto" />
          </div>
        )}

        {/* ── Sem autenticação: reenviar e-mail ── */}
        {estado === "sem_auth" && info && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 mb-4">
                <CheckCircle2 className="h-3 w-3" />
                Aprovado por {info.paroquia_nome}
              </div>
              <h1 className="font-serif text-2xl">
                Olá, {info.nome.split(" ")[0]}!
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Para criar sua senha, enviaremos um link seguro para o seu e-mail.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-mono text-muted-foreground tracking-wide">
                {info.email_masked}
              </span>
            </div>

            <button
              onClick={handleReenviarEmail}
              disabled={enviando}
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Enviar link de acesso
            </button>

            <p className="text-center text-xs text-muted-foreground">
              Já tem senha?{" "}
              <button
                onClick={() => navigate({ to: "/membro/login" })}
                className="underline underline-offset-2 hover:text-foreground transition"
              >
                Entrar aqui
              </button>
            </p>
          </div>
        )}

        {/* ── E-mail enviado ── */}
        {estado === "email_enviado" && info && (
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Verifique seu e-mail</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Enviamos um link de acesso para{" "}
                <strong className="text-foreground font-mono">{info.email_masked}</strong>.
                Clique no link para criar sua senha.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Não recebeu?{" "}
              <button
                onClick={handleReenviarEmail}
                disabled={enviando}
                className="underline underline-offset-2 hover:text-foreground transition disabled:opacity-50"
              >
                {enviando ? "Reenviando…" : "Reenviar"}
              </button>
            </p>
          </div>
        )}

        {/* ── Formulário de senha ── */}
        {estado === "formulario" && info && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 mb-4">
                <CheckCircle2 className="h-3 w-3" />
                Aprovado por {info.paroquia_nome}
              </div>
              <h1 className="font-serif text-2xl">
                Bem-vindo, {info.nome.split(" ")[0]}!
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Crie sua senha para acessar o portal da sua paróquia.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground mb-1.5">A senha deve ter:</p>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${senha.length >= 8 ? "text-green-500" : "text-muted-foreground/40"}`} />
                  <span className={senha.length >= 8 ? "text-foreground" : ""}>Mínimo de 8 caracteres</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${/[a-zA-Z]/.test(senha) ? "text-green-500" : "text-muted-foreground/40"}`} />
                  <span className={/[a-zA-Z]/.test(senha) ? "text-foreground" : ""}>Pelo menos uma letra</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${/[0-9]/.test(senha) ? "text-green-500" : "text-muted-foreground/40"}`} />
                  <span className={/[0-9]/.test(senha) ? "text-foreground" : ""}>Pelo menos um número</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Nova senha
                </label>
                <div className="relative mt-1.5">
                  <input
                    type={mostrarSenha ? "text" : "password"}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required minLength={8}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    autoFocus
                    className="w-full rounded-lg border border-input bg-card px-4 py-2.5 pr-10 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                    tabIndex={-1}
                  >
                    {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Confirmar senha
                </label>
                <div className="relative mt-1.5">
                  <input
                    type={mostrarSenha ? "text" : "password"}
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    required
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={`w-full rounded-lg border px-4 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring/20 bg-card transition ${
                      confirmar && confirmar !== senha
                        ? "border-destructive focus:border-destructive"
                        : "border-input focus:border-ring"
                    }`}
                  />
                  {confirmar && confirmar === senha && senha.length >= 8 && (
                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                  )}
                </div>
                {confirmar && confirmar !== senha && (
                  <p className="mt-1 text-xs text-destructive">As senhas não conferem.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={salvando || !!validarSenha(senha) || senha !== confirmar}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {salvando
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><KeyRound className="h-4 w-4" /><ArrowRight className="h-4 w-4" /></>
                }
                Criar senha e entrar
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
