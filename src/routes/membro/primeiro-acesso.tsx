import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, CheckCircle2, ArrowRight, UserCircle2, Phone, Calendar, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMembroAuth } from "@/hooks/use-membro-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/membro/primeiro-acesso")({
  component: PrimeiroAcessoPage,
  head: () => ({ meta: [{ title: "Primeiro Acesso — Portal do Servidor" }] }),
});

type Step = "link" | "perfil" | "ok";

function PrimeiroAcessoPage() {
  const navigate = useNavigate();
  const { user, membro, loading, linking, refreshMembro } = useMembroAuth();

  const [step, setStep] = useState<Step>("link");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Campos de perfil
  const [telefone, setTelefone] = useState("");
  const [dataNasc, setDataNasc] = useState("");

  // Se não autenticado → login
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/membro/login" });
    }
  }, [loading, user, navigate]);

  // Se já tem membro vinculado → pula para perfil ou portal
  useEffect(() => {
    if (!loading && !linking && membro) {
      if (step === "link") {
        setTelefone(membro.telefone ?? "");
        setStep("perfil");
      }
    }
  }, [loading, linking, membro, step]);

  // Se o auto-link do hook falhou (loading=false, linking=false, membro=null)
  useEffect(() => {
    if (!loading && !linking && !membro && user && step === "link") {
      setLinkError(
        "Nenhum cadastro encontrado para o e-mail " + (user.email ?? "") +
        ". Verifique com o coordenador se seu e-mail está cadastrado corretamente."
      );
    }
  }, [loading, linking, membro, user, step]);

  async function handleSalvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    if (!membro) return;
    if (!telefone.trim()) { toast.error("Telefone é obrigatório."); return; }
    if (!dataNasc) { toast.error("Data de nascimento é obrigatória."); return; }
    setSaving(true);
    const { error } = await anyDb
      .from("membros")
      .update({
        telefone: telefone.trim() || null,
        data_nascimento: dataNasc || null,
      })
      .eq("id", membro.id);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar perfil.");
      return;
    }
    await refreshMembro();
    setStep("ok");
  }

  if (loading || linking) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Verificando seu cadastro…</p>
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

        {/* ── Step: link error ── */}
        {step === "link" && linkError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <UserCircle2 className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Cadastro não encontrado</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nenhum cadastro de servidor encontrado para{" "}
                <strong className="text-foreground">{user?.email}</strong>.
              </p>
              <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3 text-left text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">O que verificar:</p>
                <p>• O coordenador cadastrou exatamente <strong>{user?.email}</strong> na lista de membros?</p>
                <p>• Peça ao coordenador para confirmar o e-mail no painel de Membros.</p>
                <p>• Tente acessar pelo link da sua paróquia (ex: <em>/paroquia/nome-da-paroquia</em>).</p>
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

        {/* ── Step: link tentando ── */}
        {step === "link" && !linkError && (
          <div className="text-center space-y-4">
            <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Vinculando seu cadastro…</p>
          </div>
        )}

        {/* ── Step: perfil ── */}
        {step === "perfil" && membro && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <UserCircle2 className="h-7 w-7 text-primary" />
              </div>
              <h1 className="font-serif text-2xl">Olá, {membro.nome.split(" ")[0]}!</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Bem-vindo ao Portal do Servidor. Complete seu perfil para começar.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Paróquia
                </p>
              </div>
              <p className="font-medium text-sm">{membro.paroquia_nome}</p>
              {membro.ministerios.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {membro.ministerios.map((m) => (
                    <span
                      key={m.id}
                      className="text-xs px-2 py-0.5 rounded-full border"
                      style={{ backgroundColor: m.cor + "20", borderColor: m.cor + "40", color: m.cor }}
                    >
                      {m.nome}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handleSalvarPerfil} className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  <Phone className="h-3 w-3" /> Telefone / WhatsApp *
                </label>
                <input
                  type="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  required
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  <Calendar className="h-3 w-3" /> Data de nascimento *
                </label>
                <input
                  type="date"
                  value={dataNasc}
                  onChange={(e) => setDataNasc(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Esses dados são necessários para o funcionamento do Motor de Escalas.
              </p>

              <button
                type="submit"
                disabled={saving}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Salvar e continuar
              </button>
            </form>
          </div>
        )}

        {/* ── Step: ok ── */}
        {step === "ok" && (
          <div className="text-center space-y-6">
            <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <div>
              <h1 className="font-serif text-2xl mb-2">Tudo pronto!</h1>
              <p className="text-sm text-muted-foreground">
                Seu acesso está configurado. Você já pode ver suas escalas e confirmar participações.
              </p>
            </div>
            <button
              onClick={() => navigate({ to: "/portal-membro/home" })}
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 transition"
            >
              <ArrowRight className="h-4 w-4" /> Acessar meu portal
            </button>
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">
                Quer entrar com e-mail e senha na próxima vez?
              </p>
              <a
                href="/esqueci-senha?from=membro"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <KeyRound className="h-3.5 w-3.5" /> Criar minha senha
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
