import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Flame, Loader2, KeyRound, Eye, EyeOff, ArrowRight,
  CheckCircle2, AlertCircle, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMembroAuth } from "@/hooks/use-membro-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/membro/ativar-conta")({
  component: AtivarContaPage,
  head: () => ({ meta: [{ title: "Primeiro Acesso — Portal do Servidor" }] }),
});

function validarSenha(senha: string): string | null {
  if (senha.length < 8) return "Mínimo de 8 caracteres";
  if (!/[a-zA-Z]/.test(senha)) return "Deve conter pelo menos uma letra";
  if (!/[0-9]/.test(senha)) return "Deve conter pelo menos um número";
  return null;
}

function AtivarContaPage() {
  const navigate = useNavigate();
  const { user, membro, loading, linking } = useMembroAuth();

  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [precisaSenhaAtual, setPrecisaSenhaAtual] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Detecta erros enviados pelo Supabase na URL (link expirado, já usado, etc.)
  const urlParams = new URLSearchParams(window.location.search);
  const urlError = urlParams.get("error");
  const linkInvalido = urlError === "access_denied" || urlError === "otp_expired";

  // Se não autenticado e link não é inválido → login
  useEffect(() => {
    if (!loading && !linkInvalido && !user) {
      navigate({ to: "/membro/login" });
    }
  }, [loading, linkInvalido, user, navigate]);

  // Se conta já ativada → portal (re-convite de membro já ativo)
  useEffect(() => {
    if (!loading && !linking && membro?.conta_ativada) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dest = membro.perfil_completo ? "/portal-membro/home" : "/portal-membro/completar-cadastro";
      navigate({ to: dest as any, replace: true });
    }
  }, [loading, linking, membro, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const erroSenha = validarSenha(senha);
    if (erroSenha) { toast.error(erroSenha); return; }
    if (senha !== confirmar) { toast.error("As senhas não conferem."); return; }
    if (precisaSenhaAtual && !senhaAtual) { toast.error("Informe a senha atual para continuar."); return; }

    setSalvando(true);
    try {
      if (precisaSenhaAtual) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: user!.email!,
          password: senhaAtual,
        });
        if (signInErr) {
          toast.error("Senha atual incorreta. Tente novamente.");
          return;
        }
      }

      const { error: authErr } = await supabase.auth.updateUser({ password: senha });
      if (authErr) {
        const msg = authErr.message?.toLowerCase() ?? "";
        if (msg.includes("current password") || msg.includes("reauthentication")) {
          setPrecisaSenhaAtual(true);
          toast.error("Você já possui uma senha. Informe-a abaixo para continuar.");
          return;
        }
        toast.error("Erro ao salvar senha: " + authErr.message);
        return;
      }

      // Marca conta como ativada (SECURITY DEFINER — ignora RLS)
      await anyDb.rpc("ativar_conta_membro").catch(() => {});

      toast.success("Conta ativada! Bem-vindo ao portal.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal-membro/completar-cadastro" as any, replace: true });
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  // ── Link expirado ou inválido ──────────────────────────────────────────────
  if (linkInvalido) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="flex items-center gap-2 justify-center mb-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-gold">
              <Flame className="h-4 w-4" />
            </div>
            <span className="font-serif text-lg">Lumen Pastoral</span>
          </div>

          <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6 space-y-4">
            <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Link expirado</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Este link de ativação expirou ou já foi utilizado.
                Peça ao seu coordenador para reenviar o convite.
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
        </div>
      </div>
    );
  }

  // ── Carregando ─────────────────────────────────────────────────────────────
  if (loading || linking) {
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

        {/* ── Cadastro não encontrado ── */}
        {user && membro === null && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Cadastro não encontrado</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nenhum cadastro foi encontrado para{" "}
                <strong className="text-foreground">{user.email}</strong>.
              </p>
              <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3 text-left text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">O que verificar:</p>
                <p>• Este link pode ter expirado — peça ao coordenador reenviar o convite.</p>
                <p>• Confirme que seu coordenador cadastrou exatamente <strong>{user.email}</strong>.</p>
              </div>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/membro/login" });
              }}
              className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition"
            >
              Voltar ao login
            </button>
          </div>
        )}

        {/* ── Formulário de criação de senha ── */}
        {membro && !membro.conta_ativada && (
          <div className="space-y-6">
            <div className="text-center">
              {/* Badge de aprovação */}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 mb-4">
                <CheckCircle2 className="h-3 w-3" />
                Aprovado por {membro.paroquia_nome}
              </div>
              <h1 className="font-serif text-2xl">Bem-vindo, {membro.nome.split(" ")[0]}!</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sua solicitação foi aprovada. Para acessar o portal, crie sua senha abaixo.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Campo de senha atual — aparece quando Supabase exige reautenticação */}
              {precisaSenhaAtual && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 space-y-3">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Você já possui uma senha cadastrada. Informe-a para continuar.
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Senha atual
                    </label>
                    <input
                      type="password"
                      value={senhaAtual}
                      onChange={(e) => setSenhaAtual(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete="current-password"
                      autoFocus
                      className="mt-1.5 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                </div>
              )}

              {/* Regras de senha */}
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
                    required
                    minLength={8}
                    placeholder="••••••••"
                    autoComplete="new-password"
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
                disabled={salvando || !!validarSenha(senha) || senha !== confirmar || (precisaSenhaAtual && !senhaAtual)}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {precisaSenhaAtual ? "Atualizar senha e entrar" : "Criar senha e entrar"}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
