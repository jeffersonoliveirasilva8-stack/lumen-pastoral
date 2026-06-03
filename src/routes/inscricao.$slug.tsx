import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles, Loader2, CheckCircle2, ChevronRight, ChevronLeft,
  Upload, X, User, Church, Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/inscricao/$slug")({
  component: InscricaoPage,
  head: () => ({ meta: [{ title: "Inscrição — Pastoral" }] }),
});

const INPUT_CLS =
  "mt-1.5 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground";

const SELECT_CLS =
  "mt-1.5 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 appearance-none";


const MESES = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const ANO_ATUAL = new Date().getFullYear();
const ANOS = Array.from({ length: ANO_ATUAL - 1989 }, (_, i) => ANO_ATUAL - i);

type Paroquia = { id: string; nome: string; diocese: string | null };
type ComunidadeOpt = { id: string; nome: string };
type AtuacaoOpt = { id: string; nome: string; cor: string };

type MissaPadraoOpt = {
  id: string;
  nome: string;
  hora_inicio: string | null;
  dia_semana: number;
  recorrencia: { tipo: string } | null;
};

type FormData = {
  nome: string;
  email: string;
  telefone: string;
  sexo: string;
  data_nascimento: string;
  cpf: string;
  rg: string;
  endereco: string;
  bairro: string;
  cidade: string;
  comunidade_id: string;
  comunidade_nome: string;
  atuacao_ids: string[];
  atuacao_nomes: string[];
  ingresso_mes: string;
  ingresso_ano: string;
  missas_nao_pode_ids: string[];   // IDs de missas_padrao que não consegue servir
  motivo_indisponibilidade: string; // Obrigatório quando alguma missa é selecionada
  nome_mae: string;
  contato_mae: string;
  nome_pai: string;
  contato_pai: string;
  possui_conducao: string;
  observacoes: string;
};

const DIAS_SEMANA_PT = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

const RECORRENCIA_LABELS: Record<string, string> = {
  quinzenal:     "Quinzenal",
  quinzenal_1_3: "1ª e 3ª sem.",
  quinzenal_2_4: "2ª e 4ª sem.",
  mensal_1:      "1ª semana",
  mensal_2:      "2ª semana",
  mensal_3:      "3ª semana",
  mensal_4:      "4ª semana",
  mensal_ultimo: "Últ. semana",
  esporadico:    "Específico",
};

const FORM_INICIAL: FormData = {
  nome: "", email: "", telefone: "", sexo: "",
  data_nascimento: "", cpf: "", rg: "",
  endereco: "", bairro: "", cidade: "",
  comunidade_id: "", comunidade_nome: "",
  atuacao_ids: [], atuacao_nomes: [],
  ingresso_mes: "", ingresso_ano: "",
  missas_nao_pode_ids: [], motivo_indisponibilidade: "",
  nome_mae: "", contato_mae: "", nome_pai: "", contato_pai: "",
  possui_conducao: "", observacoes: "",
};

