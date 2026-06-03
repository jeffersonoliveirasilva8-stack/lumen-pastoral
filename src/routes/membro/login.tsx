import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, LogIn, Mail, KeyRound, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/membro/login")({
  component: MembroLoginPage,
  head: () => ({ meta: [{ title: "Entrar — Portal do Servidor" }] }),
});

type Mode = "otp" | "senha";

function MembroLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("otp");
  // Verificação única de sessão — evita re-renders do hook completo na tela de login
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Listener para capturar tokens processados assincronamente (magic link implicit flow)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) navigate({ to: "/portal-membro/home" });
    });

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (session?.user) {
          navigate({ to: "/portal-membro/home" });
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Painel lateral */}
      <aside className="hidden lg:flex flex-col justify-between bg-gradient-sacro p-10 text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-accent text-gold">
            <Flame className="h-4 w-4" />
          </div>
          <span className="font-serif text-lg">Lumen Pastoral</span>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/50 mb-3">
            Portal do Servidor
          </p>
          <h2 className="font-serif text-4xl leading-tight">
            "Quem quiser ser o primeiro,<br />seja o servo de todos."
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">Marcos 10, 44</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Este portal é exclusivo para servidores e acólitos cadastrados.
        </p>
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Logo mobile */}
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-gold">
              <Flame className="h-4 w-4" />
            </div>
            <span className="font-serif text-lg">Lumen Pastoral</span>
          </div>

          <div className="mb-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
              <LogIn className="h-3 w-3" /> Portal do Servidor
            </div>
            <h1 className="font-serif text-3xl">Entrar no portal</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Use o e-mail cadastrado pelo coordenador da sua paróquia.
            </p>
          </div>

          {/* Toggle de modo */}
          <div className="flex rounded-xl border border-border bg-muted/40 p-1 mb-6">
            <button
              type="button"
              onClick={() => setMode("otp")}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                mode === "otp" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mail className="h-3.5 w-3.5" /> Link por e-mail
            </button>
            <button
              type="button"
              onClick={() => setMode("senha")}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                mode === "senha" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" /> Senha
            </button>
          </div>

          {mode === "otp" ? (
            <OtpForm />
          ) : (
            <SenhaForm />
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            É coordenador?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Acessar painel admin
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

// ── OTP / Magic Link Form ──────────────────────────────────────────────

function OtpForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend(e: { preventDefault(): void }) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin + "/portal-membro/home",
        },
      });
      if (error) {
        toast.error("Não foi possível enviar o link. Verifique o e-mail e tente novamente.");
        return;
      }
      setSent(true);
    } catch {
      toast.error("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-7 w-7 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Link enviado!</p>
          <p className="text-sm text-muted-foreground mt-1">
            Verifique <strong>{email}</strong> e clique no link para acessar o portal.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Não recebeu?{" "}
          <button
            className="text-primary hover:underline font-medium"
            onClick={() => setSent(false)}
          >
            Reenviar
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSend} className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          placeholder="seu@email.com"
          autoComplete="email"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Receber link de acesso
      </button>

      <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Como funciona</p>
        <p>• Enviamos um link para o seu e-mail cadastrado</p>
        <p>• Clique no link — você já estará logado</p>
        <p>• Nenhuma senha necessária</p>
      </div>
    </form>
  );
}

// ── Senha Form ─────────────────────────────────────────────────────────

function SenhaForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        toast.error(
          error.message === "Invalid login credentials"
            ? "E-mail ou senha incorretos."
            : error.message
        );
        return;
      }
      navigate({ to: "/portal-membro/home" });
    } catch {
      toast.error("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          placeholder="seu@email.com"
          autoComplete="email"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Senha
          </label>
          <Link to="/esqueci-senha" className="text-xs text-primary hover:underline">
            Esqueci a senha
          </Link>
        </div>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        Entrar
      </button>
    </form>
  );
}
