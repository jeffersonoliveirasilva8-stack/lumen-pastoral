import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, KeyRound, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-senha")({
  component: ResetPage,
  head: () => ({ meta: [{ title: "Definir nova senha — Lumen Pastoral" }] }),
});

type Status = "loading" | "ready" | "expired";

function validarSenha(senha: string): string | null {
  if (senha.length < 8) return "Mínimo de 8 caracteres";
  if (!/[a-zA-Z]/.test(senha)) return "Deve conter pelo menos uma letra";
  if (!/[0-9]/.test(senha)) return "Deve conter pelo menos um número";
  return null;
}

function ResetPage() {
  const navigate = useNavigate();

  // Query param tem prioridade; sessionStorage é fallback quando o Supabase
  // ignora o redirectTo e descarta os params da URL
  const fromParam = new URLSearchParams(window.location.search).get("from") ?? "";
  const from = fromParam || sessionStorage.getItem("resetFrom") || "";
  const isMemberContext = from === "membro";
  const loginRoute = isMemberContext ? "/membro/login" : "/login";

  const [status, setStatus] = useState<Status>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [saving, setSaving] = useState(false);
  const unsubRef = useRef<(() => void) | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setStatus("ready");
        return;
      }

      // Sessão ainda não estabelecida — aguarda Supabase processar o hash do link
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          clearTimeout(timerRef.current);
          subscription.unsubscribe();
          unsubRef.current = undefined;
          setStatus("ready");
        }
      });
      unsubRef.current = () => subscription.unsubscribe();

      // 10 segundos: se não chegou sessão, o link é inválido ou expirou
      timerRef.current = setTimeout(() => {
        subscription.unsubscribe();
        unsubRef.current = undefined;
        setStatus("expired");
      }, 10_000);
    }

    checkSession();

    return () => {
      unsubRef.current?.();
      clearTimeout(timerRef.current);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const erroSenha = validarSenha(password);
    if (erroSenha) { toast.error(erroSenha); return; }
    if (password !== confirm) { toast.error("As senhas não coincidem."); return; }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar senha: " + error.message);
      return;
    }

    // Encerra sessão de recovery e limpa contexto salvo
    sessionStorage.removeItem("resetFrom");
    await supabase.auth.signOut();

    toast.success("Senha atualizada! Faça login com a nova senha.");
    navigate({ to: loginRoute, replace: true });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Verificando link de recuperação…</p>
        </div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="font-serif text-2xl">Link expirado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Este link de recuperação não é mais válido. Solicite um novo.
            </p>
          </div>
          <button
            onClick={() => navigate({ to: (isMemberContext ? "/esqueci-senha?from=membro" : "/esqueci-senha") as never })}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            Solicitar novo link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h1 className="font-serif text-3xl">
            {isMemberContext ? "Criar nova senha" : "Nova senha"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Defina sua nova senha de acesso. Você será redirecionado ao login após salvar.
          </p>
        </div>

        <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground mb-1.5">A senha deve ter:</p>
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${password.length >= 8 ? "text-green-500" : "text-muted-foreground/40"}`} />
            <span className={password.length >= 8 ? "text-foreground" : ""}>Mínimo de 8 caracteres</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${/[a-zA-Z]/.test(password) ? "text-green-500" : "text-muted-foreground/40"}`} />
            <span className={/[a-zA-Z]/.test(password) ? "text-foreground" : ""}>Pelo menos uma letra</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${/[0-9]/.test(password) ? "text-green-500" : "text-muted-foreground/40"}`} />
            <span className={/[0-9]/.test(password) ? "text-foreground" : ""}>Pelo menos um número</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Nova senha
            </label>
            <div className="relative mt-1.5">
              <input
                type={mostrarSenha ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-card px-4 py-2.5 pr-10 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
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
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`w-full rounded-lg border px-4 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring/20 bg-card transition ${
                  confirm && confirm !== password
                    ? "border-destructive focus:border-destructive"
                    : "border-input focus:border-ring"
                }`}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              {confirm && confirm === password && password.length >= 8 && (
                <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
              )}
            </div>
            {confirm && confirm !== password && (
              <p className="mt-1 text-xs text-destructive">As senhas não conferem.</p>
            )}
          </div>
          <button
            type="submit"
            disabled={saving || !!validarSenha(password) || password !== confirm}
            className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Salvar nova senha
          </button>
        </form>
      </div>
    </div>
  );
}