function InscricaoPage() {
  const { slug } = Route.useParams();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(FORM_INICIAL);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Busca paróquia ────────────────────────────────────────────────────
  const { data: paroquia, isLoading, isError } = useQuery<Paroquia | null>({
    queryKey: ["inscricao-paroquia", slug],
    retry: false,
    queryFn: async () => {
      const { data: bySlug } = await anyDb
        .from("paroquias")
        .select("id, nome, diocese")
        .eq("slug", slug)
        .maybeSingle();
      if (bySlug) return bySlug;

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRe.test(slug)) {
        const { data: byId } = await anyDb
          .from("paroquias")
          .select("id, nome, diocese")
          .eq("id", slug)
          .maybeSingle();
        return byId ?? null;
      }
      return null;
    },
  });

  // ── Comunidades da paróquia ───────────────────────────────────────────
  const { data: comunidades = [] } = useQuery<ComunidadeOpt[]>({
    queryKey: ["inscricao-comunidades", paroquia?.id],
    enabled: !!paroquia?.id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("comunidades")
        .select("id, nome")
        .eq("paroquia_id", paroquia!.id)
        .order("nome");
      return data ?? [];
    },
  });

  // ── Atuações pastorais da paróquia (ex: Acólito, Cerimoniário) ─────────
  const { data: atuacoes = [] } = useQuery<AtuacaoOpt[]>({
    queryKey: ["inscricao-atuacoes", paroquia?.id],
    enabled: !!paroquia?.id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome, cor")
        .eq("paroquia_id", paroquia!.id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      return data ?? [];
    },
  });

  // ── Missas padrão da paróquia ────────────────────────────────────────
  const { data: missasPadrao = [] } = useQuery<MissaPadraoOpt[]>({
    queryKey: ["inscricao-missas-padrao", paroquia?.id],
    enabled: !!paroquia?.id,
    queryFn: async () => {
      const { data } = await anyDb
        .from("missas_padrao")
        .select("id, nome, hora_inicio, dia_semana, recorrencia")
        .eq("paroquia_id", paroquia!.id)
        .eq("ativo", true)
        .order("dia_semana")
        .order("hora_inicio");
      return (data ?? []) as MissaPadraoOpt[];
    },
  });

  // Agrupa missas: por dia → por horário (unifica missas com mesmo horário)
  const missasPorDia = missasPadrao.reduce<Record<number, Record<string, MissaPadraoOpt[]>>>(
    (accDia, m) => {
      const dia = m.dia_semana;
      const hora = m.hora_inicio ?? "—";
      if (!accDia[dia]) accDia[dia] = {};
      if (!accDia[dia][hora]) accDia[dia][hora] = [];
      accDia[dia][hora].push(m);
      return accDia;
    },
    {}
  );

  // ── Helpers ───────────────────────────────────────────────────────────
  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Seleciona/deseleciona um grupo de missas com o mesmo horário no mesmo dia
  function toggleMissaGrupo(ids: string[]) {
    setForm((f) => {
      const todosAtivos = ids.every((id) => f.missas_nao_pode_ids.includes(id));
      return {
        ...f,
        missas_nao_pode_ids: todosAtivos
          ? f.missas_nao_pode_ids.filter((id) => !ids.includes(id))
          : [...new Set([...f.missas_nao_pode_ids, ...ids])],
      };
    });
  }

  function toggleAtuacao(id: string, nome: string) {
    setForm((f) => {
      const jaIncluido = f.atuacao_ids.includes(id);
      return {
        ...f,
        atuacao_ids:   jaIncluido ? f.atuacao_ids.filter((x) => x !== id) : [...f.atuacao_ids, id],
        atuacao_nomes: jaIncluido ? f.atuacao_nomes.filter((n) => n !== nome) : [...f.atuacao_nomes, nome],
      };
    });
  }

  function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Foto muito grande. Máximo: 5 MB."); return; }
    setFoto(file);
    setFotoPreview(URL.createObjectURL(file));
  }

  // ── Validações ────────────────────────────────────────────────────────
  function validarStep1(): boolean {
    if (!form.nome.trim()) { toast.error("Nome completo é obrigatório."); return false; }
    if (!form.email.trim()) { toast.error("E-mail é obrigatório."); return false; }
    if (!form.telefone.trim()) { toast.error("Telefone é obrigatório."); return false; }
    if (!form.sexo) { toast.error("Selecione o sexo."); return false; }
    if (!form.cidade.trim()) { toast.error("Cidade é obrigatória."); return false; }
    return true;
  }

  function validarStep2(): boolean {
    if (form.missas_nao_pode_ids.length > 0 && !form.motivo_indisponibilidade.trim()) {
      toast.error("Informe o motivo para as missas em que não pode servir.");
      return false;
    }
    return true;
  }

  // ── Envio ─────────────────────────────────────────────────────────────
  async function handleEnviar() {
    if (!paroquia) return;
    setSubmitting(true);

    try {
      let foto_url: string | null = null;

      if (foto) {
        const ext = foto.name.split(".").pop() ?? "jpg";
        const path = `solicitacoes/${paroquia.id}/${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage
          .from("membros-fotos")
          .upload(path, foto, { upsert: false });
        if (!upErr && up) {
          const { data: { publicUrl } } = supabase.storage
            .from("membros-fotos")
            .getPublicUrl(up.path);
          foto_url = publicUrl;
        }
      }

      const { error } = await anyDb
        .from("solicitacoes_membros")
        .insert({
          paroquia_id: paroquia.id,
          nome:     form.nome.trim(),
          email:    form.email.trim().toLowerCase() || null,
          telefone: form.telefone.trim() || null,
          dados_json: {
            ...form,
            nome:  form.nome.trim(),
            email: form.email.trim().toLowerCase(),
          },
          foto_url,
        });

      if (error) throw error;
      setSubmitted(true);
    } catch (e: unknown) {
      toast.error("Erro ao enviar: " + ((e as Error).message ?? "tente novamente."));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / Erro / Sucesso ───────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!paroquia || isError) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="text-center max-w-sm">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-5">
            <Sparkles className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="font-serif text-2xl">Link inválido</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Este link de inscrição não é válido ou não existe.
            Solicite um novo link à coordenação da sua paróquia.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="font-serif text-3xl">Inscrição enviada!</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Sua solicitação foi recebida pela coordenação de{" "}
            <strong>{paroquia.nome}</strong>. Aguarde a aprovação.
          </p>
          <div className="mt-6 rounded-2xl border border-border bg-card px-4 py-4 text-left space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Próximos passos
            </p>
            {["A coordenação analisará sua solicitação.",
              "Após aprovação, você receberá um link de acesso por e-mail.",
              "Clique no link para acessar o Portal do Servidor."].map((txt, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold mt-0.5">
                  {i + 1}
                </span>
                <span>{txt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Formulário ─────────────────────────────────────────────────────────
  const STEPS = [
    { icon: User,   label: "Dados Pessoais" },
    { icon: Church, label: "Dados Pastorais" },
    { icon: Info,   label: "Finalização" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-5 h-16 flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground leading-none">
              Inscrição pastoral
            </p>
            <p className="font-serif text-base leading-tight truncate">{paroquia.nome}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 pb-24">
        {/* Progresso */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const done   = n < step;
            const active = n === step;
            return (
              <div key={n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    done   ? "bg-green-500 text-white" :
                    active ? "bg-primary text-white" :
                             "bg-muted text-muted-foreground"
                  }`}>
                    {done ? "✓" : n}
                  </div>
                  <span className={`text-[10px] font-medium hidden sm:block ${active ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-2 mb-4 sm:mb-5 transition-colors ${done ? "bg-green-500" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── ETAPA 1: Dados Pessoais ── */}
        {step === 1 && (
          <section className="space-y-6">
            <div>
              <h2 className="font-serif text-2xl">Dados Pessoais</h2>
              <p className="text-sm text-muted-foreground mt-1">Preencha seus dados de identificação.</p>
            </div>

            <div className="space-y-4">
              <Campo label="Nome completo *">
                <input
                  type="text" required autoComplete="name"
                  value={form.nome} onChange={(e) => set("nome", e.target.value)}
                  className={INPUT_CLS} placeholder="Seu nome completo"
                />
              </Campo>

              <Campo label="Sexo *">
                <div className="mt-1.5 flex gap-3">
                  {[{ v: "M", label: "Masculino" }, { v: "F", label: "Feminino" }].map(({ v, label }) => (
                    <button
                      key={v} type="button"
                      onClick={() => set("sexo", v)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition ${
                        form.sexo === v
                          ? "bg-primary/10 border-primary text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Campo>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label="E-mail *">
                  <input
                    type="email" required autoComplete="email"
                    value={form.email} onChange={(e) => set("email", e.target.value)}
                    className={INPUT_CLS} placeholder="seu@email.com"
                  />
                </Campo>
                <Campo label="Telefone / WhatsApp *">
                  <input
                    type="tel" required autoComplete="tel"
                    value={form.telefone} onChange={(e) => set("telefone", e.target.value)}
                    className={INPUT_CLS} placeholder="(00) 00000-0000"
                  />
                </Campo>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label="Data de nascimento">
                  <input
                    type="date" value={form.data_nascimento}
                    onChange={(e) => set("data_nascimento", e.target.value)}
                    className={INPUT_CLS}
                  />
                </Campo>
                <Campo label="CPF">
                  <input
                    type="text" value={form.cpf} maxLength={14}
                    onChange={(e) => set("cpf", e.target.value)}
                    className={INPUT_CLS} placeholder="000.000.000-00"
                  />
                </Campo>
              </div>

              <Campo label="RG (opcional)">
                <input
                  type="text" value={form.rg}
                  onChange={(e) => set("rg", e.target.value)}
                  className={INPUT_CLS} placeholder="00.000.000-0"
                />
              </Campo>

              <Campo label="Endereço">
                <input
                  type="text" value={form.endereco} autoComplete="street-address"
                  onChange={(e) => set("endereco", e.target.value)}
                  className={INPUT_CLS} placeholder="Rua, número, complemento"
                />
              </Campo>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label="Bairro">
                  <input
                    type="text" value={form.bairro}
                    onChange={(e) => set("bairro", e.target.value)}
                    className={INPUT_CLS} placeholder="Nome do bairro"
                  />
                </Campo>
                <Campo label="Cidade *">
                  <input
                    type="text" required value={form.cidade} autoComplete="address-level2"
                    onChange={(e) => set("cidade", e.target.value)}
                    className={INPUT_CLS} placeholder="Sua cidade"
                  />
                </Campo>
              </div>
            </div>

            <button
              type="button"
              onClick={() => { if (validarStep1()) setStep(2); }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 transition"
            >
              Próximo <ChevronRight className="h-4 w-4" />
            </button>
          </section>
        )}

        {/* ── ETAPA 2: Dados Pastorais ── */}
        {step === 2 && (
          <section className="space-y-6">
            <div>
              <h2 className="font-serif text-2xl">Dados Pastorais</h2>
              <p className="text-sm text-muted-foreground mt-1">Informações sobre seu serviço na pastoral.</p>
            </div>

            <div className="space-y-4">
              {/* Comunidade */}
              <Campo label="Comunidade que participa">
                {comunidades.length > 0 ? (
                  <select
                    value={form.comunidade_id}
                    onChange={(e) => {
                      const opt = comunidades.find((c) => c.id === e.target.value);
                      set("comunidade_id", e.target.value);
                      set("comunidade_nome", opt?.nome ?? "");
                    }}
                    className={SELECT_CLS}
                  >
                    <option value="">Selecione a comunidade…</option>
                    {comunidades.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text" value={form.comunidade_nome}
                    onChange={(e) => set("comunidade_nome", e.target.value)}
                    className={INPUT_CLS} placeholder="Nome da comunidade"
                  />
                )}
              </Campo>

              {/* Atuação */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Atuação Pastoral
                </label>
                {atuacoes.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {atuacoes.map((a) => (
                      <button
                        key={a.id} type="button"
                        onClick={() => toggleAtuacao(a.id, a.nome)}
                        className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition ${
                          form.atuacao_ids.includes(a.id)
                            ? "text-white border-transparent"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                        style={form.atuacao_ids.includes(a.id) ? { backgroundColor: a.cor, borderColor: a.cor } : {}}
                      >
                        {form.atuacao_ids.includes(a.id) && <span>✓</span>}
                        {a.nome}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground italic">
                    Nenhuma atuação cadastrada pela paróquia ainda.
                  </p>
                )}
              </div>

              {/* Data de ingresso — mês + ano */}
              <Campo label="Data de ingresso na pastoral">
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                  <select
                    value={form.ingresso_mes}
                    onChange={(e) => set("ingresso_mes", e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">Mês</option>
                    {MESES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <select
                    value={form.ingresso_ano}
                    onChange={(e) => set("ingresso_ano", e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">Ano</option>
                    {ANOS.map((a) => (
                      <option key={a} value={String(a)}>{a}</option>
                    ))}
                  </select>
                </div>
              </Campo>
            </div>

            {/* Disponibilidade — Missas Padrão */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Disponibilidade
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Selecione as missas em que <strong>NÃO</strong> consegue servir.
                </p>
              </div>

              {missasPadrao.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  Nenhuma missa padrão cadastrada pela paróquia ainda.
                  A coordenação irá configurar sua disponibilidade após o ingresso.
                </p>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {Object.entries(missasPorDia)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([dia]) => {
                      const horarioMap = missasPorDia[Number(dia)];
                      return (
                        <div key={dia} className="flex items-center gap-3 px-3 py-2.5">
                          {/* Dia da semana */}
                          <span className="text-xs font-semibold text-foreground/70 w-20 shrink-0">
                            {DIAS_SEMANA_PT[Number(dia)]}
                          </span>
                          {/* Horários unificados */}
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(horarioMap)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([hora, grupo]) => {
                                const ids = grupo.map((m) => m.id);
                                const selecionado = ids.every((id) =>
                                  form.missas_nao_pode_ids.includes(id)
                                );
                                return (
                                  <button
                                    key={hora}
                                    type="button"
                                    onClick={() => toggleMissaGrupo(ids)}
                                    className={`h-8 px-3 rounded-full text-xs font-semibold border transition ${
                                      selecionado
                                        ? "bg-destructive/15 border-destructive/40 text-destructive"
                                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                    }`}
                                  >
                                    {hora !== "—" ? hora.slice(0, 5) : "—"}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Motivo — obrigatório quando alguma missa selecionada */}
              {form.missas_nao_pode_ids.length > 0 && (
                <Campo label="Motivo da indisponibilidade *">
                  <textarea
                    rows={2}
                    value={form.motivo_indisponibilidade}
                    onChange={(e) => set("motivo_indisponibilidade", e.target.value)}
                    className={INPUT_CLS + " resize-none"}
                    placeholder="Trabalho, estudos, compromissos familiares…"
                  />
                </Campo>
              )}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted transition">
                <ChevronLeft className="h-4 w-4" /> Voltar
              </button>
              <button type="button" onClick={() => { if (validarStep2()) setStep(3); }}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 transition">
                Próximo <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ── ETAPA 3: Finalização ── */}
        {step === 3 && (
          <section className="space-y-6">
            <div>
              <h2 className="font-serif text-2xl">Finalização</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Informações sobre sua família e foto de perfil.
              </p>
            </div>

            <div className="space-y-4">
              {/* Mãe */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dados da Mãe</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Campo label="Nome da mãe">
                    <input
                      type="text" value={form.nome_mae}
                      onChange={(e) => set("nome_mae", e.target.value)}
                      className={INPUT_CLS} placeholder="Nome completo"
                    />
                  </Campo>
                  <Campo label="Contato da mãe">
                    <input
                      type="tel" value={form.contato_mae}
                      onChange={(e) => set("contato_mae", e.target.value)}
                      className={INPUT_CLS} placeholder="(00) 00000-0000"
                    />
                  </Campo>
                </div>
              </div>

              {/* Pai */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dados do Pai</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Campo label="Nome do pai">
                    <input
                      type="text" value={form.nome_pai}
                      onChange={(e) => set("nome_pai", e.target.value)}
                      className={INPUT_CLS} placeholder="Nome completo"
                    />
                  </Campo>
                  <Campo label="Contato do pai">
                    <input
                      type="tel" value={form.contato_pai}
                      onChange={(e) => set("contato_pai", e.target.value)}
                      className={INPUT_CLS} placeholder="(00) 00000-0000"
                    />
                  </Campo>
                </div>
              </div>

              <Campo label="Possui condução própria?">
                <div className="mt-1.5 flex gap-3">
                  {[{ v: "sim", label: "Sim" }, { v: "nao", label: "Não" }].map(({ v, label }) => (
                    <button key={v} type="button" onClick={() => set("possui_conducao", v)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition ${
                        form.possui_conducao === v
                          ? "bg-primary/10 border-primary text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Campo>

              <Campo label="Observações">
                <textarea
                  rows={3} value={form.observacoes}
                  onChange={(e) => set("observacoes", e.target.value)}
                  className={INPUT_CLS + " resize-none"}
                  placeholder="Informações adicionais para a coordenação…"
                />
              </Campo>

              {/* Foto */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Foto de perfil (opcional)
                </label>
                <div className="mt-1.5">
                  {fotoPreview ? (
                    <div className="flex items-center gap-4">
                      <img src={fotoPreview} alt="Prévia" className="h-20 w-20 rounded-full object-cover border-2 border-border" />
                      <button type="button" onClick={() => { setFoto(null); setFotoPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
                        <X className="h-3.5 w-3.5" /> Remover foto
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="w-full flex items-center gap-3 rounded-xl border border-dashed border-border bg-background/80 px-4 py-4 text-sm text-muted-foreground hover:bg-muted transition">
                      <Upload className="h-5 w-5 shrink-0" />
                      <span>Selecionar foto (máx. 5 MB)</span>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFotoChange} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-semibold mb-1">Antes de enviar</p>
              <p>
                Ao confirmar, suas informações serão encaminhadas à coordenação de{" "}
                <strong>{paroquia.nome}</strong> para análise e aprovação.
              </p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted transition">
                <ChevronLeft className="h-4 w-4" /> Voltar
              </button>
              <button type="button" disabled={submitting} onClick={handleEnviar}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Enviar inscrição
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
