import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Entrar — Liturgia" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      toast.error(error.message === "Invalid login credentials" ? "Credenciais inválidas." : error.message);
      return;
    }

    const userId = authData.user?.id;
    if (!userId) {
      setLoading(false);
      navigate({ to: "/painel" });
      return;
    }

    // Verifica a role do usuário para redirecionar corretamente
    const { data: rolesData } = await anyDb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const roles: string[] = (rolesData ?? []).map((r: { role: string }) => r.role);
    const isMembro = roles.some((r) => r === "membro" || r === "servidor");

    if (isMembro) {
      toast.success("Bem-vindo de volta.");
      navigate({ to: "/portal-membro/home" });
      return;
    }

    // Sem roles ainda — tenta auto-link (pode ser membro sem role ainda)
    if (roles.length === 0) {
      const { data: linkResult } = await anyDb.rpc("portal_auto_link_by_email");
      if (linkResult?.success) {
        toast.success(`Bem-vindo, ${linkResult.nome ?? ""}!`);
        navigate({ to: "/portal-membro/home" });
        return;
      }
    }

    // Administrador
    toast.success("Bem-vindo de volta.");
    navigate({ to: "/painel" });
    setLoading(false);
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/painel" },
    });
    if (error) toast.error("Falha no login com Google.");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <aside className="hidden lg:flex flex-col justify-between bg-gradient-sacro p-10 text-sidebar-foreground">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-accent text-gold">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-serif text-lg">Liturgia</span>
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
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-gold"><Sparkles className="h-4 w-4" /></div>
            <span className="font-serif text-lg">Liturgia</span>
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
            <button type="submit" disabled={loading} className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">ou</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button onClick={handleGoogle} className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted flex justify-center items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.3 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.2 5.2c-.4.4 6.8-5 6.8-14.8 0-1.3-.1-2.3-.4-3.5z"/></svg>
            Entrar com Google
          </button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            É servidor/acólito?{" "}
            <Link to="/membro/login" className="font-medium text-primary hover:underline">
              Entrar no portal do membro
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Ainda não tem conta? <Link to="/cadastro" className="font-medium text-primary hover:underline">Criar paróquia</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
