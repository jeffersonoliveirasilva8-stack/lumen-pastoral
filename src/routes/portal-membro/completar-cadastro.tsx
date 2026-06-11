import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Phone, Calendar, User, MapPin, Users,
  Clock, CheckCircle2, ChevronRight, ChevronLeft, Flame,
  AlertCircle,
} from "lucide-react";
import { useMembroAuth } from "@/hooks/use-membro-auth";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/portal-membro/completar-cadastro")({
  component: CompletarCadastroPage,
  head: () => ({ meta: [{ title: "Completar Cadastro — Portal do Servidor" }] }),
});

type ComunidadeOpt = { id: string; nome: string };
type AtuacaoOpt   = { id: string; nome: string; cor: string };
type MissaOpt     = { id: string; nome: string; dia_semana: number; hora_inicio: string };

const DIAS = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];


const STEP_LABELS = [
  "Dados Pessoais",
  "Dados Pastorais",
  "Disponibilidade",
  "Confirmar",
] as const;

function CompletarCadastroPage() {
  const { membro, loading: membroLoading } = useMembroAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);

  // ── Etapa 1 ───────────────────────────────────────────────────────────────
  const [telefone,  setTelefone]  = useState("");
  const [dataNasc,  setDataNasc]  = useState("");
  const [sexo,      setSexo]      = useState<"M" | "F" | "">("");

  // ── Etapa 2 ───────────────────────────────────────────────────────────────
  const [comunidadeId, setComunidadeId] = useState("");
  const [atuacaoIds,   setAtuacaoIds]   = useState<string[]>([]);

  // ── Etapa 3 ───────────────────────────────────────────────────────────────
  const [disponibilidade,   setDisponibilidade]   = useState<"todos" | "restricoes" | "">("");
  const [missaRestricaoIds, setMissaRestricaoIds] = useState<string[]>([]);
  const [motivoRestricao,   setMotivoRestricao]   = useState("");

  // ── Carga inicial de dados existentes ─────────────────────────────────────
  const { data: extra, isLoading: loadingExtra } = useQuery({
    queryKey: ["completar-extra", membro?.id],
    enabled:  !!membro?.id,
    staleTime: 0,
    queryFn: async () => {
      // Carrega dados atuais do membro para pré-popular o formulário
      const { data: membroDb } = await anyDb
        .from("membros")
        .select("auth_user_id, paroquia_id, sexo, comunidade_id, telefone, data_nascimento, motivo_disponibilidade")
        .eq("id", membro!.id)
        .maybeSingle();

      const [atuacoesRes, restricoesRes] = await Promise.all([
        anyDb
          .from("membro_atuacoes")
          .select("atuacao_id")
          .eq("membro_id", membro!.id),
        anyDb
          .from("membro_missa_restricoes")
          .select("missa_padrao_id")
          .eq("membro_id", membro!.id),
      ]);

      return {
        telefone:              (membroDb?.telefone              ?? "") as string,
        data_nascimento:       (membroDb?.data_nascimento       ?? "") as string,
        sexo:                  (membroDb?.sexo                  ?? "") as "M" | "F" | "",
        comunidade_id:         (membroDb?.comunidade_id         ?? "") as string,
        motivo_disponibilidade:(membroDb?.motivo_disponibilidade ?? "") as string,
        atuacao_ids:           (atuacoesRes.data ?? []).map((a: { atuacao_id: string }) => a.atuacao_id) as string[],
        restricao_ids:         (restricoesRes.data ?? []).map((r: { missa_padrao_id: string }) => r.missa_padrao_id) as string[],
      };
    },
  });

  // Pre-popula o formulário ao carregar dados existentes (React Query v5: sem onSuccess)
  const [populated, setPopulated] = useState(false);
  useEffect(() => {
    if (!extra || populated) return;
    setPopulated(true);
    setTelefone(membro?.telefone ?? extra.telefone ?? "");
    setDataNasc(membro?.data_nascimento ?? extra.data_nascimento ?? "");
    setSexo(extra.sexo ?? "");
    setComunidadeId(extra.comunidade_id ?? "");
    setAtuacaoIds(extra.atuacao_ids ?? []);
    if (extra.restricao_ids.length > 0) {
      setDisponibilidade("restricoes");
      setMissaRestricaoIds(extra.restricao_ids);
    }
    if (extra.motivo_disponibilidade) setMotivoRestricao(extra.motivo_disponibilidade);
  }, [extra, membro, populated]);

  // ── Opções de seletores ────────────────────────────────────────────────────
  const { data: comunidades = [] } = useQuery<ComunidadeOpt[]>({
    queryKey: ["completar-comunidades", membro?.paroquia_id],
    enabled:  !!membro?.paroquia_id,
    queryFn:  async () => {
      const { data, error } = await anyDb
        .from("comunidades")
        .select("id, nome")
        .eq("paroquia_id", membro!.paroquia_id)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: atuacoes = [] } = useQuery<AtuacaoOpt[]>({
    queryKey: ["completar-atuacoes", membro?.paroquia_id],
    enabled:  !!membro?.paroquia_id,
    queryFn:  async () => {
      const { data, error } = await anyDb
        .from("atuacoes_pastorais")
        .select("id, nome, cor")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: missas = [], isLoading: loadingMissas } = useQuery<MissaOpt[]>({
    queryKey: ["completar-missas", membro?.paroquia_id],
    enabled:  !!membro?.paroquia_id,
    queryFn:  async () => {
      const { data, error } = await anyDb
        .from("missas_padrao")
        .select("id, nome, dia_semana, hora_inicio")
        .eq("paroquia_id", membro!.paroquia_id)
        .eq("ativo", true)
        .order("dia_semana", { ascending: true })
        .order("hora_inicio", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Missas agrupadas por dia da semana
  const missasPorDia = useMemo(() => {
    const grouped: Record<number, MissaOpt[]> = {};
    missas.forEach((m) => {
      if (!grouped[m.dia_semana]) grouped[m.dia_semana] = [];
      grouped[m.dia_semana].push(m);
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([dia, list]) => ({ dia: Number(dia), list }));
  }, [missas]);

  function toggleAtuacao(id: string) {
    setAtuacaoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleMissaRestricao(id: string) {
    setMissaRestricaoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Validações por etapa ───────────────────────────────────────────────────
  function validarEtapa1(): boolean {
    if (!telefone.trim()) { toast.error("Telefone é obrigatório."); return false; }
    if (!dataNasc)        { toast.error("Data de nascimento é obrigatória."); return false; }
    if (!sexo)            { toast.error("Selecione o sexo."); return false; }
    return true;
  }

  function validarEtapa2(): boolean {
    if (!comunidadeId && comunidades.length > 0) {
      toast.error("Selecione a comunidade."); return false;
    }
    if (atuacaoIds.length === 0 && atuacoes.length > 0) {
      toast.error("Selecione ao menos uma atuação pastoral."); return false;
    }
    return true;
  }

  function validarEtapa3(): boolean {
    if (missas.length === 0) return true;
    if (!disponibilidade) {
      toast.error("Informe sua disponibilidade de horários."); return false;
    }
    if (disponibilidade === "restricoes") {
      if (missaRestricaoIds.length === 0) {
        toast.error("Selecione ao menos um horário com restrição."); return false;
      }
      if (!motivoRestricao.trim()) {
        toast.error("Informe o motivo da indisponibilidade."); return false;
      }
    }
    return true;
  }

  function avancar() {
    if (step === 1 && !validarEtapa1()) return;
    if (step === 2 && !validarEtapa2()) return;
    if (step === 3 && !validarEtapa3()) return;
    if (step < 4) setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
  }

  function voltar() {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  }

  // ── Salvar via RPC SECURITY DEFINER ───────────────────────────────────────
  async function handleConfirmar() {
    setSaving(true);
    try {
      const { data: result, error } = await anyDb.rpc("completar_perfil_membro", {
        p_telefone:               telefone.trim() || null,
        p_data_nascimento:        dataNasc        || null,
        p_sexo:                   sexo            || null,
        p_comunidade_id:          comunidadeId    || null,
        p_atuacao_ids:            atuacaoIds,
        p_missa_restricao_ids:    disponibilidade === "restricoes" ? missaRestricaoIds : [],
        p_motivo_disponibilidade: disponibilidade === "restricoes" ? (motivoRestricao || null) : null,
      });

      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error ?? "Erro ao salvar perfil.");

      qc.invalidateQueries({ queryKey: ["profile-completeness"] });
      qc.invalidateQueries({ queryKey: ["completar-extra"] });
      qc.invalidateQueries({ queryKey: ["completar-atuacoes"] });

      toast.success("Cadastro completado! Bem-vindo ao portal.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal-membro/home" } as any);
    } catch (e: unknown) {
      toast.error("Erro ao salvar: " + ((e as Error).message ?? "Tente novamente."));
    } finally {
      setSaving(false);
    }
  }

  // ── Spinner enquanto carrega ───────────────────────────────────────────────
  if (membroLoading || !membro || loadingExtra) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Carregando seu cadastro…</p>
      </div>
    );
  }

  // ── Diagnóstico visível quando comunidades/atuações estão vazias ──────────
  const showDiagnostic = !loadingExtra && (comunidades.length === 0 || atuacoes.length === 0) && step === 2;

  // ── Indicador de progresso ─────────────────────────────────────────────────
  function StepIndicator() {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-1 mb-3">
          {([1, 2, 3, 4] as const).map((s) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div
                className={`h-2 flex-1 rounded-full transition-all duration-300 ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Etapa {step} de 4</span>
          {" — "}
          {STEP_LABELS[step - 1]}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto pb-28">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 mb-5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-white shadow-sm">
          <Flame className="h-3.5 w-3.5" />
        </div>
        <div>
          <h1 className="font-serif text-xl leading-tight">Completar Cadastro</h1>
          <p className="text-xs text-muted-foreground">
            Olá, {membro.nome.split(" ")[0]}! Preencha as informações abaixo.
          </p>
        </div>
      </div>

      <StepIndicator />

      {/* ── ETAPA 1: Dados Pessoais ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground -mt-1">
            Dados básicos necessários para o Motor de Escalas identificar e
            contatar você corretamente.
          </p>

          {/* Telefone */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <Phone className="h-3 w-3" /> Telefone / WhatsApp *
            </label>
            <input
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(00) 00000-0000"
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Data de nascimento */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <Calendar className="h-3 w-3" /> Data de nascimento *
            </label>
            <input
              type="date"
              value={dataNasc}
              onChange={(e) => setDataNasc(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Sexo */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <User className="h-3 w-3" /> Sexo *
            </label>
            <div className="flex gap-3">
              {(["M", "F"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSexo(v)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition ${
                    sexo === v
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {v === "M" ? "Masculino" : "Feminino"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ETAPA 2: Dados Pastorais ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground -mt-1">
            Informe sua comunidade e atuação pastoral para que o sistema
            possa incluí-lo nas escalas corretas.
          </p>

          {/* Painel de diagnóstico de sincronização */}
          {showDiagnostic && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 px-4 py-3 text-xs space-y-1">
              <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                Dados da paróquia não carregados
              </div>
              <p className="text-amber-700/80 dark:text-amber-400/80">
                paroquia_id: <span className="font-mono">{membro.paroquia_id}</span>
              </p>
              <p className="text-amber-700/80 dark:text-amber-400/80">
                Verifique o console do navegador para diagnóstico completo.
              </p>
              <p className="text-amber-600/70 dark:text-amber-500/70 mt-1">
                Se o problema persistir após recarregar a página, entre em contato com o coordenador para verificar as policies de acesso.
              </p>
            </div>
          )}

          {/* Comunidade */}
          {comunidades.length > 0 ? (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <MapPin className="h-3 w-3" /> Comunidade *
              </label>
              <select
                value={comunidadeId}
                onChange={(e) => setComunidadeId(e.target.value)}
                className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 appearance-none"
              >
                <option value="">Selecione a comunidade…</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Nenhuma comunidade cadastrada para esta paróquia ainda.
            </div>
          )}

          {/* Atuação pastoral */}
          {atuacoes.length > 0 ? (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <Users className="h-3 w-3" /> Atuação Pastoral *
              </label>
              <p className="text-xs text-muted-foreground mb-2.5">
                Selecione ao menos uma função que você exerce na pastoral.
              </p>
              <div className="flex flex-wrap gap-2">
                {atuacoes.map((a) => {
                  const sel = atuacaoIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAtuacao(a.id)}
                      className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition ${
                        sel
                          ? "text-white border-transparent"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                      style={sel ? { backgroundColor: a.cor, borderColor: a.cor } : {}}
                    >
                      {sel && <CheckCircle2 className="h-3 w-3" />}
                      {a.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Nenhuma atuação pastoral cadastrada para esta paróquia ainda.
            </div>
          )}
        </div>
      )}

      {/* ── ETAPA 3: Disponibilidade ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground -mt-1">
            Informe sua disponibilidade para servir nas missas. Isso ajuda o
            Motor de Escalas a não atribuí-lo a horários que você não pode cumprir.
          </p>

          {missas.length === 0 && !loadingMissas ? (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-4 text-sm text-center text-muted-foreground">
              <Clock className="h-5 w-5 mx-auto mb-2 opacity-40" />
              Sua paróquia ainda não cadastrou horários de missa.
              <br />
              Você pode informar sua disponibilidade depois, no seu perfil.
            </div>
          ) : loadingMissas ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Radio de disponibilidade */}
              <div className="space-y-2.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" /> Disponibilidade *
                </label>

                {(["todos", "restricoes"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setDisponibilidade(opt);
                      if (opt === "todos") {
                        setMissaRestricaoIds([]);
                        setMotivoRestricao("");
                      }
                    }}
                    className={`w-full text-left rounded-xl border px-4 py-3.5 transition ${
                      disponibilidade === opt
                        ? "border-primary bg-primary/8 text-primary"
                        : "border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        disponibilidade === opt ? "border-primary" : "border-muted-foreground/40"
                      }`}>
                        {disponibilidade === opt && (
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {opt === "todos"
                            ? "Disponível para todos os horários"
                            : "Possuo restrições de horário"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {opt === "todos"
                            ? "Posso ser escalado(a) em qualquer horário de missa."
                            : "Há horários específicos em que não consigo servir."}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Campos de restrição (apenas quando "restricoes") */}
              {disponibilidade === "restricoes" && (
                <div className="space-y-4">
                  {/* Motivo da indisponibilidade — obrigatório */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      <AlertCircle className="h-3 w-3" /> Motivo da indisponibilidade *
                    </label>
                    <textarea
                      value={motivoRestricao}
                      onChange={(e) => setMotivoRestricao(e.target.value)}
                      placeholder="Ex: trabalho às segundas, faculdade nos sábados de manhã, cuido dos filhos nos domingos..."
                      rows={3}
                      className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 resize-none placeholder:text-muted-foreground/60"
                    />
                    {!motivoRestricao.trim() && (
                      <p className="text-xs text-destructive/70 mt-1.5">
                        Descreva o motivo para continuar.
                      </p>
                    )}
                  </div>

                  {/* Grid de missas */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Selecione os horários em que <strong className="text-destructive">NÃO</strong> pode servir:
                    </p>
                    <div className="space-y-4">
                      {missasPorDia.map(({ dia, list }) => (
                        <div key={dia}>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                            {DIAS[dia]}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {list.map((m) => {
                              const sel = missaRestricaoIds.includes(m.id);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => toggleMissaRestricao(m.id)}
                                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                                    sel
                                      ? "border-destructive bg-destructive/10 text-destructive"
                                      : "border-border text-muted-foreground hover:bg-muted"
                                  }`}
                                >
                                  {sel && <CheckCircle2 className="h-3 w-3" />}
                                  {m.hora_inicio.slice(0, 5)}
                                  {m.nome && m.nome !== m.hora_inicio && (
                                    <span className="text-[10px] opacity-70 ml-1">
                                      {m.nome.length > 20 ? m.nome.slice(0, 20) + "…" : m.nome}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {missaRestricaoIds.length > 0 && (
                      <p className="mt-3 text-xs text-destructive font-medium">
                        {missaRestricaoIds.length} horário{missaRestricaoIds.length !== 1 ? "s" : ""} com restrição selecionado{missaRestricaoIds.length !== 1 ? "s" : ""}.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ETAPA 4: Resumo ──────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground -mt-1">
            Confira seus dados antes de confirmar. Você poderá editá-los depois
            no seu perfil.
          </p>

          {/* Card: Dados pessoais */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Dados Pessoais
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">Nome</p>
                <p className="font-medium">{membro.nome}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Telefone</p>
                <p className="font-medium">{telefone || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Nascimento</p>
                <p className="font-medium">
                  {dataNasc
                    ? new Date(dataNasc + "T00:00:00").toLocaleDateString("pt-BR")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Sexo</p>
                <p className="font-medium">
                  {sexo === "M" ? "Masculino" : sexo === "F" ? "Feminino" : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Card: Dados pastorais */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Dados Pastorais
            </p>
            <div className="text-sm space-y-2">
              <div>
                <p className="text-[11px] text-muted-foreground">Comunidade</p>
                <p className="font-medium">
                  {comunidades.find((c) => c.id === comunidadeId)?.nome ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Atuações pastorais</p>
                {atuacaoIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {atuacaoIds.map((id) => {
                      const a = atuacoes.find((x) => x.id === id);
                      return a ? (
                        <span
                          key={id}
                          className="text-xs px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: a.cor }}
                        >
                          {a.nome}
                        </span>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <p className="font-medium">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Card: Disponibilidade */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Disponibilidade
            </p>
            <div className="text-sm">
              {!disponibilidade || missas.length === 0 ? (
                <p className="font-medium text-muted-foreground">Não informada</p>
              ) : disponibilidade === "todos" ? (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-medium">Disponível para todos os horários</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Motivo: {motivoRestricao || "—"}
                    </p>
                  </div>
                  <p className="text-destructive font-medium">
                    {missaRestricaoIds.length} restrição{missaRestricaoIds.length !== 1 ? "ões" : ""} de horário
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {missaRestricaoIds.map((id) => {
                      const m = missas.find((x) => x.id === id);
                      return m ? (
                        <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                          {DIAS[m.dia_semana]} {m.hora_inicio.slice(0, 5)}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            disabled={saving}
            onClick={handleConfirmar}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60 transition"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {saving ? "Salvando…" : "Confirmar e finalizar"}
          </button>
        </div>
      )}

      {/* ── Navegação entre etapas ───────────────────────────────────────────── */}
      {step < 4 && (
        <div className={`flex gap-3 mt-8 ${step > 1 ? "justify-between" : "justify-end"}`}>
          {step > 1 && (
            <button
              type="button"
              onClick={voltar}
              className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition"
            >
              <ChevronLeft className="h-4 w-4" /> Voltar
            </button>
          )}
          <button
            type="button"
            onClick={avancar}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 transition ml-auto"
          >
            {step === 3 ? "Revisar" : "Avançar"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Voltar no resumo */}
      {step === 4 && (
        <button
          type="button"
          onClick={voltar}
          className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition"
        >
          <ChevronLeft className="h-4 w-4" /> Editar dados
        </button>
      )}
    </div>
  );
}
