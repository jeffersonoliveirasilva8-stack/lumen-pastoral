import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, User, Save, Star, Calendar, Phone, Shield, Camera, Bell, BellOff, CheckCircle2, MessageCircle } from "lucide-react";
import { usePushNotification } from "@/hooks/usePushNotification";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MfaSetup } from "@/components/security/MfaSetup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const FOTO_BUCKET = "membros-fotos";

function MembroPushSection({ paroquiaId }: { paroquiaId: string | null | undefined }) {
  const { status, isSupported, subscribe, unsubscribe, sendTestPush } = usePushNotification(paroquiaId);
  const [testingSend, setTestingSend] = useState(false);
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;

  let statusLabel = "Não ativadas";
  let statusColor = "text-muted-foreground";
  if (status === "granted")    { statusLabel = "Ativadas neste dispositivo"; statusColor = "text-emerald-600"; }
  else if (status === "denied") { statusLabel = "Bloqueadas — libere nas configurações do browser"; statusColor = "text-destructive"; }
  else if (status === "unsupported" && isIOS && !isStandalone) { statusLabel = "Instale o app na Tela de Início para ativar"; statusColor = "text-amber-600"; }
  else if (status === "error")  { statusLabel = "Erro ao ativar — tente novamente"; statusColor = "text-destructive"; }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <Bell className="h-3.5 w-3.5 text-muted-foreground" /> Notificações
      </p>
      <div className="flex items-center gap-2">
        {status === "granted"
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          : <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
      </div>
      {status === "unsupported" && isIOS && !isStandalone && (
        <p className="text-xs text-muted-foreground leading-relaxed bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
          No iPhone/iPad: toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de Início</strong>, abra o app instalado e volte aqui.
        </p>
      )}
      {status === "granted" ? (
        <div className="space-y-2">
          <Button
            size="sm" variant="outline" className="w-full"
            disabled={testingSend}
            onClick={async () => {
              setTestingSend(true);
              try { await sendTestPush(); } finally { setTestingSend(false); }
            }}
          >
            {testingSend ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            Enviar notificação de teste
          </Button>
          <Button
            size="sm" variant="outline"
            className="w-full text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={unsubscribe}
          >
            <BellOff className="h-3.5 w-3.5" /> Desativar notificações
          </Button>
        </div>
      ) : (
        <Button
          size="sm" className="w-full"
          disabled={!isSupported || status === "loading" || status === "denied"}
          onClick={subscribe}
        >
          {status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          {status === "error" ? "Tentar novamente" : "Ativar notificações"}
        </Button>
      )}
    </div>
  );
}

// ── Seção de consentimento WhatsApp ────────────────────────────

type WhatsAppConsentState = {
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  whatsapp_telefone: string | null;
};

function extractDDDNumero(tel: string | null | undefined): string {
  if (!tel) return "";
  const digits = tel.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits.slice(2);
  if (digits.length >= 10 && digits.length <= 11) return digits;
  return "";
}

function MembroWhatsAppSection({
  membroId,
  telefoneExistente,
}: {
  membroId: string | undefined;
  telefoneExistente?: string | null;
}) {
  const qc = useQueryClient();
  const [telefone, setTelefone] = useState(() => extractDDDNumero(telefoneExistente));
  const [showRevoke, setShowRevoke] = useState(false);

  useEffect(() => {
    setTelefone((prev) => (prev ? prev : extractDDDNumero(telefoneExistente)));
  }, [telefoneExistente]);

  const handleTelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTelefone(e.target.value.replace(/\D/g, "").slice(0, 11));
  }, []);

  const RPC_ERRORS: Record<string, string> = {
    not_authenticated:             "Sessão expirada. Faça login novamente.",
    opt_in_obrigatorio:            "Informe se deseja habilitar ou revogar.",
    telefone_obrigatorio:          "Informe o número de telefone.",
    telefone_invalido:             "Número inválido. Inclua DDI e DDD (8 a 15 dígitos).",
    membro_nao_encontrado:         "Membro não encontrado. Contate a paróquia.",
    multiplos_membros_encontrados: "Conta com mais de um membro vinculado. Contate a paróquia.",
  };

  const { data: consent, isLoading, isError: isQueryError } = useQuery<WhatsAppConsentState | null>({
    queryKey: ["pm-whatsapp-consent", membroId],
    enabled: !!membroId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select("whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_telefone")
        .eq("id", membroId)
        .single();
      if (error) throw error;
      return data ?? null;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ optIn, tel }: { optIn: boolean; tel?: string }) => {
      const params: Record<string, unknown> = { p_opt_in: optIn };
      if (tel !== undefined) params.p_telefone = tel;
      const { data, error } = await anyDb.rpc("atualizar_consentimento_whatsapp", params);
      if (error) throw error;
      if (!data?.success) {
        const code = data?.error as string | undefined;
        throw new Error(RPC_ERRORS[code ?? ""] ?? "Falha ao atualizar consentimento.");
      }
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["pm-whatsapp-consent", membroId] });
      if (vars.optIn) {
        toast.success("Notificações por WhatsApp habilitadas.");
        setTelefone("");
      } else {
        toast.success("Consentimento revogado.");
        setShowRevoke(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function validarCelularBR(digits: string): string | null {
    if (digits.length !== 11) return "O número deve ter DDD (2 dígitos) + 9 dígitos de celular.";
    const ddd = parseInt(digits.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) return "DDD inválido.";
    if (digits[2] !== "9") return "Apenas celulares são aceitos (número deve começar com 9 após o DDD).";
    return null;
  }

  function handleOptIn(e: React.FormEvent) {
    e.preventDefault();
    const digits = telefone.replace(/\D/g, "");
    const erro = validarCelularBR(digits);
    if (erro) { toast.error(erro); return; }
    mutation.mutate({ optIn: true, tel: "55" + digits });
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" /> WhatsApp
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Carregando...</span>
        </div>
      ) : isQueryError ? (
        <p className="text-xs text-destructive">
          Não foi possível carregar o estado do consentimento. Tente novamente mais tarde.
        </p>
      ) : consent?.whatsapp_opt_in ? (
        /* ── Habilitado ── */
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-xs text-emerald-600">
              Notificações habilitadas
              {consent.whatsapp_telefone ? ` — +${consent.whatsapp_telefone}` : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Você receberá notificações da paróquia via WhatsApp.
          </p>
          {!showRevoke ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setShowRevoke(true)}
            >
              <BellOff className="h-3.5 w-3.5" /> Revogar consentimento
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-xs text-destructive font-medium">
                Tem certeza? Você deixará de receber notificações via WhatsApp.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowRevoke(false)}
                  disabled={mutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ optIn: false })}
                >
                  {mutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : "Confirmar revogação"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Não habilitado ── */
        <form onSubmit={handleOptIn} className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Autorize o recebimento de notificações da paróquia via WhatsApp.
            {consent?.whatsapp_opt_in_at && (
              <span className="block mt-1 text-muted-foreground/60">
                Consentimento revogado anteriormente.
              </span>
            )}
          </p>
          <div className="space-y-1">
            <Label htmlFor="wpp-telefone" className="text-xs">
              Número de WhatsApp
            </Label>
            <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
              <span className="px-3 text-sm text-muted-foreground border-r border-input bg-muted select-none">
                +55
              </span>
              <input
                id="wpp-telefone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="11 99999-9999"
                value={telefone}
                onChange={handleTelChange}
                disabled={mutation.isPending}
                className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              DDD + celular com 9 na frente. Ex: 11 99999-9999
            </p>
          </div>
          <Button
            type="submit"
            size="sm"
            className="w-full"
            disabled={mutation.isPending || telefone.replace(/\D/g, "").length !== 11}
          >
            {mutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <MessageCircle className="h-3.5 w-3.5" />}
            Habilitar notificações por WhatsApp
          </Button>
        </form>
      )}
    </div>
  );
}

