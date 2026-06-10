import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPostLoginRoute } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/mfa-challenge")({
  component: MfaChallengePage,
  head: () => ({ meta: [{ title: "Verificação em dois fatores — Lumen Pastoral" }] }),
});

function MfaChallengePage() {
  const navigate    = useNavigate();
  const [code, setCode]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const processed = useRef(false);

  useEffect(() => {
    async function init() {
      // Verifica se realmente precisa de MFA
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aalData) { navigate({ to: "/login", replace: true }); return; }

      // Se já está no nível exigido, redireciona diretamente
      if (aalData.currentLevel === aalData.nextLevel || aalData.nextLevel === "aal1") {
        if (!processed.current) {
          processed.current = true;
          const route = await getPostLoginRoute(supabase);
          navigate({ to: route, replace: true });
        }
        return;
      }

      // Busca o fator TOTP verificado
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!totp) {
        // Nenhum fator cadastrado — redireciona normalmente
        const route = await getPostLoginRoute(supabase);
        navigate({ to: route, replace: true });
        return;
      }

      setFactorId(totp.id);
      setChecking(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.length < 6) return;
    setLoading(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr) throw cErr;

      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (vErr) {
        toast.error("Código inválido ou expirado. Tente novamente.");
        setCode("");
        return;
      }

      // Challenge bem-sucedido → agora AAL2
      const route = await getPostLoginRoute(supabase);
      navigate({ to: route, replace: true });
    } catch {
      toast.error("Erro ao verificar o código. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  if (checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h1 className="font-serif text-2xl text-center">Verificação em dois fatores</h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Abra seu app autenticador e insira o código de 6 dígitos.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <Label htmlFor="mfa-code">Código do autenticador</Label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="mt-1.5 text-center text-2xl tracking-[0.5em] font-mono h-14"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
          </div>

          <Button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Verificar
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Entrar com outra conta
          </button>
        </div>
      </div>
    </div>
  );
}
