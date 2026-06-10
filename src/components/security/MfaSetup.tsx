import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "idle" | "enrolling" | "verifying" | "disabling";

type EnrollData = {
  factorId: string;
  qrCode: string;  // SVG data URI
  secret: string;
};

export function MfaSetup() {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [hasMfa, setHasMfa] = useState(false);
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const totpFactors = data?.totp ?? [];
      setHasMfa(totpFactors.some((f) => f.status === "verified"));
    } catch {
      // silently fallback — UI shows "inactive" state
    } finally {
      setLoading(false);
    }
  }

  async function handleEnroll() {
    setStep("enrolling");
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrollData({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setStep("verifying");
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error("Não foi possível iniciar a configuração de 2FA: " + (e?.message ?? "erro desconhecido"));
      setStep("idle");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollData) return;
    if (code.length < 6) { toast.error("O código deve ter 6 dígitos."); return; }
    setSubmitting(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollData.factorId,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollData.factorId,
        challengeId: challengeData.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      toast.success("Autenticação em dois fatores ativada com sucesso.");
      setCode("");
      setEnrollData(null);
      setStep("idle");
      setHasMfa(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error("Código inválido ou expirado. Tente novamente.");
      console.error("MFA verify error:", e?.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) { toast.error("O código deve ter 6 dígitos."); return; }
    setSubmitting(true);
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;

      const verifiedFactor = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!verifiedFactor) {
        toast.error("Nenhum fator MFA ativo encontrado.");
        return;
      }

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId: challengeData.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      const { error: unenrollError } = await supabase.auth.mfa.unenroll({
        factorId: verifiedFactor.id,
      });
      if (unenrollError) throw unenrollError;

      toast.success("Autenticação em dois fatores desativada.");
      setCode("");
      setStep("idle");
      setHasMfa(false);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error("Não foi possível desativar: " + (e?.message ?? "erro desconhecido"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando status…
      </div>
    );
  }

  // ── Status atual ─────────────────────────────────────────────────────

  if (step === "idle" && !hasMfa) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldOff className="h-4 w-4 text-amber-500" />
          Autenticação em dois fatores <strong>desativada</strong>
        </div>
        <p className="text-xs text-muted-foreground">
          Adicione uma camada extra de segurança usando um app autenticador (Google Authenticator, Authy, etc.).
        </p>
        <Button variant="outline" onClick={handleEnroll} disabled={submitting} className="w-full">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          Ativar autenticação em dois fatores
        </Button>
      </div>
    );
  }

  if (step === "idle" && hasMfa) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-green-600">
          <ShieldCheck className="h-4 w-4" />
          Autenticação em dois fatores <strong>ativada</strong>
        </div>
        <Button
          variant="outline"
          className="w-full text-destructive border-destructive/40 hover:bg-destructive/5"
          onClick={() => { setStep("disabling"); setCode(""); }}
        >
          <ShieldOff className="h-4 w-4 mr-2" />
          Desativar 2FA
        </Button>
      </div>
    );
  }

  // ── Enrollment: QR code + verificação ───────────────────────────────

  if (step === "verifying" && enrollData) {
    return (
      <form onSubmit={handleVerify} className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          Configure seu app autenticador
        </div>
        <p className="text-xs text-muted-foreground">
          1. Abra Google Authenticator, Authy ou similar.<br />
          2. Leia o QR code abaixo.<br />
          3. Digite o código de 6 dígitos gerado pelo app.
        </p>
        {enrollData.qrCode && (
          <div className="flex justify-center">
            <img
              src={enrollData.qrCode}
              alt="QR Code para autenticador"
              className="w-40 h-40 rounded-lg border border-border"
            />
          </div>
        )}
        <div className="rounded-lg bg-muted/40 border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">Chave manual (se o QR não funcionar):</p>
          <code className="text-xs font-mono break-all text-foreground/70">{enrollData.secret}</code>
        </div>
        <div>
          <Label htmlFor="mfa-code">Código do autenticador</Label>
          <Input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-1 text-center text-lg tracking-widest font-mono"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => { setStep("idle"); setEnrollData(null); setCode(""); }}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting || code.length < 6} className="flex-1">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirmar
          </Button>
        </div>
      </form>
    );
  }

  // ── Desativação ──────────────────────────────────────────────────────

  if (step === "disabling") {
    return (
      <form onSubmit={handleDisable} className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <ShieldOff className="h-4 w-4" />
          Confirme a desativação do 2FA
        </div>
        <p className="text-xs text-muted-foreground">
          Digite o código atual do seu app autenticador para confirmar que você ainda tem acesso antes de desativar.
        </p>
        <div>
          <Label htmlFor="mfa-disable-code">Código do autenticador</Label>
          <Input
            id="mfa-disable-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-1 text-center text-lg tracking-widest font-mono"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => { setStep("idle"); setCode(""); }}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={submitting || code.length < 6}
            className="flex-1"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Desativar 2FA
          </Button>
        </div>
      </form>
    );
  }

  return null;
}
