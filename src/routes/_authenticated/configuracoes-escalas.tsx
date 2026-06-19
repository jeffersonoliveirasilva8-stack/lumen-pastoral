import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSetPageTabs } from "@/contexts/page-tabs";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export const Route = createFileRoute("/_authenticated/configuracoes-escalas")({
  component: ConfiguracaoEscalas,
  head: () => ({ meta: [{ title: "Regras da Escala — Lumen Pastoral" }] }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type RegrasEscala = {
  confirmacao_escala_ativa: boolean;
  prioridade_score: boolean;
  impedir_repeticao_consecutiva: boolean;
  permitir_duplicidade: boolean;
  variedade_ministerio: boolean;
  peso_solene: number;
  peso_normal: number;
  limite_semanal: number | null;
  limite_mensal: number | null;
  intervalo_minimo_dias: number | null;
  dias_antecedencia_indisp: number | null;
  distribuicao_masc_pct: number;
};

export type ConfigEscalas = {
  confirmacao_ativa: boolean;
  confirmacao_horas_antes: number;
  substituicao_ativa: boolean;
  substituicao_horas_antes: number;
  auto_pontuar: boolean;
  pontuacao_presenca: number;
  pontuacao_presenca_solene: number;
  pontuacao_presenca_bispo: number;
  pontuacao_falta: number;
  pontuacao_justificou: number;
  pontuacao_atraso: number;
  pontuacao_ocorrencia_grave: number;
  pontuacao_formacao: number;
  pontuacao_reuniao: number;
  pontuacao_retiro: number;
  pontuacao_adoracao: number;
  pontuacao_ensaio: number;
  pontuacao_encontro: number;
  pontuacao_compromisso: number;
  pontuacao_evento: number;
  pontuacao_substituicao_aceita: number;
  pontuacao_substituicao_recusada: number;
};

const DEFAULT_REGRAS: RegrasEscala = {
  confirmacao_escala_ativa: false,
  prioridade_score: true,
  impedir_repeticao_consecutiva: false,
  permitir_duplicidade: false,
  variedade_ministerio: false,
  peso_solene: 2,
  peso_normal: 1,
  limite_semanal: null,
  limite_mensal: null,
  intervalo_minimo_dias: null,
  dias_antecedencia_indisp: 3,
  distribuicao_masc_pct: 50,
};

export const DEFAULTS: ConfigEscalas = {
  confirmacao_ativa: false,
  confirmacao_horas_antes: 72,
  substituicao_ativa: false,
  substituicao_horas_antes: 48,
  auto_pontuar: false,
  pontuacao_presenca: 1,
  pontuacao_presenca_solene: 3,
  pontuacao_presenca_bispo: 5,
  pontuacao_falta: -2,
  pontuacao_justificou: 0,
  pontuacao_atraso: -1,
  pontuacao_ocorrencia_grave: -10,
  pontuacao_formacao: 2,
  pontuacao_reuniao: 1,
  pontuacao_retiro: 5,
  pontuacao_adoracao: 2,
  pontuacao_ensaio: 1,
  pontuacao_encontro: 2,
  pontuacao_compromisso: 2,
  pontuacao_evento: 3,
  pontuacao_substituicao_aceita: 3,
  pontuacao_substituicao_recusada: -1,
};

// ── PRow ──────────────────────────────────────────────────────────────────────

function PRow({ label, color, value, onChange }: {
  label: string; color: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm flex-1 ${color}`}>{label}</span>
      <input
        type="number" min={-99} max={99}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-20 rounded-xl border border-input bg-background px-2 py-1.5 text-sm text-center outline-none focus:border-ring"
      />
      <span className="text-xs text-muted-foreground w-6">pts</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ConfiguracaoEscalas() {
  const { profile } = useAuth();
  const paroquiaId = profile?.paroquia_id ?? null;
  const qc = useQueryClient();

  const [regras, setRegras]   = useState<RegrasEscala>(DEFAULT_REGRAS);
  const [form, setForm]       = useState<ConfigEscalas>(DEFAULTS);
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [reprocessLoading, setReprocessLoading] = useState(false);
  const [recalcLoading, setRecalcLoading]       = useState(false);

  const { data: paroquia } = useQuery({
    queryKey: ["paroquia-regras-escala", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data } = await anyDb
        .from("paroquias")
        .select("id, regras_escala")
        .eq("id", paroquiaId)
        .maybeSingle();
      return data;
    },
  });

  const { data: configDb, isLoading } = useQuery<ConfigEscalas>({
    queryKey: ["config-escalas", paroquiaId],
    enabled: !!paroquiaId,
    queryFn: async () => {
      const { data, error } = await anyDb
        .from("paroquia_config_escalas")
        .select("*")
        .eq("paroquia_id", paroquiaId)
        .maybeSingle();
      if (error) throw error;
      return data ?? DEFAULTS;
    },
  });

  useEffect(() => {
    if (paroquia?.regras_escala) {
      setRegras({ ...DEFAULT_REGRAS, ...paroquia.regras_escala });
    }
  }, [paroquia]);

  useEffect(() => {
    if (configDb) {
      setForm({ ...DEFAULTS, ...configDb });
      setDirty(false);
    }
  }, [configDb]);

  function r<K extends keyof RegrasEscala>(key: K, value: RegrasEscala[K]) {
    setRegras((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function c<K extends keyof ConfigEscalas>(key: K, value: ConfigEscalas[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "confirmacao_ativa") {
      setRegras((prev) => ({ ...prev, confirmacao_escala_ativa: value as boolean }));
    }
    setDirty(true);
  }

  async function save() {
    if (!paroquiaId) return;
    setSaving(true);

    const { error: e1 } = await supabase
      .from("paroquias")
      .update({ regras_escala: { ...regras, confirmacao_escala_ativa: form.confirmacao_ativa } })
      .eq("id", paroquiaId);

    if (e1) { setSaving(false); toast.error("Erro ao salvar regras: " + e1.message); return; }

    const { error: e2 } = await anyDb
      .from("paroquia_config_escalas")
      .upsert({ paroquia_id: paroquiaId, ...form }, { onConflict: "paroquia_id" });

    setSaving(false);
    if (e2) { toast.error("Erro ao salvar configurações: " + e2.message); return; }

    qc.invalidateQueries({ queryKey: ["config-escalas", paroquiaId] });
    qc.invalidateQueries({ queryKey: ["paroquia-regras-escala", paroquiaId] });
    toast.success("Regras da escala salvas.");
    setDirty(false);
  }

  async function handleReprocessar() {
    setReprocessLoading(true);
    try {
      const { data, error } = await anyDb.rpc("admin_reprocessar_historico_escala", { p_paroquia_id: paroquiaId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error);
      toast.success(`Reprocessado: ${data.registros_atualizados} presenças · ${data.membros_atualizados} membros.`);
    } catch (e: unknown) {
      toast.error("Erro ao reprocessar: " + (e as Error).message);
    } finally {
      setReprocessLoading(false);
    }
  }

  async function handleRecalcular() {
    setRecalcLoading(true);
    try {
      const { data, error } = await anyDb.rpc("admin_recalcular_scores_paroquia", { p_paroquia_id: paroquiaId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error);
      toast.success(`Scores recalculados para ${data.membros_atualizados} membros.`);
    } catch (e: unknown) {
      toast.error("Erro ao recalcular: " + (e as Error).message);
    } finally {
      setRecalcLoading(false);
    }
  }

  useSetPageTabs([
    { label: "Geral",       to: "/configuracoes/paroquia",        isActive: false },
    { label: "Motor",       to: "/configuracoes-escalas",         isActive: true  },
    { label: "Coordenação", to: "/configuracoes/administradores", isActive: false },
    { label: "Auditoria",   to: "/auditoria",                     isActive: false },
  ]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24 space-y-6">

      <div>
        <h1 className="page-header-title">Motor de Escalas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Política de confirmação, motor de alocação, substituições, indisponibilidades e pontuação.
        </p>
      </div>

      {/* ── Política de confirmação ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Política de confirmação</p>
        <div className="space-y-3">
          <button type="button" onClick={() => c("confirmacao_ativa", false)}
            className={`w-full text-left rounded-xl border-2 p-4 transition ${!form.confirmacao_ativa ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${!form.confirmacao_ativa ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div>
                <p className="font-semibold text-sm">Escala Fixa <span className="text-xs text-emerald-600 font-normal ml-1">(Recomendado)</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Membros informam indisponibilidades antecipadamente. Faltas registradas pelo coordenador após o evento. Sem botão confirmar/recusar.
                </p>
              </div>
            </div>
          </button>
          <button type="button" onClick={() => c("confirmacao_ativa", true)}
            className={`w-full text-left rounded-xl border-2 p-4 transition ${form.confirmacao_ativa ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${form.confirmacao_ativa ? "border-primary bg-primary" : "border-muted-foreground"}`} />
              <div>
                <p className="font-semibold text-sm">Confirmação Ativa</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Membro confirma ou justifica ausência. Coordenador recebe notificação de cada resposta.
                </p>
              </div>
            </div>
          </button>
        </div>
        {form.confirmacao_ativa && (
          <div className="pt-1">
            <Label className="text-xs text-muted-foreground">Prazo para confirmar (horas antes da escala)</Label>
            <input type="number" min={1} max={168} value={form.confirmacao_horas_antes}
              onChange={(e) => c("confirmacao_horas_antes", Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1 w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
        )}
      </section>

      {/* ── Motor ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Motor de alocação</p>

        <div className="space-y-3">
          {([
            { key: "prioridade_score" as const,                label: "Priorizar por score",                    desc: "Membros com menor score servem primeiro" },
            { key: "impedir_repeticao_consecutiva" as const,   label: "Impedir escalação consecutiva",          desc: "Evita escalar o mesmo membro em dois eventos seguidos" },
            { key: "permitir_duplicidade" as const,            label: "Permitir mesmo membro em duas funções",  desc: "Permite o mesmo membro em grupos diferentes na mesma escala" },
            { key: "variedade_ministerio" as const,            label: "Variedade de ministério",                desc: "Bonus para membros que servirão em ministério diferente do último — incentiva rotação" },
          ]).map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch checked={!!regras[key]} onCheckedChange={(v) => r(key, v)} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/40">
          <div>
            <Label className="text-xs text-muted-foreground">Peso missa normal</Label>
            <input type="number" min={1} value={regras.peso_normal}
              onChange={(e) => r("peso_normal", Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Peso missa solene</Label>
            <input type="number" min={1} value={regras.peso_solene}
              onChange={(e) => r("peso_solene", Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Limite semanal</Label>
            <input type="number" min={0} placeholder="Sem limite" value={regras.limite_semanal ?? ""}
              onChange={(e) => r("limite_semanal", e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Limite mensal</Label>
            <input type="number" min={0} placeholder="Sem limite" value={regras.limite_mensal ?? ""}
              onChange={(e) => r("limite_mensal", e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Intervalo mínimo entre escalações (dias)</Label>
            <p className="text-[11px] text-muted-foreground/70 mb-1">O motor bloqueia membros que já serviram dentro deste intervalo. Ex: 7 = no máximo uma vez por semana.</p>
            <input type="number" min={0} placeholder="Sem intervalo mínimo" value={regras.intervalo_minimo_dias ?? ""}
              onChange={(e) => r("intervalo_minimo_dias", e.target.value === "" ? null : Number(e.target.value))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
        </div>

        <div className="pt-2 border-t border-border/40 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Distribuição por gênero</p>
          <p className="text-xs text-muted-foreground">Proporção desejada de homens e mulheres que o motor usa ao gerar escalas.</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="text-blue-600">Masculino: {regras.distribuicao_masc_pct}%</span>
              <span className="text-rose-500">Feminino: {100 - regras.distribuicao_masc_pct}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={regras.distribuicao_masc_pct}
              onChange={(e) => r("distribuicao_masc_pct", Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gradient-to-r from-blue-400 to-rose-400" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0% M / 100% F</span><span>50% / 50%</span><span>100% M / 0% F</span>
            </div>
          </div>
          <div className="flex gap-2">
            {[{ m: 50, l: "50/50" }, { m: 60, l: "60/40" }, { m: 70, l: "70/30" }, { m: 40, l: "40/60" }].map((p) => (
              <button key={p.m} onClick={() => r("distribuicao_masc_pct", p.m)}
                className={`px-2 py-1 rounded-lg border text-xs font-medium transition ${regras.distribuicao_masc_pct === p.m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50 hover:bg-muted"}`}>
                {p.l}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Substituições ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Substituições</p>
            <p className="text-xs text-muted-foreground mt-0.5">Permite que membros solicitem trocas de escala entre si.</p>
          </div>
          <Switch checked={form.substituicao_ativa} onCheckedChange={(v) => c("substituicao_ativa", v)} />
        </div>
        {form.substituicao_ativa && (
          <div>
            <Label className="text-xs text-muted-foreground">Prazo mínimo (horas antes da escala)</Label>
            <input type="number" min={1} max={168} value={form.substituicao_horas_antes}
              onChange={(e) => c("substituicao_horas_antes", Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1 w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
          </div>
        )}
      </section>

      {/* ── Indisponibilidades ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indisponibilidades</p>
        <div>
          <Label className="text-xs text-muted-foreground">Antecedência mínima para registrar (dias)</Label>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5 mb-1.5">
            Membros só podem registrar indisponibilidade para datas com pelo menos esse número de dias de antecedência. 0 = sem restrição.
          </p>
          <input type="number" min={0} placeholder="Ex: 3" value={regras.dias_antecedencia_indisp ?? ""}
            onChange={(e) => r("dias_antecedencia_indisp", e.target.value === "" ? null : Number(e.target.value))}
            className="w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
        </div>
      </section>

      {/* ── Pontuação ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pontuação automática</p>
            <p className="text-xs text-muted-foreground mt-0.5">Score atualizado ao registrar presenças. Alimenta o Ranking.</p>
          </div>
          <Switch checked={form.auto_pontuar} onCheckedChange={(v) => c("auto_pontuar", v)} />
        </div>

        {form.auto_pontuar && (
          <>
            <div className="space-y-3 border-t border-border/40 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Escalas de missa</p>
              <PRow label="Presente — missa normal"  color="text-green-600"   value={form.pontuacao_presenca}        onChange={(v) => c("pontuacao_presenca", v)} />
              <PRow label="Presente — missa solene"  color="text-emerald-600" value={form.pontuacao_presenca_solene}  onChange={(v) => c("pontuacao_presenca_solene", v)} />
              <PRow label="Presente — com bispo"     color="text-teal-600"    value={form.pontuacao_presenca_bispo}   onChange={(v) => c("pontuacao_presenca_bispo", v)} />
              <PRow label="Faltou"                   color="text-red-600"     value={form.pontuacao_falta}            onChange={(v) => c("pontuacao_falta", v)} />
              <PRow label="Justificou"               color="text-amber-600"   value={form.pontuacao_justificou}       onChange={(v) => c("pontuacao_justificou", v)} />
              <PRow label="Atrasado"                 color="text-orange-600"  value={form.pontuacao_atraso}           onChange={(v) => c("pontuacao_atraso", v)} />
              <PRow label="Ocorrência grave"         color="text-rose-700"    value={form.pontuacao_ocorrencia_grave} onChange={(v) => c("pontuacao_ocorrencia_grave", v)} />
            </div>
            <div className="space-y-3 border-t border-border/40 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda pastoral</p>
              <PRow label="Formação"             color="text-blue-600"   value={form.pontuacao_formacao}    onChange={(v) => c("pontuacao_formacao", v)} />
              <PRow label="Reunião"              color="text-slate-600"  value={form.pontuacao_reuniao}     onChange={(v) => c("pontuacao_reuniao", v)} />
              <PRow label="Retiro"               color="text-purple-600" value={form.pontuacao_retiro}      onChange={(v) => c("pontuacao_retiro", v)} />
              <PRow label="Adoração"             color="text-yellow-600" value={form.pontuacao_adoracao}    onChange={(v) => c("pontuacao_adoracao", v)} />
              <PRow label="Ensaio"               color="text-green-700"  value={form.pontuacao_ensaio}      onChange={(v) => c("pontuacao_ensaio", v)} />
              <PRow label="Encontro"             color="text-cyan-600"   value={form.pontuacao_encontro}    onChange={(v) => c("pontuacao_encontro", v)} />
              <PRow label="Compromisso pastoral" color="text-rose-600"   value={form.pontuacao_compromisso} onChange={(v) => c("pontuacao_compromisso", v)} />
              <PRow label="Evento especial"      color="text-amber-700"  value={form.pontuacao_evento}      onChange={(v) => c("pontuacao_evento", v)} />
            </div>
            <div className="space-y-3 border-t border-border/40 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Substituições</p>
              <PRow label="Substituição aceita"   color="text-green-600" value={form.pontuacao_substituicao_aceita}   onChange={(v) => c("pontuacao_substituicao_aceita", v)} />
              <PRow label="Substituição recusada" color="text-red-600"   value={form.pontuacao_substituicao_recusada} onChange={(v) => c("pontuacao_substituicao_recusada", v)} />
            </div>
          </>
        )}
      </section>

      {/* ── Salvar ── */}
      <Button className="w-full rounded-xl" disabled={!dirty || saving} onClick={save}>
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar regras da escala
      </Button>

      {/* ── Ferramentas ── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ferramentas de pontuação</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aplique os valores configurados ao histórico ou recalcule os scores dos membros.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2.5">
          <span className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 text-xs font-bold select-none">i</span>
          <p className="text-xs text-blue-700 dark:text-blue-400">
            <strong>Reprocessar pontuação histórica:</strong> recalcula os pontos de cada presença já registrada em escalas conforme os valores atuais (normal / solene / bispo / falta…). Use após alterar pontuações para corrigir o histórico existente.{" "}
            <strong>Recalcular scores:</strong> apenas soma o que já está no histórico, sem alterar os pontos individuais.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="default" size="sm" className="rounded-xl flex-1"
            disabled={reprocessLoading || recalcLoading} onClick={handleReprocessar}>
            {reprocessLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Reprocessar pontuação histórica
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl flex-1"
            disabled={recalcLoading || reprocessLoading} onClick={handleRecalcular}>
            {recalcLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Recalcular scores (soma)
          </Button>
        </div>
      </section>
    </div>
  );
}
