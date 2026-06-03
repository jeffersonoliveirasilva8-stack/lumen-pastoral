import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cadastro")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Criar conta — Liturgia" }] }),
});

function SignupPage() {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("A senha precisa ter pelo menos 8 caracteres."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin + "/painel",
        data: { nome_completo: nome },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Conta criada! Verifique seu e-mail para confirmar.");
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-10">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-sacro text-gold"><Sparkles className="h-4 w-4" /></div>
          <span className="font-serif text-lg">Liturgia</span>
        </Link>

        <h1 className="font-serif text-3xl">Crie sua conta</h1>
        <p className="mt-2 text-sm text-muted-foreground">Depois você cadastra os dados da paróquia.</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Field label="Seu nome completo">
            <input required value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="Pe. João da Silva" />
          </Field>
          <Field label="E-mail">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="voce@paroquia.org" />
          </Field>
          <Field label="Senha (mín. 8 caracteres)">
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="••••••••" />
          </Field>

          <button disabled={loading} className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar conta
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem conta? <Link to="/login" className="font-medium text-primary hover:underline">Entrar</Link>
        </p>
      </div>

      <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid var(--color-input); background: var(--color-card); padding: 0.625rem 1rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: var(--color-ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ring) 20%, transparent); }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