export const Route = createFileRoute("/portal-membro/perfil")({
  component: PortalMembroPerfil,
  head: () => ({ meta: [{ title: "Meu Perfil — Portal do Servidor" }] }),
});

type MembroCompleto = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  data_ingresso: string | null;
  cpf: string | null;
  rg: string | null;
  endereco: string | null;
  cidade: string | null;
  cep: string | null;
  nome_pai: string | null;
  nome_mae: string | null;
  nome_emergencia: string | null;
  telefone_emergencia: string | null;
  observacoes: string | null;
  foto_url: string | null;
  score: number;
  atuacoes: { id: string; nome: string; cor: string }[];
};

type FormData = {
  nome: string;
  telefone: string;
  data_nascimento: string;
  cpf: string;
  rg: string;
  endereco: string;
  cidade: string;
  cep: string;
  nome_pai: string;
  nome_mae: string;
  nome_emergencia: string;
  telefone_emergencia: string;
  observacoes: string;
};

function PortalMembroPerfil() {
  const { membro, refreshMembro } = useMembroAuth();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [localFotoUrl, setLocalFotoUrl] = useState<string | null>(null);

  const { data: membroData, isLoading } = useQuery<MembroCompleto | null>({
    queryKey: ["pm-perfil", membro?.id],
    enabled: !!membro?.id,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("membros")
        .select(`
          id, nome, email, telefone, data_nascimento, data_ingresso,
          cpf, rg, endereco, cidade, cep,
          nome_pai, nome_mae,
          nome_emergencia, telefone_emergencia,
          observacoes, foto_url, score,
          membro_atuacoes(atuacoes_pastorais(id, nome, cor))
        `)
        .eq("id", membro!.id)
        .single();
      if (error) throw error;
      return {
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        atuacoes: (data.membro_atuacoes ?? []).map((ma: any) => ma.atuacoes_pastorais).filter(Boolean),
      };
    },
  });

  const [form, setForm] = useState<FormData>({
    nome: "", telefone: "", data_nascimento: "",
    cpf: "", rg: "", endereco: "", cidade: "", cep: "",
    nome_pai: "", nome_mae: "",
    nome_emergencia: "", telefone_emergencia: "", observacoes: "",
  });

  useEffect(() => {
    if (membroData) {
      setForm({
        nome: membroData.nome ?? "",
        telefone: membroData.telefone ?? "",
        data_nascimento: membroData.data_nascimento ?? "",
        cpf: membroData.cpf ?? "",
        rg: membroData.rg ?? "",
        endereco: membroData.endereco ?? "",
        cidade: membroData.cidade ?? "",
        cep: membroData.cep ?? "",
        nome_pai: membroData.nome_pai ?? "",
        nome_mae: membroData.nome_mae ?? "",
        nome_emergencia: membroData.nome_emergencia ?? "",
        telefone_emergencia: membroData.telefone_emergencia ?? "",
        observacoes: membroData.observacoes ?? "",
      });
      setLocalFotoUrl(membroData.foto_url ?? null);
    }
  }, [membroData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório.");
      if (form.data_nascimento) {
        const hoje = new Date().toISOString().slice(0, 10);
        if (form.data_nascimento > hoje) throw new Error("Data de nascimento não pode ser no futuro.");
      }

      const payload = {
        nome: form.nome.trim(),
        telefone: form.telefone || null,
        data_nascimento: form.data_nascimento || null,
        cpf: form.cpf || null,
        rg: form.rg || null,
        endereco: form.endereco || null,
        cidade: form.cidade || null,
        cep: form.cep || null,
        nome_pai: form.nome_pai || null,
        nome_mae: form.nome_mae || null,
        nome_emergencia: form.nome_emergencia || null,
        telefone_emergencia: form.telefone_emergencia || null,
        observacoes: form.observacoes || null,
      };

      // Tenta RPC SECURITY DEFINER (garante sync mesmo sem auth_user_id correto).
      // PGRST202 = função não encontrada → patch SQL ainda não aplicado → fallback direto.
      const { data: result, error: rpcError } = await anyDb.rpc("atualizar_perfil_membro", {
        p_nome:                payload.nome,
        p_telefone:            payload.telefone,
        p_data_nascimento:     payload.data_nascimento,
        p_cpf:                 payload.cpf,
        p_rg:                  payload.rg,
        p_endereco:            payload.endereco,
        p_cidade:              payload.cidade,
        p_cep:                 payload.cep,
        p_nome_pai:            payload.nome_pai,
        p_nome_mae:            payload.nome_mae,
        p_nome_emergencia:     payload.nome_emergencia,
        p_telefone_emergencia: payload.telefone_emergencia,
        p_observacoes:         payload.observacoes,
      });

      if (!rpcError) {
        if (result && !result.success) throw new Error(result.error ?? "Erro ao salvar perfil.");
        return;
      }

      // Fallback: UPDATE direto (funciona quando PATCH_O ainda não foi aplicado)
      if (rpcError.code === "PGRST202" || rpcError.message?.includes("atualizar_perfil_membro")) {
        const { error: updateError } = await anyDb
          .from("membros")
          .update(payload)
          .eq("id", membro!.id);
        if (updateError) throw updateError;
        return;
      }

      throw rpcError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-perfil"] });
      refreshMembro();
      toast.success("Perfil atualizado.");
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !membro) return;

    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Foto deve ter no máximo ${maxMb}MB.`);
      return;
    }

    setUploadingPhoto(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${membro.id}/foto.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(FOTO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      toast.error("Erro ao enviar foto: " + upErr.message);
      setUploadingPhoto(false);
      return;
    }

    const { data: urlData } = supabase.storage.from(FOTO_BUCKET).getPublicUrl(path);
    const url = urlData.publicUrl + `?t=${Date.now()}`;

    const { error: dbErr } = await anyDb
      .from("membros")
      .update({ foto_url: url })
      .eq("id", membro.id);

    setUploadingPhoto(false);
    if (dbErr) {
      toast.error("Foto enviada mas falhou ao salvar URL.");
    } else {
      setLocalFotoUrl(url);
      qc.invalidateQueries({ queryKey: ["pm-perfil"] });
      refreshMembro();
      toast.success("Foto atualizada.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function set(key: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function setMasked(key: keyof FormData, mask: (v: string) => string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: mask(e.target.value) }));
  }

  function maskPhone(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2)  return d.replace(/(\d{1,2})/, "($1");
    if (d.length <= 6)  return d.replace(/(\d{2})(\d{1,4})/, "($1) $2");
    if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{1,4})/, "($1) $2-$3");
    return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  function maskCpf(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3)  return d;
    if (d.length <= 6)  return d.replace(/(\d{3})(\d{1,3})/, "$1.$2");
    if (d.length <= 9)  return d.replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3");
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
  }
  function maskCep(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 5) return d;
    return d.replace(/(\d{5})(\d{1,3})/, "$1-$2");
  }

  if (isLoading || !membroData) {
    return (
      <div className="p-4 sm:p-6 pb-24">
        <PageSkeleton cards={3} />
      </div>
    );
  }

  const fotoDisplay = localFotoUrl ?? membroData.foto_url;

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto pb-24">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">Portal</p>
        <h1 className="mt-1.5 font-serif text-3xl">Meu Perfil</h1>
      </div>

      {/* Status card */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Avatar / foto */}
          <div className="relative shrink-0">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
              {fotoDisplay ? (
                <img src={fotoDisplay} alt="Foto" className="h-full w-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-primary" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 transition disabled:opacity-60"
              title="Alterar foto"
            >
              {uploadingPhoto
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Camera className="h-3 w-3" />
              }
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          <div className="min-w-0 text-center sm:text-left">
            <p className="font-semibold truncate">{membroData.nome}</p>
            <p className="text-xs text-muted-foreground">{membroData.email}</p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1 text-xs">
                <Star className="h-3 w-3 text-amber-500" />
                <span className="font-medium">{membroData.score} pts</span>
              </div>
              {membroData.data_ingresso && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>Desde {format(new Date(membroData.data_ingresso + "T12:00:00"), "MMM yyyy", { locale: ptBR })}</span>
                </div>
              )}
            </div>
            {membroData.atuacoes.length > 0 && (
              <div className="mt-2">
                <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1">Atuação Pastoral</p>
                <div className="flex flex-wrap gap-1">
                  {membroData.atuacoes.map((a) => (
                    <span
                      key={a.id}
                      className="text-[10px] px-1.5 py-px rounded-full font-medium"
                      style={{ backgroundColor: a.cor + "25", color: a.cor }}
                    >
                      {a.nome}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit form */}
      <form
        onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
        className="space-y-5"
      >
        {/* Dados pessoais */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <User className="h-3.5 w-3.5" /> Dados pessoais
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="nome">Nome completo</Label>
              <Input id="nome" value={form.nome} onChange={set("nome")} className="mt-1" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="telefone" className="flex items-center gap-1"><Phone className="h-3 w-3" />Telefone</Label>
                <Input id="telefone" value={form.telefone} onChange={setMasked("telefone", maskPhone)} className="mt-1" placeholder="(00) 00000-0000" inputMode="numeric" />
              </div>
              <div>
                <Label htmlFor="data_nascimento">Nascimento</Label>
                <Input id="data_nascimento" type="date" value={form.data_nascimento} onChange={set("data_nascimento")} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cpf">CPF</Label>
                <Input id="cpf" value={form.cpf} onChange={setMasked("cpf", maskCpf)} className="mt-1" placeholder="000.000.000-00" inputMode="numeric" />
              </div>
              <div>
                <Label htmlFor="rg">RG</Label>
                <Input id="rg" value={form.rg} onChange={set("rg")} className="mt-1" placeholder="00.000.000-0" inputMode="numeric" />
              </div>
            </div>
          </div>
        </section>

        {/* Filiação */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Filiação
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="nome_pai">Nome do pai</Label>
              <Input id="nome_pai" value={form.nome_pai} onChange={set("nome_pai")} className="mt-1" placeholder="Nome completo do pai" />
            </div>
            <div>
              <Label htmlFor="nome_mae">Nome da mãe</Label>
              <Input id="nome_mae" value={form.nome_mae} onChange={set("nome_mae")} className="mt-1" placeholder="Nome completo da mãe" />
            </div>
          </div>
        </section>

        {/* Endereço */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Endereço
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="endereco">Endereço</Label>
              <Input id="endereco" value={form.endereco} onChange={set("endereco")} className="mt-1" placeholder="Rua, número, complemento" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" value={form.cidade} onChange={set("cidade")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cep">CEP</Label>
                <Input id="cep" value={form.cep} onChange={setMasked("cep", maskCep)} className="mt-1" placeholder="00000-000" inputMode="numeric" />
              </div>
            </div>
          </div>
        </section>

        {/* Emergência */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" /> Contato de emergência
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nome_emergencia">Nome</Label>
              <Input id="nome_emergencia" value={form.nome_emergencia} onChange={set("nome_emergencia")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="telefone_emergencia">Telefone</Label>
              <Input id="telefone_emergencia" value={form.telefone_emergencia} onChange={setMasked("telefone_emergencia", maskPhone)} className="mt-1" placeholder="(00) 00000-0000" inputMode="numeric" />
            </div>
          </div>
        </section>

        {/* Observações */}
        <section>
          <Label htmlFor="observacoes">Observações</Label>
          <Textarea
            id="observacoes"
            value={form.observacoes}
            onChange={set("observacoes")}
            className="mt-1"
            rows={3}
            placeholder="Informações adicionais…"
          />
        </section>

        <Button type="submit" disabled={saveMutation.isPending} className="w-full">
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar alterações
        </Button>
      </form>

      {/* ── Notificações push ── */}
      <MembroPushSection paroquiaId={membro?.paroquia_id} />

      {/* ── Consentimento WhatsApp ── */}
      <MembroWhatsAppSection membroId={membro?.id} telefoneExistente={membro?.telefone} />

      {/* ── Segurança ── */}
      <div className="mt-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" /> Segurança
          </p>
          <MfaSetup />
        </div>
      </div>
    </div>
  );
}
