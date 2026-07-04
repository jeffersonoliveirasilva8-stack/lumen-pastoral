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
  if (s.length < 8)            return "Mínimo de 8 caracteres";
  if (!/[A-Z]/.test(s))        return "Deve conter pelo menos uma letra maiúscula";
  if (!/[a-z]/.test(s))        return "Deve conter pelo menos uma letra minúscula";
  if (!/[0-9]/.test(s))        return "Deve conter pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(s)) return "Deve conter pelo menos um caractere especial (ex: @, #, !)";
  return null;
}

function calcularForcaSenha(s: string): { nivel: 0 | 1 | 2 | 3 | 4; label: string; cor: string } {
  let pts = 0;
  if (s.length >= 8)            pts++;
  if (/[A-Z]/.test(s))          pts++;
  if (/[a-z]/.test(s))          pts++;
  if (/[0-9]/.test(s))          pts++;
  if (/[^A-Za-z0-9]/.test(s))   pts++;
  if (pts <= 1) return { nivel: 0, label: "Muito fraca",  cor: "bg-destructive" };
  if (pts === 2) return { nivel: 1, label: "Fraca",        cor: "bg-orange-500" };
  if (pts === 3) return { nivel: 2, label: "Regular",      cor: "bg-amber-400" };
  if (pts === 4) return { nivel: 3, label: "Boa",          cor: "bg-blue-500" };
  return             { nivel: 4, label: "Forte",           cor: "bg-green-500" };
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
    // token pode estar ausente quando magic link usou redirectTo sem ?token=UUID
    carregarEstado();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Escuta SIGNED_IN / PASSWORD_RECOVERY ────────────────────────────────
  // Avança o estado assim que a sessão fica disponível após o clique no link.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const isAuth = _event === "SIGNED_IN" || _event === "PASSWORD_RECOVERY";
        const isRecovery = _event === "PASSWORD_RECOVERY";
        if (isAuth && session?.user && estado === "carregando") {
          if (info) {
            if (isRecovery && info.conta_ativada) {
              // Membro ativo fazendo reset → vai direto para /reset-senha
              navigate({ to: "/reset-senha" as any, replace: true });
            } else if (!info.conta_ativada) {
              setEstado("formulario");
            }
          } else {
            carregarInfoPorSessao(session.user, isRecovery);
          }
        }
      },
    );
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, info]);

  // Carrega info do membro a partir de uma sessão já estabelecida (sem token no URL).
  // Usado quando: (a) magic link chegou sem ?token=UUID, ou
  //               (b) usuário autenticado acessou portal com conta_ativada=false.
  async function carregarInfoPorSessao(user: { id: string; email?: string | null }, isRecovery = false) {
    const email = user.email ?? "";
    console.info("[LOG primeiro-acesso] carregarInfoPorSessao →", {
      user_id: user.id, email, rota_atual: window.location.pathname,
    });

    if (!email) { setEstado("token_invalido"); return; }

    const { data: mem, error: memErr } = await anyDb
      .from("membros")
      .select("id, nome, email, conta_ativada, paroquia_id, paroquias!inner(nome)")
      .ilike("email", email.trim())
      .eq("ativo", true)
      .maybeSingle();

    console.info("[LOG primeiro-acesso] busca por email →", {
      encontrado: !!mem, membro_id: mem?.id, conta_ativada: mem?.conta_ativada,
      paroquia_id: mem?.paroquia_id, error: memErr?.message,
    });

    if (!mem) { setEstado("token_invalido"); return; }

    const masked = ((mem.email as string) ?? email).replace(/^(.)(.*)(@.*)$/, "$1***$3");
    const infoData: InfoMembro = {
      nome:          mem.nome          ?? "",
      email_masked:  masked,
      conta_ativada: mem.conta_ativada ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paroquia_nome: (mem.paroquias as any)?.nome ?? "",
    };
    setInfo(infoData);

    if (infoData.conta_ativada) {
      if (isRecovery) {
        // Membro ativo clicou no link de recuperação → redireciona para reset
        navigate({ to: "/reset-senha" as any, replace: true });
      } else {
        setEstado("ja_ativo");
        setTimeout(() => navigate({ to: "/portal-membro/home" as any, replace: true }), 2500);
      }
    } else {
      setEstado("formulario");
    }
  }

  async function carregarEstado() {
    const hasAuthHash = window.location.hash.includes("access_token=");

    console.info("[LOG primeiro-acesso] carregarEstado →", {
      token: token || "(vazio)", hasAuthHash,
      rota_atual: window.location.pathname + window.location.search,
    });

    if (token) {
      // ── Com token: valida via RPC (acessível por anon) ──────────────────
      const { data: memInfo, error: rpcErr } = await anyDb.rpc(
        "portal_get_membro_por_token",
        { p_token: token },
      );
      console.info("[LOG primeiro-acesso] portal_get_membro_por_token →", {
        token, valid: memInfo?.valid, membro_id: memInfo?.membro_id,
        conta_ativada: memInfo?.conta_ativada, error: rpcErr?.message ?? memInfo?.error,
      });

      if (rpcErr || !memInfo?.valid) { setEstado("token_invalido"); return; }

      const infoData: InfoMembro = {
        nome:          memInfo.nome          ?? "",
        email_masked:  memInfo.email_masked  ?? "",
        conta_ativada: memInfo.conta_ativada ?? false,
        paroquia_nome: memInfo.paroquia_nome ?? "",
      };
      setInfo(infoData);

      if (infoData.conta_ativada) {
        setEstado("ja_ativo");
        setTimeout(() => navigate({ to: "/portal-membro/home" as any, replace: true }), 2500);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      console.info("[LOG primeiro-acesso] getSession (com token) →", {
        user_id: session?.user?.id, email: session?.user?.email, hasAuthHash,
      });
      if (session?.user) { setEstado("formulario"); return; }
      if (hasAuthHash) return; // aguarda SIGNED_IN
      setEstado("sem_auth");
      return;
    }

    // ── Sem token no URL ─────────────────────────────────────────────────
    if (hasAuthHash) {
      console.info("[LOG primeiro-acesso] sem token, auth hash detectado — aguardando SIGNED_IN");
      return; // mantém estado = "carregando"
    }

    const { data: { session } } = await supabase.auth.getSession();
    console.info("[LOG primeiro-acesso] getSession (sem token, sem hash) →", {
      user_id: session?.user?.id, email: session?.user?.email,
    });

    if (session?.user) {
      await carregarInfoPorSessao(session.user);
      return;
    }

    setEstado("token_invalido");
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
    const errSenha = validarSenha(senha);
    if (errSenha) { toast.error(errSenha); return; }
    if (senha !== confirmar) { toast.error("As senhas não conferem."); return; }

    setSalvando(true);
    try {

      // ── 1. Estado antes de qualquer operação ─────────────────────────────
      const { data: { session } }     = await supabase.auth.getSession();
      const { data: { user: authUser } } = await supabase.auth.getUser();

      const user_id       = session?.user?.id       ?? authUser?.id       ?? null;
      const email         = session?.user?.email    ?? authUser?.email    ?? null;
      const session_exists = !!session;

      console.log("[SAVE PASSWORD] BEFORE", {
        session_exists,
        user_id,
        email,
        token:           token || "(vazio)",
        href:            window.location.href,
        hash:            window.location.hash || "(vazio)",
      });

      // Logs específicos de diagnóstico de sessão
      console.log("SESSION", session);
      console.log("USER", session?.user ?? authUser);
      console.log("PROVIDERS", session?.user?.app_metadata ?? authUser?.app_metadata);

      if (!session_exists || !user_id) {
        toast.error(
          "Sua sessão expirou. Clique em \"Enviar link de acesso\" para receber um novo e-mail.",
          { duration: 6000 },
        );
        setEstado("sem_auth");
        return;
      }

      // ── 2. Salvar senha ──────────────────────────────────────────────────
      const { data: updateData, error: updateError } =
        await supabase.auth.updateUser({ password: senha });

      console.log("[SAVE PASSWORD] UPDATE USER", {
        data:  updateData ? { user_id: updateData.user?.id, email: updateData.user?.email } : null,
        error: updateError ? { message: updateError.message, status: (updateError as any).status } : null,
      });

      if (updateError) {
        const errMsg = updateError.message ?? "";
        if (errMsg.toLowerCase().includes("same password")) {
          toast.error("A nova senha não pode ser igual à senha atual. Escolha uma senha diferente.");
        } else if (errMsg.toLowerCase().includes("weak")) {
          toast.error("Senha muito fraca. Use letras maiúsculas, minúsculas, números e caracteres especiais.");
        } else {
          toast.error("Não foi possível salvar a senha. Tente novamente ou solicite um novo link de acesso.");
        }
        return;
      }

      // ── 3. Fluxo pós-senha: ativação vs recuperação ──────────────────────
      if (info?.conta_ativada === false) {
        // CENÁRIO 1: Primeiro acesso — vincular e ativar conta
        const { data: linkData, error: linkError } =
          await anyDb.rpc("portal_auto_link_by_email");

        console.log("[SAVE PASSWORD] LINK MEMBER", {
          data:  linkData,
          error: linkError ? { message: linkError.message, code: linkError.code } : null,
        });

        const { data: activResult, error: activError } =
          await anyDb.rpc("ativar_conta_membro");

        console.log("[SAVE PASSWORD] ACTIVATE MEMBER", {
          data:  activResult,
          error: activError ? { message: activError.message, code: activError.code } : null,
        });

        if (activError) {
          toast.error("Erro ao ativar a conta. Verifique sua conexão e tente novamente.");
          console.error("[ACTIVATE] activError", activError);
          return;
        }
        if (activResult?.success === false) {
          toast.error("Não foi possível ativar a conta. Entre em contato com seu coordenador.");
          console.error("[ACTIVATE] activResult failure", activResult);
          return;
        }

        setEstado("redirecionando");
        toast.success("Conta ativada! Bem-vindo ao portal.");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: "/portal-membro/completar-cadastro" as any, replace: true });

      } else {
        // CENÁRIO 2: Recuperação de acesso — senha redefinida, encerrar sessão de recovery
        await supabase.auth.signOut();
        setEstado("redirecionando");
        toast.success("Senha atualizada! Faça login com a nova senha.");
        navigate({ to: "/membro/login" as any, replace: true });
      }

    } catch (err) {
      console.error("[SAVE PASSWORD] EXCEPTION", err);
      toast.error("Ocorreu um erro inesperado. Tente novamente ou solicite um novo link de acesso.");
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
                Este link expirou ou já foi utilizado. Se você ainda não criou
                sua senha, solicite um novo link abaixo.
              </p>
            </div>
            {token && (
              <button
                onClick={handleReenviarEmail}
                disabled={enviando}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Reenviar link de acesso
              </button>
            )}
            <button
              onClick={() => navigate({ to: "/membro/login" })}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition"
            >
              <RefreshCw className="h-4 w-4" />
              Já tenho senha — entrar
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
        {estado === "formulario" && info && (() => {
          const ehRecovery = info.conta_ativada === true;
          return (
          <div className="space-y-6">
            <div className="text-center">
              {!ehRecovery && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 mb-4">
                  <CheckCircle2 className="h-3 w-3" />
                  Aprovado por {info.paroquia_nome}
                </div>
              )}
              <h1 className="font-serif text-2xl">
                {ehRecovery
                  ? `Olá, ${info.nome.split(" ")[0]}!`
                  : `Bem-vindo, ${info.nome.split(" ")[0]}!`}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {ehRecovery
                  ? "Defina uma nova senha para recuperar seu acesso."
                  : "Crie sua senha para acessar o portal da sua paróquia."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground mb-1.5">A senha deve ter:</p>
                {[
                  { ok: senha.length >= 8,            label: "Mínimo de 8 caracteres" },
                  { ok: /[A-Z]/.test(senha),           label: "Letra maiúscula (A-Z)" },
                  { ok: /[a-z]/.test(senha),           label: "Letra minúscula (a-z)" },
                  { ok: /[0-9]/.test(senha),           label: "Pelo menos um número" },
                  { ok: /[^A-Za-z0-9]/.test(senha),   label: "Caractere especial (@, #, !, …)" },
                ].map(({ ok, label }) => (
                  <div key={label} className="flex items-center gap-2">
                    <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 transition-colors ${ok ? "text-green-500" : "text-muted-foreground/30"}`} />
                    <span className={ok ? "text-foreground" : ""}>{label}</span>
                  </div>
                ))}
                {/* Medidor de força */}
                {senha.length > 0 && (() => {
                  const forca = calcularForcaSenha(senha);
                  return (
                    <div className="pt-1 space-y-1">
                      <div className="flex gap-1 h-1.5">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-all ${i < forca.nivel ? forca.cor : "bg-muted"}`}
                          />
                        ))}
                      </div>
                      <p className={`text-[11px] font-medium ${forca.nivel >= 3 ? "text-green-600" : forca.nivel === 2 ? "text-amber-600" : "text-destructive"}`}>
                        {forca.label}
                      </p>
                    </div>
                  );
                })()}
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
                {ehRecovery ? "Salvar nova senha" : "Criar senha e entrar"}
              </button>
            </form>
          </div>
          );
        })()}

      </div>
    </div>
  );
}
