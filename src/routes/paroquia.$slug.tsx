import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Sparkles, Church, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/paroquia/$slug")({
  component: PortalEntradaPage,
  head: () => ({ meta: [{ title: "Portal — Liturgia" }] }),
});

type ParoquiaInfo = {
  id: string;
  nome: string;
  cidade: string | null;
  diocese: string | null;
};

// ── Step types ────────────────────────────────────────────────────────

type PrimeiroAcessoStep =
  | { type: "email" }
  | { type: "senha"; nome: string; email: string }
  | { type: "confirmar"; email: string }
  | { type: "vinculando"; email: string };

function PortalEntradaPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"entrar" | "primeiro">("entrar");

  // ── Detect pending link (after e-mail confirmation) ────────────────
  const [user, setUser] = useState<{ id: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) setUser(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  // When user becomes authenticated, check if there's a pending portal link
  useEffect(() => {
    if (!user) return;
    const pendingStr = sessionStorage.getItem("liturgia_portal_pending");
    if (!pendingStr) {
      // Already authenticated — only redirect if they have a linked member record
      anyDb.from("membros").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: { data: { id: string } | null }) => {
          if (data) navigate({ to: "/portal-membro/home" });
          // Coordinator visiting the page — stay
        });
      return;
    }
    const pending = JSON.parse(pendingStr) as { slug: string; email: string };
    if (pending.slug !== slug) {
      navigate({ to: "/portal-membro/home" });
      return;
    }
    // Call link RPC and redirect
    anyDb.rpc("portal_link_auth_user", { p_slug: slug, p_email: pending.email })
      .then(({ data }: { data: { success: boolean; error?: string } }) => {
        sessionStorage.removeItem("liturgia_portal_pending");
        if (data?.success) {
          navigate({ to: "/portal-membro/home" });
        } else {
          toast.error("Não foi possível vincular sua conta. Contate o coordenador.");
        }
      });
  }, [user, slug, navigate]);

  // ── Parish query ───────────────────────────────────────────────────
  const { data: paroquia, isLoading } = useQuery<ParoquiaInfo | null>({
    queryKey: ["portal-paroquia-slug", slug],
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("paroquias")
        .select("id, nome, cidade, diocese")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!paroquia) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Church className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-serif text-2xl mb-2">Paróquia não encontrada</h1>
          <p className="text-sm text-muted-foreground">
            Verifique o endereço ou solicite o link ao seu coordenador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-sidebar text-sidebar-foreground px-4 pt-8 pb-8">
        <div className="max-w-sm mx-auto text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sidebar-accent text-gold mb-4">
            <Sparkles className="h-7 w-7" />
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl leading-tight">{paroquia.nome}</h1>
          {(paroquia.cidade || paroquia.diocese) && (
            <p className="text-sm text-sidebar-foreground/60 mt-1.5">
              {[paroquia.cidade, paroquia.diocese].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="text-xs text-sidebar-foreground/40 mt-1">Portal do Servidor</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="max-w-sm mx-auto w-full px-4 -mt-4">
        <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
          <div className="flex border-b border-border">
            <button
              onClick={() => setTab("entrar")}
              className={`flex-1 py-3 text-sm font-medium transition ${
                tab === "entrar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Entrar
            </button>
            <button
              onClick={() => setTab("primeiro")}
              className={`flex-1 py-3 text-sm font-medium transition ${
                tab === "primeiro"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Primeiro acesso
            </button>
          </div>

          <div className="p-5">
            {tab === "entrar" ? (
              <LoginForm slug={slug} />
            ) : (
              <PrimeiroAcessoForm slug={slug} />
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 mb-8">
          Coordenador?{" "}
          <a href="/login" className="text-primary hover:underline">
            Acesse o painel administrativo
          </a>
        </p>
      </div>
    </div>
  );
}

// ── LoginForm ─────────────────────────────────────────────────────────

function LoginForm({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message,
      );
      return;
    }
    // Check member record exists
    const { data: membroData } = await anyDb
      .from("membros")
      .select("id")
      .eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id)
      .maybeSingle();

    if (membroData) {
      navigate({ to: "/portal-membro/home" });
    } else {
      // Not a member — might be coordinator, redirect to admin
      navigate({ to: "/painel" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          placeholder="seu@email.com"
          autoComplete="email"
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Senha
        </label>
        <div className="relative mt-1.5">
          <input
            type={showPass ? "text" : "password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-input bg-background pl-3 pr-10 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button
        type="submit"
        disabled={loading}
        className="w-full"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Entrar
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <a href="/esqueci-senha" className="text-primary hover:underline">
          Esqueci minha senha
        </a>
      </p>
    </form>
  );
}

// ── PrimeiroAcessoForm ────────────────────────────────────────────────

function PrimeiroAcessoForm({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<PrimeiroAcessoStep>({ type: "email" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function checkEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await anyDb.rpc("portal_check_member_email", {
      p_slug: slug,
      p_email: email.trim(),
    });
    setLoading(false);

    if (error || !data) {
      toast.error("Erro ao verificar e-mail. Tente novamente.");
      return;
    }

    if (!data.found) {
      toast.error(
        "E-mail não encontrado nesta paróquia. Verifique ou contate o coordenador.",
      );
      return;
    }

    if (data.already_registered) {
      toast.error("Este e-mail já tem uma conta. Use a aba Entrar.");
      return;
    }

    setStep({ type: "senha", nome: data.nome, email: email.trim() });
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (step.type !== "senha") return;
    if (password.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);

    const { data: signUpData, error } = await supabase.auth.signUp({
      email: step.email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/paroquia/${slug}`,
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    // Store pending link so we can call portal_link_auth_user after confirmation
    sessionStorage.setItem(
      "liturgia_portal_pending",
      JSON.stringify({ slug, email: step.email }),
    );

    if (signUpData.session) {
      // Auto-confirmed (email confirmation disabled in Supabase project)
      const { data: linkData } = await anyDb.rpc("portal_link_auth_user", {
        p_slug: slug,
        p_email: step.email,
      });
      sessionStorage.removeItem("liturgia_portal_pending");
      if (linkData?.success) {
        navigate({ to: "/portal-membro/home" });
      } else {
        toast.error("Conta criada, mas não foi possível vincular. Contate o coordenador.");
      }
    } else {
      // Email confirmation required
      setStep({ type: "confirmar", email: step.email });
    }
  }

  if (step.type === "confirmar") {
    return (
      <div className="text-center space-y-4 py-2">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold">Verifique seu e-mail</p>
          <p className="text-sm text-muted-foreground mt-1">
            Enviamos um link para <strong>{step.email}</strong>. Clique no link para
            ativar sua conta e retornar ao portal.
          </p>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => setStep({ type: "email" })}
        >
          Usar outro e-mail
        </button>
      </div>
    );
  }

  if (step.type === "senha") {
    return (
      <form onSubmit={createAccount} className="space-y-4">
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          Olá, <strong>{step.nome}</strong>! Crie uma senha para acessar o portal.
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Senha
          </label>
          <div className="relative mt-1.5">
            <input
              type={showPass ? "text" : "password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background pl-3 pr-10 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="Mín. 6 caracteres"
              autoComplete="new-password"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => setStep({ type: "email" })}
          >
            Voltar
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar conta
          </Button>
        </div>
      </form>
    );
  }

  // Step: email
  return (
    <form onSubmit={checkEmail} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Insira o e-mail que o coordenador cadastrou para você.
      </p>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          placeholder="seu@email.com"
          autoComplete="email"
          autoFocus
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Verificar
      </Button>
    </form>
  );
}
