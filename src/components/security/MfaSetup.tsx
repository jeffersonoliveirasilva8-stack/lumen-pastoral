import { useEffect, useState } from "react";
import {
  Loader2, ShieldCheck, ShieldOff, ShieldAlert, Copy, Check,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type TotpStep = "idle" | "enrolling" | "verifying" | "disabling";

type TotpEnrollData = { factorId: string; qrCode: string; secret: string };

// ── Subcomponente: MFA por App Autenticador (TOTP) ────────────────────────────

function TotpMfaSection() {
  const [loading, setLoading]     = useState(true);
  const [step, setStep]           = useState<TotpStep>("idle");
  const [hasTotpMfa, setHasTotpMfa] = useState(false);
  const [enrollData, setEnrollData] = useState<TotpEnrollData | null>(null);
  const [code, setCode]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied]       = useState(false);

  useEffect(() => { checkStatus(); }, []);

  async function checkStatus() {
    setLoading(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      setHasTotpMfa((data?.totp ?? []).some((f) => f.status === "verified"));
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }

  async function handleEnroll() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrollData({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setStep("verifying");
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error("Não foi possível iniciar: " + (e?.message ?? "erro desconhecido"));
      setStep("idle");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollData || code.length < 6) return;
    setSubmitting(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrollData.factorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enrollData.factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      toast.success("Autenticador configurado com sucesso.");
      setCode("");
      setEnrollData(null);
      setStep("idle");
      setHasTotpMfa(true);
    } catch {
      toast.error("Código inválido ou expirado. O código muda a cada 30s.");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    setSubmitting(true);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!verified) { toast.error("Nenhum autenticador ativo encontrado."); return; }
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: verified.id });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: verified.id, challengeId: ch.id, code: code.trim(),
      });
      if (vErr) throw vErr;
      const { error: uErr } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
      if (uErr) throw uErr;
      toast.success("Autenticador removido.");
      setCode("");
      setStep("idle");
      setHasTotpMfa(false);
    } catch {
      toast.error("Código inválido.");
      setCode("");
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
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  }

  if (loading) return null;

  if (step === "idle") {
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-2 text-sm ${hasTotpMfa ? "text-green-600" : "text-muted-foreground"}`}>
          {hasTotpMfa
            ? <><ShieldCheck className="h-4 w-4" /> Autenticador <strong>ativo</strong></>
            : <><ShieldOff className="h-4 w-4 text-muted-foreground/60" /> Autenticador <strong>não configurado</strong></>
          }
        </div>
        {hasTotpMfa ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive border-destructive/40 hover:bg-destructive/5"
            onClick={() => { setStep("disabling"); setCode(""); }}
          >
            <ShieldOff className="h-3.5 w-3.5 mr-2" /> Remover autenticador
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleEnroll} disabled={submitting} className="w-full">
            {submitting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              : <Smartphone className="h-3.5 w-3.5 mr-2" />}
            Configurar autenticador
          </Button>
        )}
      </div>
    );
  }

  if (step === "verifying" && enrollData) {
    return (
      <form onSubmit={handleVerify} className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          Configure o app autenticador
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Smartphone className="h-3.5 w-3.5" /> Pelo celular
          </div>
          <ol className="text-xs text-muted-foreground space-y-1 list-none">
            <li>1. Instale o <strong className="text-foreground">Google Authenticator</strong> ou <strong className="text-foreground">Authy</strong></li>
            <li>2. No app, escolha <strong>Adicionar conta manualmente</strong></li>
            <li>3. Copie a chave abaixo e cole no app</li>
            <li>4. Digite o código de 6 dígitos gerado</li>
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chave secreta</p>
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm break-all select-all text-foreground/80">
              {enrollData.secret}
            </div>
            <button
              type="button"
              onClick={copySecret}
              className="shrink-0 flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium hover:bg-muted transition"
            >
              {copied
                ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copiado</>
                : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
            </button>
          </div>
        </div>

        {enrollData.qrCode && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none flex items-center gap-1.5">
              <span className="text-[10px] border border-border rounded px-1.5 py-0.5 font-mono group-open:hidden">▶</span>
              <span className="text-[10px] border border-border rounded px-1.5 py-0.5 font-mono hidden group-open:inline">▼</span>
              Mostrar QR Code
            </summary>
            <div className="pt-3 flex flex-col items-center gap-2">
              <img src={enrollData.qrCode} alt="QR Code" className="w-36 h-36 rounded-lg border border-border" />
              <p className="text-[11px] text-muted-foreground">Escaneie com a câmera do app.</p>
            </div>
          </details>
        )}

        <div>
          <Label htmlFor="totp-code">Código do autenticador (6 dígitos)</Label>
          <Input
            id="totp-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-1 text-center text-2xl tracking-[0.5em] font-mono h-14"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <p className="text-xs text-muted-foreground mt-1">O código muda a cada 30 segundos.</p>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1"
            onClick={() => { setStep("idle"); setEnrollData(null); setCode(""); }}>
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
          <ShieldOff className="h-4 w-4" /> Confirmar remoção do autenticador
        </div>
        <div>
          <Label htmlFor="totp-disable-code">Código do autenticador</Label>
          <Input
            id="totp-disable-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-1 text-center text-2xl tracking-[0.5em] font-mono h-14"
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1"
            onClick={() => { setStep("idle"); setCode(""); }}>
            Cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={submitting || code.length < 6} className="flex-1">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Remover
          </Button>
        </div>
      </form>
    );
  }

  return null;
}

// ── Componente principal ───────────────────────────────────────────────────────

export function MfaSetup() {
  return (
    <div className="space-y-4">
      {/* Método: App Autenticador (TOTP) — único disponível */}
      <div className="rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Smartphone className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">App autenticador (TOTP)</p>
          <span className="ml-auto text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">Recomendado</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Use o Google Authenticator, Authy ou outro app compatível. A cada login, será solicitado o código de 6 dígitos gerado pelo app.
        </p>
        <TotpMfaSection />
      </div>
    </div>
  );
}
