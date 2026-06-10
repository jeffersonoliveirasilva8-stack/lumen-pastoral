import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, KeyRound, Eye, EyeOff, ArrowRight, UserCircle2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMembroAuth } from "@/hooks/use-membro-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/membro/ativar-conta")({
  component: AtivarContaPage,
  head: () => ({ meta: [{ title: "Ativar Conta — Portal do Servidor" }] }),
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
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Se não autenticado → login
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/membro/login" });
    }
  }, [loading, user, navigate]);

  // Se conta já foi ativada → completar cadastro
  useEffect(() => {
    if (!loading && !linking && membro && membro.conta_ativada) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal-membro/completar-cadastro" as any, replace: true });
    }
  }, [loading, linking, membro, navigate]);

  // Se o link falhou (nenhum membro encontrado para o email)
  useEffect(() => {
    if (!loading && !linking && user && membro === null) {
      setLinkError(
        "Nenhum cadastro encontrado para o e-mail " + (user.email ?? "") +
        ". Verifique com o coordenador se seu e-mail está correto."
      );
    }
  }, [loading, linking, user, membro]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const erroSenha = validarSenha(senha);
    if (erroSenha) { toast.error(erroSenha); return; }
    if (senha !== confirmar) { toast.error("As senhas não conferem."); return; }

    setSalvando(true);
    try {
      // 1. Define a senha no Supabase Auth
      const { error: authErr } = await supabase.auth.updateUser({ password: senha });
      if (authErr) {
        toast.error("Erro ao salvar senha: " + authErr.message);
        return;
      }

      // 2. Marca conta como ativada no banco (SECURITY DEFINER — ignora RLS)
      const { data: rpcData } = await anyDb.rpc("ativar_conta_membro");
      if (rpcData && !rpcData.success) {
        // Erro não-fatal — conta foi ativada no auth, só falhou o registro no banco
        console.warn("[ativar-conta] RPC warning:", rpcData.error);
      }

      toast.success("Senha criada! Agora complete seu perfil.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal-membro/completar-cadastro" as any, replace: true });
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

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

        {/* ── Erro: nenhum cadastro encontrado ── */}
        {linkError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <UserCircle2 className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h2 className="font-serif text-xl mb-2">Cadastro não encontrado</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nenhum cadastro de servidor foi encontrado para{" "}
                <strong className="text-foreground">{user?.email}</strong>.
              </p>
              <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3 text-left text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">O que verificar:</p>
                <p>• O link de ativação pode ter expirado. Peça ao coordenador reenviar.</p>
                <p>• Confirme que seu coordenador cadastrou exatamente <strong>{user?.email}</strong>.</p>
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
        {!linkError && membro && !membro.conta_ativada && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="h-7 w-7 text-primary" />
              </div>
              <h1 className="font-serif text-2xl">Criar sua senha</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Olá, <strong>{membro.nome.split(" ")[0]}</strong>! Defina uma senha para acessar
                o portal sempre que quiser.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                disabled={salvando || !!validarSenha(senha) || senha !== confirmar}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Definir senha e continuar
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
