import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Mail, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/admin-mfa")({
  component: AdminMfaPage,
  head: () => ({ meta: [{ title: "Verificação — Lumen Pastoral" }] }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN = 60;

function AdminMfaPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [paroquiaNome, setParoquiaNome] = useState("Pastoral");
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);
  const processed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Decrementa cooldown de reenvio a cada segundo
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate({ to: "/login", replace: true }); return; }

      setUserEmail(user.email ?? "");
      setUserName(user.user_metadata?.full_name ?? user.email ?? "");

      // Busca nome da paróquia para exibição
      try {
        const { data: profile } = await anyDb
          .from("profiles")
          .select("paroquia_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.paroquia_id) {
          const { data: pq } = await anyDb
            .from("paroquias")
            .select("nome")
            .eq("id", profile.paroquia_id)
            .maybeSingle();
          if (pq?.nome) setParoquiaNome(pq.nome);
        }
      } catch { /* não-fatal */ }

      // Envia o primeiro código automaticamente (se não enviado ainda)
      if (!processed.current) {
        processed.current = true;
        await sendCode(user.email ?? "", user.user_metadata?.full_name ?? "");
      }

      setTimeout(() => inputRef.current?.focus(), 300);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode(toEmail: string, toNome: string) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          template: "mfa_admin_code",
          to:       toEmail || userEmail,
          nome:     toNome || userName,
          paroquia: paroquiaNome,
        },
      });
      if (error) {
        // Tenta extrair mensagem de erro do corpo da resposta
        let msg = "Erro ao enviar código. Tente novamente.";
        try {
          const body = typeof error.message === "string" ? JSON.parse(error.message) : error;
          if (body?.error) msg = body.error;
        } catch { /* usa msg padrão */ }
        toast.error(msg);
        return;
      }
      if (data && !data.ok) {
        toast.error(data.error ?? "Erro ao enviar código. Tente novamente.");
        return;
      }
      // Fallback: e-mail falhou mas código foi gerado — exibe na tela
      if (data?.fallback_code) {
        setFallbackCode(data.fallback_code);
        setCode(data.fallback_code);
      }
      setCooldown(RESEND_COOLDOWN);
    } catch {
      toast.error("Erro de conexão ao enviar código.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || loading) return;
    await sendCode(userEmail, userName);
    toast.success("Novo código enviado para " + userEmail);
    setCode("");
    setAttempts(0);
    inputRef.current?.focus();
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 6) { toast.error("O código deve ter 6 dígitos."); return; }
    if (attempts >= MAX_ATTEMPTS) {
      toast.error("Número máximo de tentativas atingido. Solicite um novo código.");
      return;
    }

    setVerifying(true);
    try {
      const { data: result, error } = await anyDb.rpc("verify_admin_mfa_code", {
        p_code: trimmed,
      });

      if (error || !result) {
        setAttempts((a) => a + 1);
        toast.error("Erro ao verificar. Tente novamente.");
        setCode("");
        inputRef.current?.focus();
        return;
      }

      if (!result.success) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          toast.error("Muitas tentativas incorretas. Solicite um novo código.");
        } else {
          toast.error(result.error ?? "Código incorreto.");
        }
        setCode("");
        inputRef.current?.focus();
        return;
      }

      // Verificação bem-sucedida — armazena session token
      if (result.session_token) {
        sessionStorage.setItem("admin_mfa_token", result.session_token);
      }

      toast.success("Identidade verificada. Bem-vindo(a)!");

      // Verifica se admin tem paróquia configurada (onboarding)
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const { data: prof } = await anyDb
          .from("profiles")
          .select("paroquia_id")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (!prof?.paroquia_id) {
          navigate({ to: "/onboarding", replace: true });
          return;
        }
      }
      navigate({ to: "/painel", replace: true });
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignOut() {
    sessionStorage.removeItem("admin_mfa_token");
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const canVerify = code.trim().length === 6 && attempts < MAX_ATTEMPTS && !verifying;

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">

        {/* Ícone + título */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-5 ring-2 ring-primary/20">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-serif text-2xl text-center">Verificação de identidade</h1>
          <p className="text-sm text-muted-foreground text-center mt-2 leading-relaxed">
            Enviamos um código de 6 dígitos para{" "}
            <strong className="text-foreground">{userEmail || "seu e-mail"}</strong>.
          </p>
        </div>

        {/* Aviso de fallback quando e-mail não pôde ser enviado */}
        {fallbackCode && (
          <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <p className="font-semibold">E-mail indisponível no momento</p>
                <p>O serviço de e-mail está temporariamente suspenso. Seu código foi gerado e preenchido automaticamente abaixo.</p>
              </div>
            </div>
            <div className="mt-3 text-center font-mono text-2xl font-bold tracking-[0.4em] text-amber-700 dark:text-amber-300">
              {fallbackCode}
            </div>
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              <Mail className="h-3.5 w-3.5" /> Código de verificação
            </label>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full text-center text-3xl font-mono tracking-[0.5em] rounded-xl border border-input bg-card px-4 py-4 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={verifying || loading || attempts >= MAX_ATTEMPTS}
            />
            {attempts > 0 && attempts < MAX_ATTEMPTS && (
              <p className="text-xs text-destructive text-center mt-1.5">
                {MAX_ATTEMPTS - attempts} tentativa{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} restante{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canVerify || loading}
            className="w-full flex justify-center items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
          >
            {verifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {verifying ? "Verificando…" : "Verificar"}
          </button>

          {/* Reenvio */}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || loading || verifying}
            className="w-full flex justify-center items-center gap-1.5 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-50 transition"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
          </button>
        </form>

        {/* Info */}
        <div className="mt-5 rounded-xl bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p>• O código expira em <strong>10 minutos</strong></p>
          <p>• Verifique também a pasta de spam</p>
          <p>• Máximo de {MAX_ATTEMPTS} tentativas por código</p>
        </div>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition"
          >
            Entrar com outra conta
          </button>
        </div>
      </div>
    </div>
  );
}
