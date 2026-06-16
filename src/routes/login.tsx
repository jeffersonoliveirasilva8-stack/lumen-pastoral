import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPostLoginRoute } from "@/lib/auth-redirect";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Entrar — Lumen Pastoral" }] }),
});

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer quando bloqueado
  useEffect(() => {
    if (!lockedUntil) return;
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setAttempts(0);
        setCountdown(0);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  function recordFailedAttempt() {
    const next = attempts + 1;
    setAttempts(next);
    if (next >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_SECONDS * 1000;
      setLockedUntil(until);
      setCountdown(LOCKOUT_SECONDS);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lockedUntil && Date.now() < lockedUntil) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        recordFailedAttempt();
        const isInvalidCreds = error.message === "Invalid login credentials"
          || error.message.toLowerCase().includes("invalid login");
        toast.error(isInvalidCreds ? "E-mail ou senha incorretos." : "Erro ao autenticar. Tente novamente.");
        return;
      }

      // getPostLoginRoute tem timeout de 10s internamente — nunca trava indefinidamente
      const route = await getPostLoginRoute(supabase);
      toast.success("Bem-vindo de volta.");
      navigate({ to: route, replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <aside className="hidden lg:flex flex-col justify-between bg-gradient-sacro p-10 text-sidebar-foreground">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-accent text-gold">
            <Flame className="h-4 w-4" />
          </div>
          <span className="font-serif text-lg">Lumen Pastoral</span>
        </Link>
        <div>
          <h2 className="font-serif text-4xl leading-tight">
            "Servi ao Senhor com alegria."
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">Salmo 100</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Plataforma multi-paróquia · Dados isolados e seguros</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-gold"><Flame className="h-4 w-4" /></div>
            <span className="font-serif text-lg">Lumen Pastoral</span>
          </div>
          <h1 className="font-serif text-3xl">Entrar na coordenação</h1>
          <p className="mt-2 text-sm text-muted-foreground">Acesse sua paróquia.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                placeholder="voce@paroquia.org"
              />
            </div>
            <div>
              <div className="flex justify-between items-baseline">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</label>
                <Link to="/esqueci-senha" className="text-xs text-primary hover:underline">Esqueci</Link>
              </div>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading || (!!lockedUntil && Date.now() < lockedUntil)}
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {lockedUntil && Date.now() < lockedUntil
                ? `Aguarde ${countdown}s`
                : "Entrar"}
            </button>
            {attempts > 0 && !lockedUntil && (
              <p className="text-xs text-destructive text-center">
                {MAX_ATTEMPTS - attempts} tentativa{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} restante{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""}
              </p>
            )}
          </form>

          <div className="mt-6 pt-5 border-t border-border space-y-3">
            <Link
              to="/membro/login"
              className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-primary/25 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10 transition"
            >
              <Users className="h-4 w-4" />
              Sou servidor ou acólito — entrar aqui
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Ainda não tem conta? <Link to="/cadastro" className="font-medium text-primary hover:underline">Criar paróquia</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
