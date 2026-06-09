import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, CheckCircle2, Clock, ChevronRight, Church, MapPin, User, Phone, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/cadastro")({
  component: CadastroPage,
  head: () => ({ meta: [{ title: "Solicitar cadastro — Lumen Pastoral" }] }),
});

const ESTADOS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

type FormState = {
  nome_paroquia: string;
  diocese: string;
  cidade: string;
  estado: string;
  responsavel: string;
  telefone: string;
  email: string;
  mensagem: string;
};

const EMPTY: FormState = {
  nome_paroquia: "", diocese: "", cidade: "", estado: "",
  responsavel: "", telefone: "", email: "", mensagem: "",
};

type Step = "form" | "success";

function CadastroPage() {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [protocoloId, setProtocoloId] = useState("");

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  const canSubmit =
    form.nome_paroquia.trim().length >= 3 &&
    form.diocese.trim().length >= 3 &&
    form.cidade.trim().length >= 2 &&
    form.estado.length === 2 &&
    form.responsavel.trim().length >= 3 &&
    form.telefone.trim().length >= 8 &&
    form.email.trim().includes("@");

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    try {
      const { data, error } = await anyDb
        .from("solicitacoes_paroquia")
        .insert({
          nome_paroquia: form.nome_paroquia.trim(),
          diocese:       form.diocese.trim(),
          cidade:        form.cidade.trim(),
          estado:        form.estado,
          responsavel:   form.responsavel.trim(),
          telefone:      form.telefone.trim(),
          email:         form.email.trim().toLowerCase(),
          mensagem:      form.mensagem.trim() || null,
          status:        "pendente",
        })
        .select("id")
        .single();

      if (error) {
        // Verifica se é duplicata (índice único pendente/em_analise)
        if (error.code === "23505") {
          toast.error("Já existe uma solicitação em análise para este e-mail.");
        } else {
          toast.error("Erro ao enviar solicitação: " + error.message);
        }
        setLoading(false);
        return;
      }

      setProtocoloId(data.id.slice(0, 8).toUpperCase());
      setStep("success");
    } catch (err) {
      toast.error("Erro inesperado: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-5 py-12">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 mb-10">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Flame className="h-4 w-4" />
          </div>
          <span className="font-serif text-xl">Lumen Pastoral</span>
        </Link>

        {step === "success" ? (
          <SuccessView protocoloId={protocoloId} email={form.email} />
        ) : (
          <FormView
            form={form}
            loading={loading}
            canSubmit={canSubmit}
            set={set}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

// ── Formulário de solicitação ─────────────────────────────────────────────────

function FormView({
  form, loading, canSubmit, set, onSubmit,
}: {
  form: FormState;
  loading: boolean;
  canSubmit: boolean;
  set: (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onSubmit: (e: { preventDefault(): void }) => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl">Solicitar cadastro</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Preencha os dados da sua paróquia. Nossa equipe irá analisar a solicitação e entrar em contato.
        </p>
      </div>

      {/* Indicador de etapas */}
      <div className="flex items-center gap-2 mb-8 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 text-primary font-medium">
          <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
          Dados da paróquia
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className="flex items-center gap-1">
          <span className="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">2</span>
          Análise
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className="flex items-center gap-1">
          <span className="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">3</span>
          Acesso liberado
        </span>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">

        {/* Dados da paróquia */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Church className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dados da paróquia</p>
          </div>

          <Field label="Nome da paróquia *">
            <input
              required
              value={form.nome_paroquia}
              onChange={set("nome_paroquia")}
              className="input"
              placeholder="Paróquia de Nossa Senhora das Graças"
            />
          </Field>

          <Field label="Diocese *">
            <input
              required
              value={form.diocese}
              onChange={set("diocese")}
              className="input"
              placeholder="Diocese de São Paulo"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cidade *">
              <input
                required
                value={form.cidade}
                onChange={set("cidade")}
                className="input"
                placeholder="São Paulo"
              />
            </Field>
            <Field label="Estado *">
              <select
                required
                value={form.estado}
                onChange={set("estado")}
                className="input"
              >
                <option value="">UF</option>
                {ESTADOS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* Dados do responsável */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <User className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsável</p>
          </div>

          <Field label="Nome do responsável *">
            <input
              required
              value={form.responsavel}
              onChange={set("responsavel")}
              className="input"
              placeholder="Pe. João da Silva"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Telefone / WhatsApp *">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  required
                  type="tel"
                  value={form.telefone}
                  onChange={set("telefone")}
                  className="input pl-9"
                  placeholder="(11) 99999-9999"
                />
              </div>
            </Field>
            <Field label="E-mail *">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  className="input pl-9"
                  placeholder="paroquia@diocese.org.br"
                />
              </div>
            </Field>
          </div>
        </div>

        {/* Mensagem opcional */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mensagem (opcional)</p>
          </div>
          <textarea
            value={form.mensagem}
            onChange={set("mensagem")}
            rows={3}
            placeholder="Informações adicionais sobre sua paróquia ou necessidades específicas…"
            className="input resize-none leading-relaxed"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="w-full flex justify-center items-center gap-2 rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-50 transition"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar solicitação
        </button>

        <p className="text-center text-sm text-muted-foreground">
          Já tem acesso?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">Entrar</Link>
        </p>
      </form>

      <style>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid hsl(var(--input));
          background: hsl(var(--background));
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
          line-height: 1.5;
          outline: none;
          transition: border-color 0.15s;
        }
        .input:focus {
          border-color: hsl(var(--ring));
          box-shadow: 0 0 0 3px color-mix(in oklab, hsl(var(--ring)) 18%, transparent);
        }
        select.input { appearance: auto; }
      `}</style>
    </div>
  );
}

// ── Tela de confirmação ───────────────────────────────────────────────────────

function SuccessView({ protocoloId, email }: { protocoloId: string; email: string }) {
  return (
    <div className="text-center py-8">
      <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 mb-6">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
      </div>

      <h1 className="font-serif text-3xl text-foreground">Solicitação enviada!</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
        Recebemos sua solicitação de cadastro. Nossa equipe irá analisar os dados e entrar em contato pelo e-mail <strong>{email}</strong>.
      </p>

      {/* Protocolo */}
      <div className="mt-8 inline-flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-8 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Protocolo</p>
        <p className="font-mono text-2xl font-bold text-foreground tracking-widest">{protocoloId}</p>
        <p className="text-xs text-muted-foreground">Guarde este número para consultas</p>
      </div>

      {/* Etapas */}
      <div className="mt-8 space-y-3 text-left max-w-sm mx-auto">
        {[
          { icon: CheckCircle2, label: "Solicitação recebida", desc: "Dados enviados com sucesso", done: true, color: "text-green-500 bg-green-500/10" },
          { icon: Clock, label: "Em análise", desc: "Nossa equipe irá revisar em até 48h úteis", done: false, color: "text-amber-600 bg-amber-500/10" },
          { icon: Flame, label: "Acesso liberado", desc: "Você receberá as credenciais por e-mail", done: false, color: "text-muted-foreground bg-muted" },
        ].map((s, i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${s.color}`}>
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <p className={`text-sm font-semibold ${s.done ? "text-foreground" : "text-foreground/60"}`}>{s.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Já tem acesso?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">Entrar</Link>
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
