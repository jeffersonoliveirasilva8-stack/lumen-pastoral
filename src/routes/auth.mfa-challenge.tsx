import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Mail, Smartphone } from "lucide-react";
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

type FactorType = "email" | "totp";

function MfaChallengePage() {
  const navigate       = useNavigate();
  const [code, setCode]               = useState("");
  const [loading, setLoading]         = useState(false);
  const [factorId, setFactorId]       = useState<string | null>(null);
  const [factorType, setFactorType]   = useState<FactorType>("totp");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [checking, setChecking]       = useState(true);
  const [cooldown, setCooldown]       = useState(0);
  const processed = useRef(false);

  // Decrementa cooldown de reenvio
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    async function init() {
      // Verifica se realmente precisa de MFA
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aalData) { navigate({ to: "/login", replace: true }); return; }

      // Já está no nível exigido — redireciona
      if (aalData.currentLevel === aalData.nextLevel || aalData.nextLevel === "aal1") {
        if (!processed.current) {
          processed.current = true;
          const route = await getPostLoginRoute(supabase);
          navigate({ to: route, replace: true });
        }
        return;
      }

      // Lista fatores — prefer e-mail (mais amigável)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: factors } = await (supabase.auth.mfa.listFactors as any)();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emailFactor = ((factors?.email ?? []) as any[]).find((f: any) => f.status === "verified");
      const totpFactor  = ((factors?.totp ?? []) as any[]).find((f: any) => f.status === "verified");
      const activeFactor = emailFactor ?? totpFactor;

      if (!activeFactor) {
        // Nenhum fator cadastrado — redireciona normalmente
        const route = await getPostLoginRoute(supabase);
        navigate({ to: route, replace: true });
        return;
      }

      const type: FactorType = emailFactor ? "email" : "totp";
      setFactorId(activeFactor.id);
      setFactorType(type);

      // Para fator e-mail: envia o código imediatamente
      if (type === "email") {
        try {
          const { data: ch, error } = await supabase.auth.mfa.challenge({ factorId: activeFactor.id });
          if (!error) {
            setChallengeId(ch.id);
            setCooldown(60);
          }
        } catch { /* será tratado na UI */ }
      }

      setChecking(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resendEmailCode() {
    if (!factorId || cooldown > 0) return;
    setLoading(true);
    try {
      const { data: ch, error } = await supabase.auth.mfa.challenge({ factorId });
      if (error) throw error;
      setChallengeId(ch.id);
      setCooldown(60);
      toast.success("Novo código enviado para o seu e-mail.");
    } catch {
      toast.error("Erro ao reenviar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.length < 6) return;
    setLoading(true);
    try {
      let cid = challengeId;

      // Para TOTP: sempre cria challenge fresco (código muda a cada 30s)
      if (factorType === "totp" || !cid) {
        const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
        if (chErr) throw chErr;
        cid = ch.id;
        setChallengeId(cid);
      }

      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: cid,
        code: code.trim(),
      });

      if (vErr) {
        const msg = vErr.message?.toLowerCase() ?? "";
        if (msg.includes("expired") && factorType === "email") {
          toast.error("Código expirado. Solicite um novo código abaixo.");
          setChallengeId(null);
        } else {
          toast.error("Código incorreto. Tente novamente.");
        }
        setCode("");
        return;
      }

      // Verificação bem-sucedida → AAL2
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
        {/* Ícone + título */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            {factorType === "email"
              ? <Mail className="h-7 w-7 text-primary" />
              : <ShieldCheck className="h-7 w-7 text-primary" />}
          </div>
          <h1 className="font-serif text-2xl text-center">Verificação em dois fatores</h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            {factorType === "email"
              ? "Enviamos um código de 6 dígitos para o seu e-mail. Verifique sua caixa de entrada."
              : "Abra seu app autenticador e insira o código de 6 dígitos."}
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <Label htmlFor="mfa-code" className="flex items-center gap-1.5">
              {factorType === "email"
                ? <><Mail className="h-3.5 w-3.5" /> Código enviado por e-mail</>
                : <><Smartphone className="h-3.5 w-3.5" /> Código do autenticador</>}
            </Label>
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
            {factorType === "totp" && (
              <p className="text-xs text-muted-foreground mt-1 text-center">
                O código muda a cada 30 segundos.
              </p>
            )}
          </div>

          <Button type="submit" disabled={loading || code.length < 6} className="w-full">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Verificar
          </Button>

          {/* Reenvio — apenas para fator e-mail */}
          {factorType === "email" && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={resendEmailCode}
              disabled={loading || cooldown > 0}
            >
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código por e-mail"}
            </Button>
          )}
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
