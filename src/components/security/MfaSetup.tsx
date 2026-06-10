import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff, ShieldAlert, Copy, Check, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "idle" | "enrolling" | "verifying" | "disabling";

type EnrollData = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function MfaSetup() {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("idle");
  const [hasMfa, setHasMfa] = useState(false);
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

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
      // silently fallback
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

  async function copySecret() {
    if (!enrollData?.secret) return;
    try {
      await navigator.clipboard.writeText(enrollData.secret);
      setCopied(true);
      toast.success("Chave copiada!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente a chave acima.");
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

  if (step === "verifying" && enrollData) {
    return (
      <form onSubmit={handleVerify} className="space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          Configure seu app autenticador
        </div>

        {/* Instruções para celular — destaque */}
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Smartphone className="h-3.5 w-3.5" />
            Configurando pelo celular?
          </div>
          <ol className="text-xs text-muted-foreground space-y-1 list-none">
            <li>1. Instale um app autenticador: <span className="font-medium text-foreground">Google Authenticator</span> ou <span className="font-medium text-foreground">Authy</span></li>
            <li>2. No app, escolha <strong>Adicionar conta manualmente</strong></li>
            <li>3. Copie a chave abaixo e cole no campo "Chave"</li>
            <li>4. Digite o código de 6 dígitos gerado pelo app</li>
          </ol>
        </div>

        {/* Chave secreta — destaque para mobile */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Chave secreta (copiar e colar no app)
          </p>
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm break-all select-all text-foreground/80">
              {enrollData.secret}
            </div>
            <button
              type="button"
              onClick={copySecret}
              className="shrink-0 flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium hover:bg-muted transition"
              title="Copiar chave"
            >
              {copied
                ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copiado</>
                : <><Copy className="h-3.5 w-3.5" /> Copiar</>
              }
            </button>
          </div>
        </div>

        {/* QR Code — opcional para desktop */}
        {enrollData.qrCode && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition list-none flex items-center gap-1.5">
              <span className="text-[10px] border border-border rounded px-1.5 py-0.5 font-mono group-open:hidden">▶</span>
              <span className="text-[10px] border border-border rounded px-1.5 py-0.5 font-mono hidden group-open:inline">▼</span>
              Mostrar QR Code (para scanner de câmera)
            </summary>
            <div className="pt-3 flex flex-col items-center gap-2">
              <img
                src={enrollData.qrCode}
                alt="QR Code para autenticador"
                className="w-36 h-36 rounded-lg border border-border"
              />
              <p className="text-[11px] text-muted-foreground">
                Escaneie com a câmera do app autenticador.
              </p>
            </div>
          </details>
        )}

        {/* Código */}
        <div>
          <Label htmlFor="mfa-code">Código do autenticador (6 dígitos)</Label>
          <Input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-1 text-center text-2xl tracking-[0.5em] font-mono h-14"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <p className="text-xs text-muted-foreground mt-1">
            O código muda a cada 30 segundos. Digite assim que aparecer no app.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => { setStep("idle"); setEnrollData(null); setCode(""); }}
          >
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
            className="mt-1 text-center text-2xl tracking-[0.5em] font-mono h-14"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => { setStep("idle"); setCode(""); }}
          >
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
