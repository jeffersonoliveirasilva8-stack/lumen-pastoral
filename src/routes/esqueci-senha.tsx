import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/esqueci-senha")({
  component: ForgotPage,
  head: () => ({ meta: [{ title: "Recuperar senha — Lumen Pastoral" }] }),
});

function translateAuthError(msg: string): string {
  if (/only request this after (\d+) second/i.test(msg)) {
    const m = msg.match(/after (\d+) second/i);
    const secs = m?.[1] ?? "alguns";
    return `Aguarde ${secs} segundo${secs === "1" ? "" : "s"} antes de solicitar novamente.`;
  }
  if (/email not found/i.test(msg)) return "E-mail não encontrado. Verifique se está cadastrado.";
  if (/invalid email/i.test(msg)) return "Endereço de e-mail inválido.";
  if (/rate limit/i.test(msg)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return msg;
}

function ForgotPage() {
  const from = new URLSearchParams(window.location.search).get("from") ?? "";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const isMemberContext = from === "membro";
  // Usar /auth/callback como redirectTo garante que a URL está na whitelist do Supabase.
  // O contexto "from" fica preservado via sessionStorage para reset-senha.tsx.
  const resetTarget = window.location.origin + "/auth/callback";

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    // Preserva contexto no sessionStorage — o redirect do Supabase pode ignorar
    // os query params do redirectTo, então reset-senha.tsx usa isso como fallback
    if (from) sessionStorage.setItem("resetFrom", from);
    else sessionStorage.removeItem("resetFrom");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: resetTarget,
    });
    setLoading(false);
    if (error) {
      toast.error(translateAuthError(error.message));
      return;
    }
    setSent(true);
  }

  const backTo = isMemberContext ? "/membro/login" : "/login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">

        {sent ? (
          <div className="text-center space-y-5">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="font-serif text-2xl">E-mail enviado!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Verifique <strong className="text-foreground">{email}</strong> e clique no link para criar sua nova senha.
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Não recebeu? Verifique a pasta de spam ou{" "}
                <button
                  className="text-primary hover:underline font-medium"
                  onClick={() => setSent(false)}
                >
                  tente novamente
                </button>
                .
              </p>
            </div>
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-7">
              <h1 className="font-serif text-3xl">
                {isMemberContext ? "Criar ou recuperar senha" : "Recuperar senha"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {isMemberContext
                  ? "Primeiro acesso? Insira seu e-mail cadastrado e enviaremos um link para você criar sua senha."
                  : "Enviaremos um link de redefinição para seu e-mail."}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
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
                  placeholder="voce@paroquia.org"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Enviar link
              </button>
            </form>

            <p className="mt-6 text-center text-sm">
              <Link to={backTo} className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium text-xs">
                <ArrowLeft className="h-3 w-3" /> Voltar ao login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
