import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Check, X, Sparkles, Loader2,
  AlertTriangle, Pencil, Plus, Minus, Users, ClipboardList,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  generateEscalaWithAlertas,
  type AssignmentHistoryEntry,
  type FuncaoRestricao,
} from "@/lib/escala-engine";
import { supabaseErrorMessage } from "@/lib/supabase-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type Ministerio = { id: string; nome: string; cor: string; categoria?: string | null };

type Membro = {
  id: string;
  nome: string;
  score: number;
  forcar_escalacao_solene: boolean;
  restricoes_dia_semana: number[];
  sexo: "M" | "F" | null;
  prioridade_escala: string;
};

type MissaPadrao = {
  id: string;
  nome: string;
  dia_semana: number;
  hora_inicio: string | null;
  local: string | null;
  tipo_missa_id: string | null;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  recorrencia: any;
};

type IndispRow = {
  id: string; membro_id: string; data: string;
  hora_inicio: string | null; hora_fim: string | null;
  tipo: string; data_fim: string | null; cancelada: boolean; motivo: string | null;
};

type FuncaoCelebracao = {
  ministerio_id: string;
  ministerio_nome: string;
  ministerio_cor: string;
  quantidade: number;
};

export type CelebracaoPreview = {
  _id: string;
  titulo: string;
  data: string;
  hora_inicio: string | null;
  local: string | null;
  tipo: string;
  tipo_missa_id: string | null;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  missaPadraoId: string;
  funcoes: FuncaoCelebracao[];
  /** true = evento pontual; restrições semanais de dia da semana não se aplicam */
  esporadico?: boolean;
};

type MotivoConflito =
  | "sem_vinculo"
  | "todos_indisponiveis"
  | "restricao"
  | "limite_semanal"
  | "insuficientes";

const MOTIVO_LABEL: Record<MotivoConflito, string> = {
  sem_vinculo:         "Sem vínculo",
  todos_indisponiveis: "Todos indisponíveis",
  restricao:           "Restrição",
  limite_semanal:      "Limite semanal",
  insuficientes:       "Insuficientes",
};

const MOTIVO_COLOR: Record<MotivoConflito, string> = {
  sem_vinculo:         "bg-muted text-muted-foreground",
  todos_indisponiveis: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  restricao:           "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  limite_semanal:      "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  insuficientes:       "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
};

type ConflitoPotencial = {
  celebracaoTitulo: string;
  ministerioNome: string;
  motivo: MotivoConflito;
  detalhe?: string;
};

type FuncaoVagaDetalhe = {
  celebracao: string;
  data: string;
  ministerio_nome: string;
  solicitados: number;
  alocados: number;
  motivo?: string;
};

type MembroCobertura = {
  id: string;
  nome: string;
  escalas: number;
  oportunidades: number;
  taxa: number;
  /** Por que o membro ficou sem escala (apenas quando escalas=0) */
  motivo_sem_escala?: string;
};

type PlanoCelebracao = {
  cel: CelebracaoPreview;
  alocacoes: { membro_id: string; ministerio_id: string }[];
  funcoesVagas: FuncaoVagaDetalhe[];
  semFuncoes: boolean;
  alertas: string[];
  indispEfetivas: IndispRow[];
};

type SimulacaoResultado = {
  plano: PlanoCelebracao[];
  sumario: {
    totalCelebracoes: number;
    celebracoesCompletas: number;
    celebracoesIncompletas: number;
    celebracoesSemFuncoes: number;
    totalFuncoes: number;
    funcoesPreenchidas: number;
    funcoesVagas: number;
    membrosEscalados: number;
    /** Membros com oportunidades reais mas que ainda ficaram com 0 escalas */
    membrosElegiveisSemEscala: MembroCobertura[];
    /** Membros sem nenhuma oportunidade válida no período (verdadeiramente inelegíveis) */
    membrosInelegiveis: MembroCobertura[];
    distribuicao: { id: string; nome: string; count: number; oportunidades: number; taxa: number }[];
    alertas: string[];
  };
};

type Relatorio = {
  criadas: number;
  ignoradas: number;
  vagasPreenchidas: number;
  vagasNaoPreenchidas: number;
  distribuicao: { id: string; nome: string; count: number; oportunidades: number; taxa: number }[];
  funcoesVagas: FuncaoVagaDetalhe[];
  celebracoesSemFuncoes: { titulo: string; data: string }[];
  alertas: string[];
};

type ConfigSalva = {
  periodo: { tipo: string; dataInicio: string; dataFim: string };
  missasSelecionadas: string[];
};

type ParoquiaConfig = {
  regras_escala: any;
  usa_tochas: boolean;
};

export type AssistenteGeracaoProps = {
  open: boolean;
  onClose: () => void;
  paroquiaId: string;
  profileId: string;
  membros: Membro[];
  ministerios: Ministerio[];
  missasPadrao: MissaPadrao[];
  membroMinisterios: Record<string, string[]>;
  membroAtuacoes: Record<string, string[]>;
  assignmentHistory: AssignmentHistoryEntry[];
  indisponibilidades: IndispRow[];
  funcaoRestricoes: FuncaoRestricao[];
  membroMissaRestricoes: Record<string, string[]>;
  paroquiaConfig: ParoquiaConfig | null;
  onSuccess: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIA_SEMANA_NOME = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PAGE_SIZE = 15;

function passaRecorrencia(data: Date, recorrencia: any): boolean {
  const tipo = recorrencia?.tipo ?? "semanal";
  if (tipo === "semanal") return true;
  if (tipo === "esporadico") return false;
  const weekOfMonth = Math.ceil(data.getDate() / 7);
  const isLast =
    new Date(data.getFullYear(), data.getMonth() + 1, 0).getDate() - data.getDate() < 7;
  return (
    tipo === "quinzenal"     ? [1, 3].includes(weekOfMonth) :
    tipo === "quinzenal_1_3" ? [1, 3].includes(weekOfMonth) :
    tipo === "quinzenal_2_4" ? [2, 4].includes(weekOfMonth) :
    tipo === "mensal_1"      ? weekOfMonth === 1 :
    tipo === "mensal_2"      ? weekOfMonth === 2 :
    tipo === "mensal_3"      ? weekOfMonth === 3 :
    tipo === "mensal_4"      ? weekOfMonth === 4 :
    tipo === "mensal_ultimo" ? isLast :
    true
  );
}

// P0.3 — mesma lógica do estaIndisponivel() do engine
function membroEstaBloqueado(membroId: string, celData: string, indisp: IndispRow[]): boolean {
  return indisp.some((i) => {
    if (i.membro_id !== membroId || i.cancelada) return false;
    if (i.tipo === "intervalo" && i.data_fim) return celData >= i.data && celData <= i.data_fim;
    return i.data === celData;
  });
}

function storageKey(paroquiaId: string) { return `lumen-geracao-config-${paroquiaId}`; }
function carregarConfig(paroquiaId: string): ConfigSalva | null {
  try { const s = localStorage.getItem(storageKey(paroquiaId)); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function salvarConfig(paroquiaId: string, config: ConfigSalva) {
  try { localStorage.setItem(storageKey(paroquiaId), JSON.stringify(config)); } catch {}
}

function periodoRapido(tipo: string): { dataInicio: string; dataFim: string } {
  const hoje = new Date();
  let ini: Date, fim: Date;
  switch (tipo) {
    case "proximos_15_dias": ini = addDays(hoje, 1); fim = addDays(hoje, 15); break;
    case "proximo_mes":      ini = addDays(hoje, 1); fim = addDays(hoje, 30); break;
    default:                 ini = addDays(hoje, 1); fim = addDays(hoje, 7);  break;
  }
  return { dataInicio: format(ini, "yyyy-MM-dd"), dataFim: format(fim, "yyyy-MM-dd") };
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

const PASSOS = [
  { num: 1, label: "Período" },
  { num: 2, label: "Missas"  },
  { num: 3, label: "Revisão" },
  { num: 4, label: "Gerar"   },
];

function StepIndicator({ atual }: { atual: number }) {
  const passosMostrar = atual === 5 ? PASSOS : PASSOS;
  return (
    <div className="flex items-center gap-1">
      {passosMostrar.map((p, i) => (
        <div key={p.num} className="flex items-center gap-1">
          <div className={`flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold transition-all ${
            (p.num < atual || atual === 5)
              ? "bg-primary text-primary-foreground"
              : p.num === atual
              ? "bg-primary text-primary-foreground ring-2 ring-primary/25"
              : "bg-muted text-muted-foreground"
          }`}>
            {(p.num < atual || atual === 5) ? <Check className="h-3 w-3" /> : p.num}
          </div>
          <span className={`hidden sm:inline text-[11px] font-medium ${
            p.num === atual ? "text-foreground" : "text-muted-foreground"
          }`}>{p.label}</span>
          {i < passosMostrar.length - 1 && (
            <div className={`h-px w-4 mx-0.5 ${(p.num < atual || atual === 5) ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Modal de edição de celebração ───────────────────────────────────────────

const TIPOS_MISSA_OPTIONS = [
  { value: "missa",              label: "Missa comum" },
  { value: "missa_solene",       label: "Solene" },
  { value: "com_bispo",          label: "Com Bispo" },
  { value: "adoracao",           label: "Adoração" },
  { value: "formacao",           label: "Formação" },
  { value: "celebracao_palavra", label: "Celebração da Palavra" },
  { value: "outro",              label: "Outro" },
];

function ModalEdicaoCelebracao({
  celebracao,
  ministerios,
  onSave,
  onClose,
}: {
  celebracao: CelebracaoPreview;
  ministerios: Ministerio[];
  onSave: (c: CelebracaoPreview) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CelebracaoPreview>({
    ...celebracao,
    funcoes: celebracao.funcoes.map((f) => ({ ...f })),
  });
  const [aba, setAba] = useState<"dados" | "funcoes">("dados");

  function alterarQtd(idx: number, delta: number) {
    setForm((p) => ({
      ...p,
      funcoes: p.funcoes.map((f, i) => i === idx ? { ...f, quantidade: Math.max(1, f.quantidade + delta) } : f),
    }));
  }
  function removerFuncao(idx: number) {
    setForm((p) => ({ ...p, funcoes: p.funcoes.filter((_, i) => i !== idx) }));
  }
  function adicionarFuncao(ministerioId: string) {
    const min = ministerios.find((m) => m.id === ministerioId);
    if (!min) return;
    const existe = form.funcoes.findIndex((f) => f.ministerio_id === ministerioId);
    if (existe >= 0) { alterarQtd(existe, 1); return; }
    setForm((p) => ({
      ...p,
      funcoes: [...p.funcoes, { ministerio_id: min.id, ministerio_nome: min.nome, ministerio_cor: min.cor, quantidade: 1 }],
    }));
  }

  const ministeriosDisponiveis = ministerios.filter((m) => !form.funcoes.some((f) => f.ministerio_id === m.id));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm leading-snug pr-6">{form.titulo}</DialogTitle>
        </DialogHeader>
        <div className="flex border-b -mx-1">
          {(["dados", "funcoes"] as const).map((a) => (
            <button key={a} onClick={() => setAba(a)}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                aba === a ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
              }`}>
              {a === "dados" ? "Dados da celebração" : "Funções"}
            </button>
          ))}
        </div>

        {aba === "dados" && (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <input value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data</Label>
                <input type="date" value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hora</Label>
                <input type="time" value={form.hora_inicio ?? ""} onChange={(e) => setForm((p) => ({ ...p, hora_inicio: e.target.value || null }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Local / Comunidade</Label>
              <input value={form.local ?? ""} onChange={(e) => setForm((p) => ({ ...p, local: e.target.value || null }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo da celebração</Label>
              <Select value={form.tipo === "tipo_missa" ? "missa" : form.tipo}
                onValueChange={(v) => setForm((p) => ({ ...p, tipo: v, tipo_missa_id: null, solene: v === "missa_solene" || v === "com_bispo", tem_adoracao: v === "adoracao", tem_bispo: v === "com_bispo" }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_MISSA_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {aba === "funcoes" && (
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">Alterações aqui afetam apenas esta celebração. Use ± para ajustar a quantidade.</p>
            <div className="space-y-2">
              {form.funcoes.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma função adicionada.</p>}
              {form.funcoes.map((f, idx) => (
                <div key={`${f.ministerio_id}-${idx}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: f.ministerio_cor }} />
                  <span className="flex-1 text-sm font-medium truncate">{f.ministerio_nome}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => alterarQtd(idx, -1)} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted transition"><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-sm font-semibold tabular-nums">{f.quantidade}</span>
                    <button onClick={() => alterarQtd(idx, 1)} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted transition"><Plus className="h-3 w-3" /></button>
                  </div>
                  <button onClick={() => removerFuncao(idx)} className="ml-1 text-muted-foreground hover:text-destructive transition"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            {ministeriosDisponiveis.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Adicionar função</Label>
                <Select onValueChange={adicionarFuncao} value="">
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecionar ministério..." /></SelectTrigger>
                  <SelectContent>
                    {ministeriosDisponiveis.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 h-9" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 h-9" onClick={() => onSave(form)}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AssistenteGeracaoEscalas({
  open, onClose, paroquiaId, profileId,
  membros, ministerios, missasPadrao,
  membroMinisterios, membroAtuacoes, assignmentHistory,
  indisponibilidades, funcaoRestricoes, membroMissaRestricoes,
  paroquiaConfig, onSuccess,
}: AssistenteGeracaoProps) {

  const [passo, setPasso] = useState(1);
  const [tipoPeriodo, setTipoPeriodo] = useState("proxima_semana");
  const [dataInicio, setDataInicio] = useState(() => format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [dataFim, setDataFim] = useState(() => format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [missasSelecionadas, setMissasSelecionadas] = useState<Set<string>>(new Set());
  const [preVisualizacao, setPreVisualizacao] = useState<CelebracaoPreview[]>([]);
  const [editandoIdx, setEditandoIdx] = useState<number | null>(null);
  const [conflitos, setConflitos] = useState<ConflitoPotencial[]>([]);
  const [paginaAtual, setPaginaAtual] = useState(0);
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [simulacao, setSimulacao] = useState<SimulacaoResultado | null>(null);
  const [ultimaConfig, setUltimaConfig] = useState<ConfigSalva | null>(null);
  const [sugerirUltimaConfig, setSugerirUltimaConfig] = useState(false);

  // ── Queries de funções ────────────────────────────────────────────────────
  const mpIds = missasPadrao.map((m) => m.id);

  const { data: missaPadraoFuncoesData = [] } = useQuery({
    queryKey: ["missa-padrao-funcoes-all", paroquiaId, mpIds.length],
    enabled: open && mpIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("missa_padrao_funcoes")
        .select("missa_padrao_id, ministerio_id, quantidade").in("missa_padrao_id", mpIds);
      return (data ?? []) as { missa_padrao_id: string; ministerio_id: string; quantidade: number }[];
    },
  });

  const tipomissaIds = useMemo(
    () => [...new Set(missasPadrao.map((m) => m.tipo_missa_id).filter(Boolean))] as string[],
    [missasPadrao]
  );
  const { data: tipoMissaFuncoesData = [] } = useQuery({
    queryKey: ["tipo-missa-funcoes-all", tipomissaIds.join(",")],
    enabled: open && tipomissaIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("tipo_missa_funcoes")
        .select("tipo_missa_id, ministerio_id, quantidade_min")
        .in("tipo_missa_id", tipomissaIds);
      return (data ?? []) as { tipo_missa_id: string; ministerio_id: string; quantidade_min: number }[];
    },
  });

  const { data: funcoesExcecaoData = [] } = useQuery({
    queryKey: ["missa-padrao-funcoes-extras", mpIds.join(",")],
    enabled: open && mpIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("missa_padrao_funcoes_extras")
        .select("missa_padrao_id, ministerio_id, quantidade, data")
        .in("missa_padrao_id", mpIds);
      return (data ?? []) as { missa_padrao_id: string; ministerio_id: string; quantidade: number; data: string }[];
    },
  });

  // ── Mapas auxiliares ──────────────────────────────────────────────────────
  const ministeriosMap = useMemo(() => {
    const m: Record<string, Ministerio> = {};
    ministerios.forEach((min) => { m[min.id] = min; });
    return m;
  }, [ministerios]);

  const missaFuncoesMap = useMemo(() => {
    const map: Record<string, FuncaoCelebracao[]> = {};
    for (const missa of missasPadrao) {
      // Funções configuradas diretamente nesta missa padrão têm prioridade
      const proprias = missaPadraoFuncoesData.filter((f) => f.missa_padrao_id === missa.id);
      if (proprias.length > 0) {
        map[missa.id] = proprias.map((f) => ({ ministerio_id: f.ministerio_id, ministerio_nome: ministeriosMap[f.ministerio_id]?.nome ?? "?", ministerio_cor: ministeriosMap[f.ministerio_id]?.cor ?? "#999", quantidade: f.quantidade }));
      } else if (missa.tipo_missa_id) {
        map[missa.id] = tipoMissaFuncoesData
          .filter((f) => f.tipo_missa_id === missa.tipo_missa_id)
          .map((f) => ({ ministerio_id: f.ministerio_id, ministerio_nome: ministeriosMap[f.ministerio_id]?.nome ?? "?", ministerio_cor: ministeriosMap[f.ministerio_id]?.cor ?? "#999", quantidade: f.quantidade_min }));
      } else {
        map[missa.id] = [];
      }
    }
    return map;
  }, [missasPadrao, missaPadraoFuncoesData, tipoMissaFuncoesData, ministeriosMap]);

  // ── Inicializar ao abrir ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setPasso(1);
    setEditandoIdx(null);
    setPreVisualizacao([]);
    setConflitos([]);
    setRelatorio(null);
    setSimulacao(null);
    setProgresso({ atual: 0, total: 0 });
    setPaginaAtual(0);

    const cfg = carregarConfig(paroquiaId);
    if (cfg) {
      setUltimaConfig(cfg);
      setSugerirUltimaConfig(true);
    } else {
      const { dataInicio: ini, dataFim: fim } = periodoRapido("proxima_semana");
      setDataInicio(ini); setDataFim(fim); setTipoPeriodo("proxima_semana");
      setMissasSelecionadas(new Set(missasPadrao.map((m) => m.id)));
      setSugerirUltimaConfig(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function aplicarUltimaConfig() {
    if (!ultimaConfig) return;
    setDataInicio(ultimaConfig.periodo.dataInicio);
    setDataFim(ultimaConfig.periodo.dataFim);
    setTipoPeriodo(ultimaConfig.periodo.tipo);
    // Inclui missas padrão criadas após a última config (não estariam na lista salva)
    const savedSet = new Set(ultimaConfig.missasSelecionadas);
    const todosIds = missasPadrao.map((m) => m.id);
    const novos = todosIds.filter((id) => !ultimaConfig.missasSelecionadas.includes(id));
    novos.forEach((id) => savedSet.add(id));
    setMissasSelecionadas(savedSet);
    setSugerirUltimaConfig(false);
  }
  function recusarUltimaConfig() {
    const { dataInicio: ini, dataFim: fim } = periodoRapido("proxima_semana");
    setDataInicio(ini); setDataFim(fim); setTipoPeriodo("proxima_semana");
    setMissasSelecionadas(new Set(missasPadrao.map((m) => m.id)));
    setSugerirUltimaConfig(false);
  }
  function aplicarPeriodoRapido(tipo: string) {
    const { dataInicio: ini, dataFim: fim } = periodoRapido(tipo);
    setDataInicio(ini); setDataFim(fim); setTipoPeriodo(tipo);
  }

  // ── Cálculo do preview ────────────────────────────────────────────────────
  function calcularCelebracoes(): CelebracaoPreview[] {
    const startDate = new Date(dataInicio + "T00:00:00");
    const endDate   = new Date(dataFim   + "T00:00:00");
    const celebracoes: CelebracaoPreview[] = [];

    for (const missa of missasPadrao) {
      if (!missasSelecionadas.has(missa.id)) continue;

      // Missa com data específica (esporádico): inclui se a data cai no período
      if (missa.recorrencia?.tipo === "esporadico") {
        const dataEsp = missa.recorrencia?.data as string | undefined;
        if (dataEsp && dataEsp >= dataInicio && dataEsp <= dataFim) {
          const dateStr = dataEsp;
          const funcoes = (() => {
            const base = (missaFuncoesMap[missa.id] ?? []).map((f) => ({ ...f }));
            const extras = funcoesExcecaoData.filter(
              (e) => e.missa_padrao_id === missa.id && e.data === dateStr
            );
            for (const ex of extras) {
              const idx = base.findIndex((b) => b.ministerio_id === ex.ministerio_id);
              if (idx >= 0) base[idx].quantidade = ex.quantidade;
              else base.push({ ministerio_id: ex.ministerio_id, ministerio_nome: ministeriosMap[ex.ministerio_id]?.nome ?? "?", ministerio_cor: ministeriosMap[ex.ministerio_id]?.cor ?? "#999", quantidade: ex.quantidade });
            }
            return base;
          })();
          celebracoes.push({
            _id: crypto.randomUUID(),
            titulo: `${missa.nome} — ${format(new Date(dateStr + "T12:00:00"), "dd/MM", { locale: ptBR })}`,
            data: dateStr,
            hora_inicio: missa.hora_inicio,
            local: missa.local,
            tipo: missa.tipo_missa_id ? "tipo_missa" : "missa",
            tipo_missa_id: missa.tipo_missa_id,
            solene: missa.solene,
            tem_adoracao: missa.tem_adoracao,
            tem_bispo: missa.tem_bispo,
            missaPadraoId: missa.id,
            funcoes,
            esporadico: true,
          });
        }
        continue;
      }

      const cur = new Date(startDate);
      while (cur <= endDate) {
        if (cur.getDay() === missa.dia_semana && passaRecorrencia(cur, missa.recorrencia)) {
          const dateStr = format(cur, "yyyy-MM-dd");
          celebracoes.push({
            _id: crypto.randomUUID(),
            titulo: `${missa.nome} — ${format(cur, "dd/MM", { locale: ptBR })}`,
            data: dateStr,
            hora_inicio: missa.hora_inicio,
            local: missa.local,
            tipo: missa.tipo_missa_id ? "tipo_missa" : "missa",
            tipo_missa_id: missa.tipo_missa_id,
            solene: missa.solene,
            tem_adoracao: missa.tem_adoracao,
            tem_bispo: missa.tem_bispo,
            missaPadraoId: missa.id,
            funcoes: (() => {
              const base = (missaFuncoesMap[missa.id] ?? []).map((f) => ({ ...f }));
              // Merge funções específicas para esta data
              const extras = funcoesExcecaoData.filter(
                (e) => e.missa_padrao_id === missa.id && e.data === dateStr
              );
              for (const extra of extras) {
                const existing = base.find((f) => f.ministerio_id === extra.ministerio_id);
                if (existing) {
                  existing.quantidade = extra.quantidade;
                } else {
                  base.push({
                    ministerio_id: extra.ministerio_id,
                    ministerio_nome: ministeriosMap[extra.ministerio_id]?.nome ?? "?",
                    ministerio_cor: ministeriosMap[extra.ministerio_id]?.cor ?? "#999",
                    quantidade: extra.quantidade,
                  });
                }
              }
              return base;
            })(),
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    return celebracoes.sort((a, b) => {
      const d = a.data.localeCompare(b.data);
      return d !== 0 ? d : (a.hora_inicio ?? "").localeCompare(b.hora_inicio ?? "");
    });
  }

  // ── P0.3 + P0.4 — Conflitos com motivo detalhado e suporte a intervalo ──
  function calcularConflitos(celebs: CelebracaoPreview[]): ConflitoPotencial[] {
    const cs: ConflitoPotencial[] = [];
    const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const limiteS = regras.limite_semanal as number | undefined;

    for (const cel of celebs) {
      const diaSemana = new Date(cel.data + "T00:00:00").getDay();

      for (const funcao of cel.funcoes) {
        const vinculados = membroMinisterios[funcao.ministerio_id] ?? [];

        // 1. Sem vínculo com o ministério
        if (vinculados.length === 0) {
          cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "sem_vinculo" });
          continue;
        }

        const comVinculo = membros.filter((m) => vinculados.includes(m.id));

        // 2. Restrição de dia da semana
        const semRestrDia = comVinculo.filter((m) => !m.restricoes_dia_semana?.includes(diaSemana));
        if (semRestrDia.length === 0) {
          cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "restricao", detalhe: "Restrição de dia da semana" });
          continue;
        }

        // 3. Indisponibilidade — incluindo tipo "intervalo" (P0.3)
        const semIndisp = semRestrDia.filter((m) => !membroEstaBloqueado(m.id, cel.data, indisponibilidades));
        if (semIndisp.length === 0) {
          cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "todos_indisponiveis" });
          continue;
        }

        // 4. Restrição de função (não pode)
        const semRestFunc = semIndisp.filter((m) =>
          !funcaoRestricoes.some((r) => r.membro_id === m.id && r.ministerio_id === funcao.ministerio_id && r.tipo === "nao_pode")
        );
        if (semRestFunc.length === 0) {
          cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "restricao", detalhe: "Restrição de função" });
          continue;
        }

        // 5. Limite semanal
        let candidatosFinais = semRestFunc;
        if (limiteS) {
          const semanaInicio = format(addDays(new Date(cel.data + "T00:00:00"), -6), "yyyy-MM-dd");
          candidatosFinais = semRestFunc.filter((m) => {
            const cnt = assignmentHistory.filter(
              (h) => h.memberId === m.id && h.date && h.date >= semanaInicio && h.date <= cel.data
            ).length;
            return cnt < limiteS;
          });
          if (candidatosFinais.length === 0) {
            cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "limite_semanal", detalhe: `Limite: ${limiteS}/semana` });
            continue;
          }
        }

        // 6. Quantidade insuficiente
        if (candidatosFinais.length < funcao.quantidade) {
          cs.push({ celebracaoTitulo: cel.titulo, ministerioNome: funcao.ministerio_nome, motivo: "insuficientes", detalhe: `${candidatosFinais.length} de ${funcao.quantidade} necessários` });
        }
      }
    }
    return cs;
  }

  // ── Navegação ─────────────────────────────────────────────────────────────
  function avancarPara2() {
    if (missasSelecionadas.size === 0) setMissasSelecionadas(new Set(missasPadrao.map((m) => m.id)));
    setPasso(2);
  }
  function avancarPara3() {
    const celebs = calcularCelebracoes();
    setPreVisualizacao(celebs);
    setPaginaAtual(0);
    setPasso(3);
  }
  function avancarParaResumo() {
    const cs = calcularConflitos(preVisualizacao);
    setConflitos(cs);
    salvarConfig(paroquiaId, {
      periodo: { tipo: tipoPeriodo, dataInicio, dataFim },
      missasSelecionadas: [...missasSelecionadas],
    });
    setPasso(4);
  }

  // ── Motor unificado V3: constrói plano sem gravar no banco ──────────────────
  function computarPlano(): SimulacaoResultado {
    const regras = (paroquiaConfig?.regras_escala ?? {}) as Record<string, unknown>;
    const engineConfig = {
      usa_tochas:                paroquiaConfig?.usa_tochas ?? false,
      limite_semanal:            regras.limite_semanal           as number  | undefined,
      limite_mensal:             regras.limite_mensal            as number  | undefined,
      impedir_repeticao_seguida: (regras.impedir_repeticao_consecutiva as boolean | undefined) ?? false,
      intervalo_minimo_dias:     regras.intervalo_minimo_dias    as number  | undefined,
      distribuicao_masc_pct:     regras.distribuicao_masc_pct   as number  | undefined,
      variedade_ministerio:      (regras.variedade_ministerio    as boolean | undefined) ?? false,
      prioridade_bonus_alto:     regras.prioridade_bonus_alto    as number  | undefined,
      prioridade_bonus_medio:    regras.prioridade_bonus_medio   as number  | undefined,
      bonus_preferencial_solene: regras.bonus_preferencial_solene as number | undefined,
    };

    // Acumula histórico de alocações desta rodada (impede conflitos no mesmo dia)
    const batchHistory: AssignmentHistoryEntry[] = [];

    // Pré-calcula oportunidades elegíveis por membro no mês inteiro
    const membroOportunidades = new Map<string, number>();
    const membroPara: Record<string, string[]> = {};
    for (const [minId, mids] of Object.entries(membroMinisterios)) {
      for (const mid of mids) {
        if (!membroPara[mid]) membroPara[mid] = [];
        membroPara[mid].push(minId);
      }
    }
    for (const cel of preVisualizacao) {
      const diaSemana = new Date(cel.data + "T12:00:00").getDay();
      // Inclui restrições de missa específica (igual ao cálculo feito no loop principal)
      const missaCel = missasPadrao.find((mp) => mp.id === cel.missaPadraoId);
      const restDiaCel = cel.esporadico
        ? missasPadrao
            .filter((mp) => mp.recorrencia?.tipo !== "esporadico" && mp.dia_semana === diaSemana)
            .flatMap((mp) => (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: cel.data })))
        : (missaCel ? (membroMissaRestricoes[missaCel.id] ?? []) : [])
            .map((mid) => ({ membro_id: mid, data: cel.data }));
      const indispCel = [...indisponibilidades, ...restDiaCel];
      for (const m of membros) {
        // restricoes_dia_semana é penalidade SUAVE no motor (–20 pts), não exclusão.
        // Manter como hard aqui impedia membros com restrição em todos os dias do mês
        // de receber oportunidades, bloqueando a cobertura mínima.
        if (membroEstaBloqueado(m.id, cel.data, indispCel)) continue;
        const temVinculo = cel.funcoes.some((f) => membroPara[m.id]?.includes(f.ministerio_id));
        if (!temVinculo) continue;
        membroOportunidades.set(m.id, (membroOportunidades.get(m.id) ?? 0) + 1);
      }
    }

    const plano: PlanoCelebracao[] = [];
    const todosAlertasGlobais: string[] = [];

    for (const cel of preVisualizacao) {
      // Celebração sem funções configuradas → erro explícito, não silencioso
      if (cel.funcoes.length === 0) {
        plano.push({
          cel,
          alocacoes:      [],
          funcoesVagas:   [],
          semFuncoes:     true,
          alertas:        ["Missa sem funções configuradas. Configure as funções antes de gerar."],
          indispEfetivas: indisponibilidades,
        });
        continue;
      }

      if (membros.length === 0) {
        plano.push({ cel, alocacoes: [], funcoesVagas: [], semFuncoes: false, alertas: ["Nenhum membro ativo."], indispEfetivas: indisponibilidades });
        continue;
      }

      const missa = missasPadrao.find((m) => m.id === cel.missaPadraoId);
      const diaSemana = new Date(cel.data + "T12:00:00").getDay();

      // Restrições de indisponibilidade por missa padrão (esporádicos derivam do dia da semana)
      const restDiaEsporadico = cel.esporadico
        ? missasPadrao
            .filter((mp) => mp.recorrencia?.tipo !== "esporadico" && mp.dia_semana === diaSemana)
            .flatMap((mp) => (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: cel.data })))
        : [];
      const missaRestricaoIndisp = (missa ? (membroMissaRestricoes[missa.id] ?? []) : [])
        .map((mid) => ({ membro_id: mid, data: cel.data }));
      const indispParaGeracao = cel.esporadico
        ? [...indisponibilidades, ...restDiaEsporadico]
        : [...indisponibilidades, ...missaRestricaoIndisp];

      const membrosComAtuacoes = membros.map((m) => ({ ...m, atuacao_ids: membroAtuacoes[m.id] ?? [] }));

      // Ordena funções por escassez de candidatos (menos candidatos → processa primeiro)
      // preservando a prioridade pastoral original quando configurada explicitamente.
      const funcoesComCandidatos = cel.funcoes.map((f) => {
        const candidatos = membros.filter((m) => {
          if (!membroPara[m.id]?.includes(f.ministerio_id)) return false;
          // restricoes_dia_semana não é exclusão — o motor a trata como penalidade suave
          if (membroEstaBloqueado(m.id, cel.data, indispParaGeracao)) return false;
          return true;
        }).length;
        return { ...f, _candidatos: candidatos };
      });
      // Ordena por (candidatos ASC) — garantindo que funções escassas são alocadas primeiro
      funcoesComCandidatos.sort((a, b) => a._candidatos - b._candidatos);

      const funcoesPedido = funcoesComCandidatos.map((f, idx) => ({
        ministerio_id: f.ministerio_id,
        quantidade:    f.quantidade,
        ministerio:    { id: f.ministerio_id, nome: f.ministerio_nome, cor: f.ministerio_cor },
        // ordem_prioridade reflete a posição após sort por escassez
        ordem_prioridade: idx,
      }));

      // Chama o motor V3 para TODAS as celebrações (missas comuns e solenidades)
      // Motor detecta modo automaticamente: solene=true → scoring mérito; false → equidade
      const resultado = generateEscalaWithAlertas(
        { titulo: cel.titulo, data: cel.data, tipo: cel.tipo, observacoes: null },
        funcoesPedido,
        membrosComAtuacoes,
        membroMinisterios,
        {
          history:            [...assignmentHistory, ...batchHistory],
          indisponibilidades: indispParaGeracao,
          restricoes:         funcaoRestricoes,
          config:             engineConfig,
          solene:             cel.solene,
          tem_adoracao:       cel.tem_adoracao,
          tem_bispo:          cel.tem_bispo,
        }
      );

      // Atualiza batchHistory para que a próxima celebração veja estas alocações
      resultado.sugestoes.forEach((s) => {
        batchHistory.push({ memberId: s.membro_id, ministerioId: s.ministerio_id, date: cel.data });
      });

      // Detecta funções que ficaram com vagas
      const funcoesVagas: FuncaoVagaDetalhe[] = resultado.detalhesPorFuncao
        .filter((d) => d.alocados < d.solicitados)
        .map((d) => ({
          celebracao:      cel.titulo,
          data:            cel.data,
          ministerio_nome: d.ministerio_nome,
          solicitados:     d.solicitados,
          alocados:        d.alocados,
          motivo:          d.motivo_vazio,
        }));

      if (resultado.alertas.length > 0) todosAlertasGlobais.push(...resultado.alertas);

      plano.push({
        cel,
        alocacoes:    resultado.sugestoes,
        funcoesVagas,
        semFuncoes:   false,
        alertas:      resultado.alertas,
        indispEfetivas: indispParaGeracao,
      });
    }

    // ── Garantia de cobertura mínima ────────────────────────────────────────
    // Membros elegíveis (com oportunidades reais) que ficaram com 0 escalas são injetados
    // em ao menos uma celebração com vaga disponível. Regras:
    //   1. Nunca ultrapassa quantidade configurado da função (sem sobrealocação)
    //   2. Cada celebração recebe no máximo 1 injeção (distribui entre datas distintas)
    //   3. Respeita indisponibilidades E restrições de missa (via indispEfetivas)
    //   4. Membros com 0 oportunidades reais (todas celebrações bloqueadas) não são elegíveis
    const escalasContador = new Map<string, number>();
    for (const p of plano) {
      for (const a of p.alocacoes) {
        escalasContador.set(a.membro_id, (escalasContador.get(a.membro_id) ?? 0) + 1);
      }
    }
    // Rastreia celebrações que já receberam uma injeção neste passo
    const celComInjecao = new Set<string>();
    for (const m of membros) {
      if ((escalasContador.get(m.id) ?? 0) > 0) continue;
      if ((membroOportunidades.get(m.id) ?? 0) === 0) continue;
      for (const planoCel of plano) {
        if (planoCel.semFuncoes) continue;
        if (celComInjecao.has(planoCel.cel.data + planoCel.cel.titulo)) continue;
        if (planoCel.alocacoes.some((a) => a.membro_id === m.id)) continue;
        // Verifica indisponibilidade E restrição de missa via indispEfetivas da celebração
        if (membroEstaBloqueado(m.id, planoCel.cel.data, planoCel.indispEfetivas)) continue;
        // Só injeta em função que ainda tem vaga (sem sobrealocação)
        const funcaoCompat = planoCel.cel.funcoes.find((f) => {
          if (!membroPara[m.id]?.includes(f.ministerio_id)) return false;
          const jaAlocados = planoCel.alocacoes.filter((a) => a.ministerio_id === f.ministerio_id).length;
          return jaAlocados < f.quantidade;
        });
        if (!funcaoCompat) continue;
        planoCel.alocacoes.push({ membro_id: m.id, ministerio_id: funcaoCompat.ministerio_id });
        planoCel.alertas.push(`ℹ ${m.nome} adicionado(a) para garantir ao menos uma escala no período.`);
        todosAlertasGlobais.push(`ℹ "${planoCel.cel.titulo}" (${planoCel.cel.data}): ${m.nome} adicionado(a) para garantir cobertura mínima.`);
        escalasContador.set(m.id, 1);
        celComInjecao.add(planoCel.cel.data + planoCel.cel.titulo);
        break;
      }
    }

    // ── Fase B: deslocamento — cobertura para membros ainda com 0 escalas ───────
    // Se após a injeção em vagas abertas um membro elegível ainda tem 0 escalas,
    // tenta deslocar um membro com ≥2 escalas de uma vaga compatível e ocupada.
    // Preserva quantidade configurada da função (sem sobrealocação).
    const celComDeslocamento = new Set<string>();
    for (const m of membros) {
      if ((escalasContador.get(m.id) ?? 0) > 0) continue;
      if ((membroOportunidades.get(m.id) ?? 0) === 0) continue;

      let deslocou = false;
      for (const planoCel of plano) {
        if (deslocou) break;
        if (planoCel.semFuncoes) continue;
        if (celComDeslocamento.has(planoCel.cel.data + planoCel.cel.titulo)) continue;
        if (planoCel.alocacoes.some((a) => a.membro_id === m.id)) continue;
        if (membroEstaBloqueado(m.id, planoCel.cel.data, planoCel.indispEfetivas)) continue;

        for (const f of planoCel.cel.funcoes) {
          if (!membroPara[m.id]?.includes(f.ministerio_id)) continue;

          const ocupantes = planoCel.alocacoes.filter((a) => a.ministerio_id === f.ministerio_id);
          // Vaga aberta ainda — deveria ter sido pego no passo anterior; tenta mesmo assim
          if (ocupantes.length < f.quantidade) {
            planoCel.alocacoes.push({ membro_id: m.id, ministerio_id: f.ministerio_id });
            escalasContador.set(m.id, 1);
            planoCel.alertas.push(`ℹ ${m.nome} adicionado(a) para garantir ao menos uma escala no período.`);
            todosAlertasGlobais.push(`ℹ "${planoCel.cel.titulo}" (${planoCel.cel.data}): ${m.nome} adicionado(a) para garantir cobertura mínima.`);
            celComDeslocamento.add(planoCel.cel.data + planoCel.cel.titulo);
            deslocou = true;
            break;
          }

          // Vaga cheia — tenta deslocar quem tem mais escalas no mês (≥2)
          const candidatoDeslocamento = ocupantes
            .map((a) => ({ membro_id: a.membro_id, count: escalasContador.get(a.membro_id) ?? 0 }))
            .sort((a, b) => b.count - a.count)
            .find((a) => a.count >= 2);

          if (!candidatoDeslocamento) continue;

          const nome = membros.find((x) => x.id === candidatoDeslocamento.membro_id)?.nome ?? candidatoDeslocamento.membro_id;
          const idxRem = planoCel.alocacoes.findIndex(
            (a) => a.membro_id === candidatoDeslocamento.membro_id && a.ministerio_id === f.ministerio_id
          );
          if (idxRem === -1) continue;

          planoCel.alocacoes.splice(idxRem, 1);
          escalasContador.set(candidatoDeslocamento.membro_id, candidatoDeslocamento.count - 1);

          planoCel.alocacoes.push({ membro_id: m.id, ministerio_id: f.ministerio_id });
          escalasContador.set(m.id, 1);
          planoCel.alertas.push(
            `ℹ ${m.nome} adicionado(a) por cobertura mínima (substituiu ${nome} que possui outras escalas no mês).`
          );
          todosAlertasGlobais.push(
            `ℹ "${planoCel.cel.titulo}" (${planoCel.cel.data}): ${m.nome} adicionado(a) por cobertura mínima.`
          );
          celComDeslocamento.add(planoCel.cel.data + planoCel.cel.titulo);
          deslocou = true;
          break;
        }
      }
    }

    // ── Sumário ──
    const membroEscalas = escalasContador;

    const distribuicao = membros
      .filter((m) => membroEscalas.has(m.id) || (membroOportunidades.get(m.id) ?? 0) > 0)
      .map((m) => ({
        id:           m.id,
        nome:         m.nome,
        count:        membroEscalas.get(m.id) ?? 0,
        oportunidades: membroOportunidades.get(m.id) ?? 0,
        taxa: (() => {
          const op = membroOportunidades.get(m.id) ?? 0;
          const sc = membroEscalas.get(m.id) ?? 0;
          return op > 0 ? sc / op : 0;
        })(),
      }))
      .sort((a, b) => b.count - a.count);

    // Membros com oportunidades reais mas que ainda ficaram com 0 escalas (após deslocamento)
    const membrosElegiveisSemEscala: MembroCobertura[] = distribuicao
      .filter((d) => d.count === 0 && d.oportunidades > 0)
      .map((d) => ({
        id: d.id,
        nome: d.nome,
        escalas: d.count,
        oportunidades: d.oportunidades,
        taxa: d.taxa,
        motivo_sem_escala:
          "Todas as vagas compatíveis estavam ocupadas por membros sem disponibilidade para deslocamento.",
      }));

    // Membros verdadeiramente inelegíveis: ativos mas sem oportunidade válida no período
    const membrosInelegiveis: MembroCobertura[] = membros
      .filter((m) => !membroEscalas.has(m.id) && (membroOportunidades.get(m.id) ?? 0) === 0)
      .map((m) => {
        // Determina o motivo objetivo
        const temVinculo = preVisualizacao.some((cel) =>
          cel.funcoes.some((f) => membroPara[m.id]?.includes(f.ministerio_id))
        );
        const todasIndisp = temVinculo && preVisualizacao
          .filter((cel) => cel.funcoes.some((f) => membroPara[m.id]?.includes(f.ministerio_id)))
          .every((cel) => {
            const diaSemana = new Date(cel.data + "T12:00:00").getDay();
            if (m.restricoes_dia_semana?.includes(diaSemana)) return true;
            const missaCel = missasPadrao.find((mp) => mp.id === cel.missaPadraoId);
            const restDiaCel = cel.esporadico
              ? missasPadrao
                  .filter((mp) => mp.recorrencia?.tipo !== "esporadico" && mp.dia_semana === diaSemana)
                  .flatMap((mp) => (membroMissaRestricoes[mp.id] ?? []).map((mid) => ({ membro_id: mid, data: cel.data })))
              : (missaCel ? (membroMissaRestricoes[missaCel.id] ?? []) : [])
                  .map((mid) => ({ membro_id: mid, data: cel.data }));
            return membroEstaBloqueado(m.id, cel.data, [...indisponibilidades, ...(restDiaCel as IndispRow[])]);
          });
        const motivo = !temVinculo
          ? "Sem vínculo com nenhuma função presente no período."
          : todasIndisp
          ? "Indisponível ou com restrição em todas as celebrações compatíveis."
          : "Sem oportunidade válida no período.";
        return { id: m.id, nome: m.nome, escalas: 0, oportunidades: 0, taxa: 0, motivo_sem_escala: motivo };
      });

    const totalFuncoes    = plano.filter((p) => !p.semFuncoes).reduce((s, p) => s + p.cel.funcoes.reduce((a, f) => a + f.quantidade, 0), 0);
    const funcoesVagasNum = plano.filter((p) => !p.semFuncoes).reduce((s, p) => s + p.funcoesVagas.reduce((a, f) => a + (f.solicitados - f.alocados), 0), 0);
    const celebracoesIncompletas = plano.filter((p) => !p.semFuncoes && p.funcoesVagas.length > 0).length;

    return {
      plano,
      sumario: {
        totalCelebracoes:         plano.length,
        celebracoesCompletas:     plano.filter((p) => !p.semFuncoes && p.funcoesVagas.length === 0).length,
        celebracoesIncompletas,
        celebracoesSemFuncoes:    plano.filter((p) => p.semFuncoes).length,
        totalFuncoes,
        funcoesPreenchidas:       totalFuncoes - funcoesVagasNum,
        funcoesVagas:             funcoesVagasNum,
        membrosEscalados:         membroEscalas.size,
        membrosElegiveisSemEscala,
        membrosInelegiveis,
        distribuicao,
        alertas:                  todosAlertasGlobais,
      },
    };
  }

  // ── Simulação (sem DB) ────────────────────────────────────────────────────
  const simularMutation = useMutation({
    mutationFn: async () => computarPlano(),
    onSuccess: (resultado) => setSimulacao(resultado),
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  // ── Commit (grava no banco usando o plano da simulação) ───────────────────
  const gerarMutation = useMutation({
    mutationFn: async () => {
      const sim = simulacao ?? computarPlano();
      const total = sim.plano.length;
      setProgresso({ atual: 0, total });

      let criadas   = 0;
      let ignoradas = 0;
      let totalSugestoes        = 0;
      let totalVagasSolicitadas = 0;
      const funcoesVagasRelatorio: FuncaoVagaDetalhe[] = [];
      const celebracoesSemFuncoes: { titulo: string; data: string }[] = [];
      const todosAlertas: string[] = [];

      for (let i = 0; i < sim.plano.length; i++) {
        const { cel, alocacoes, funcoesVagas, semFuncoes, alertas } = sim.plano[i];
        todosAlertas.push(...alertas);

        if (semFuncoes) {
          celebracoesSemFuncoes.push({ titulo: cel.titulo, data: cel.data });
          setProgresso({ atual: i + 1, total });
          continue;
        }

        // Idempotência: verifica se já existe escala para este slot
        const baseQuery = (supabase as any)
          .from("escalas")
          .select("id")
          .eq("paroquia_id", paroquiaId)
          .eq("data", cel.data)
          .eq("titulo", cel.titulo);
        const { data: existing } = await (
          cel.hora_inicio != null
            ? baseQuery.eq("hora_inicio", cel.hora_inicio)
            : baseQuery.is("hora_inicio", null)
        ).limit(1);

        if (existing && existing.length > 0) {
          const escalaId = existing[0].id;
          // Verifica se já tem funções E membros — só pula se ambos existirem
          const [{ data: funcExist }, { data: membExist }] = await Promise.all([
            (supabase as any).from("escala_funcoes").select("id").eq("escala_id", escalaId).limit(1),
            (supabase as any).from("escala_membros").select("id").eq("escala_id", escalaId).eq("ativo", true).limit(1),
          ]);
          const temFuncoes = funcExist && funcExist.length > 0;
          const temMembros = membExist && membExist.length > 0;

          if (!temFuncoes) {
            // Sem funções: salva funções + membros
            const { error: fErr2 } = await (supabase as any).from("escala_funcoes").insert(
              cel.funcoes.map((f) => ({ escala_id: escalaId, ministerio_id: f.ministerio_id, quantidade: f.quantidade }))
            );
            if (fErr2) throw new Error(`Erro ao salvar funções de "${cel.titulo}" (${cel.data}): ${fErr2.message}`);
            if (alocacoes.length > 0) {
              const { error: bErr2 } = await (supabase as any).from("escala_membros").upsert(
                alocacoes.map((s) => ({ escala_id: escalaId, membro_id: s.membro_id, ministerio_id: s.ministerio_id, status: "pendente", ativo: true, removido_em: null })),
                { onConflict: "escala_id,membro_id,ministerio_id" }
              );
              if (bErr2) throw new Error(`Erro ao salvar membros de "${cel.titulo}" (${cel.data}): ${bErr2.message}`);
              totalSugestoes += alocacoes.length;
            }
            criadas++;
          } else if (!temMembros && alocacoes.length > 0) {
            // Tem funções mas sem membros: recupera salvando os membros desta geração
            const { error: bErr3 } = await (supabase as any).from("escala_membros").upsert(
              alocacoes.map((s) => ({ escala_id: escalaId, membro_id: s.membro_id, ministerio_id: s.ministerio_id, status: "pendente", ativo: true, removido_em: null })),
              { onConflict: "escala_id,membro_id,ministerio_id" }
            );
            if (bErr3) throw new Error(`Erro ao recuperar membros de "${cel.titulo}" (${cel.data}): ${bErr3.message}`);
            totalSugestoes += alocacoes.length;
            criadas++;
          } else {
            ignoradas++;
          }
          setProgresso({ atual: i + 1, total });
          continue;
        }

        const { data: newEscala, error } = await (supabase as any)
          .from("escalas")
          .insert({
            paroquia_id:   paroquiaId,
            titulo:        cel.titulo,
            data:          cel.data,
            hora_inicio:   cel.hora_inicio,
            local:         cel.local,
            tipo:          cel.tipo,
            tipo_missa_id: cel.tipo_missa_id,
            solene:        cel.solene,
            tem_adoracao:  cel.tem_adoracao,
            tem_bispo:     cel.tem_bispo,
            status:        "rascunho",
            created_by:    profileId,
          })
          .select("id")
          .single();

        if (error || !newEscala) {
          if ((error as any)?.code === "23505") { ignoradas++; }
          setProgresso({ atual: i + 1, total });
          continue;
        }
        criadas++;

        // Grava funções
        const { error: fErr } = await (supabase as any).from("escala_funcoes").insert(
          cel.funcoes.map((f) => ({ escala_id: newEscala.id, ministerio_id: f.ministerio_id, quantidade: f.quantidade }))
        );
        if (fErr) throw new Error(`Erro ao salvar funções de "${cel.titulo}" (${cel.data}): ${fErr.message}`);
        cel.funcoes.forEach((f) => { totalVagasSolicitadas += f.quantidade; });

        // Grava membros do plano
        if (alocacoes.length > 0) {
          const { error: bErr } = await (supabase as any).from("escala_membros").upsert(
            alocacoes.map((s) => ({ escala_id: newEscala.id, membro_id: s.membro_id, ministerio_id: s.ministerio_id, status: "pendente", ativo: true, removido_em: null })),
            { onConflict: "escala_id,membro_id,ministerio_id" }
          );
          if (bErr) throw new Error(`Erro ao salvar membros de "${cel.titulo}" (${cel.data}): ${bErr.message}`);
          totalSugestoes += alocacoes.length;
        }

        funcoesVagasRelatorio.push(...funcoesVagas);
        setProgresso({ atual: i + 1, total });
      }

      return {
        criadas,
        ignoradas,
        vagasPreenchidas:     totalSugestoes,
        vagasNaoPreenchidas:  Math.max(0, totalVagasSolicitadas - totalSugestoes),
        distribuicao:         sim.sumario.distribuicao,
        funcoesVagas:         funcoesVagasRelatorio,
        celebracoesSemFuncoes,
        alertas:              [...new Set(todosAlertas)],
      } satisfies Relatorio;
    },
    onSuccess: (resultado) => {
      setRelatorio(resultado);
      setPasso(5);
      onSuccess();
    },
    onError: (e: unknown) => toast.error(supabaseErrorMessage(e)),
  });

  // ── Métricas do resumo ────────────────────────────────────────────────────
  const totalVagas = preVisualizacao.reduce(
    (acc, c) => acc + c.funcoes.reduce((a, f) => a + f.quantidade, 0), 0
  );
  const membrosElegiveis = useMemo(
    () => new Set(Object.values(membroMinisterios).flat()).size,
    [membroMinisterios]
  );

  // P2.1 — Contagem do período filtra por missas selecionadas
  const missasNoPeriodo = useMemo(() => {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return 0;
    const start   = new Date(dataInicio + "T00:00:00");
    const end     = new Date(dataFim   + "T00:00:00");
    const selected = missasSelecionadas.size > 0 ? missasSelecionadas : new Set(missasPadrao.map((m) => m.id));
    let count = 0;
    for (const missa of missasPadrao) {
      if (!selected.has(missa.id)) continue;
      const cur = new Date(start);
      while (cur <= end) {
        if (cur.getDay() === missa.dia_semana && passaRecorrencia(cur, missa.recorrencia)) count++;
        cur.setDate(cur.getDate() + 1);
      }
    }
    return count;
  }, [dataInicio, dataFim, missasPadrao, missasSelecionadas]);

  // Conflitos agrupados por motivo (para exibição no passo 4)
  const conflitosAgrupados = useMemo(() => {
    const groups: Partial<Record<MotivoConflito, ConflitoPotencial[]>> = {};
    for (const c of conflitos) {
      if (!groups[c.motivo]) groups[c.motivo] = [];
      groups[c.motivo]!.push(c);
    }
    return groups;
  }, [conflitos]);

  // Paginação do step 3
  const totalPaginas  = Math.ceil(preVisualizacao.length / PAGE_SIZE);
  const itemsPagina   = preVisualizacao.slice(paginaAtual * PAGE_SIZE, (paginaAtual + 1) * PAGE_SIZE);

  const periodoValido = !!dataInicio && !!dataFim && dataInicio <= dataFim;
  const emGeracao     = gerarMutation.isPending || simularMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          // P0.2 — bloquear fechamento durante geração
          if (!o && emGeracao) return;
          if (!o) onClose();
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[96vh] flex flex-col p-0 gap-0">
          {/* Cabeçalho */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b shrink-0">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <div>
                <h2 className="text-sm font-semibold leading-tight">
                  {passo === 5 ? "Relatório de geração" : "Assistente de Geração"}
                </h2>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {passo === 5 ? "Escalas criadas como rascunho · sem notificações" : "Cria escalas em rascunho · sem notificações"}
                </p>
              </div>
            </div>
            <StepIndicator atual={passo} />
          </div>

          {/* Corpo */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
            {/* Banner última config */}
            {sugerirUltimaConfig && ultimaConfig && passo === 1 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-xs font-semibold text-primary mb-0.5">Usar última configuração?</p>
                <p className="text-xs text-muted-foreground mb-2.5">
                  {ultimaConfig.periodo.dataInicio.split("-").reverse().join("/")} →{" "}
                  {ultimaConfig.periodo.dataFim.split("-").reverse().join("/")} · {ultimaConfig.missasSelecionadas.length} missas
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs px-3" onClick={aplicarUltimaConfig}>Usar</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-3" onClick={recusarUltimaConfig}>Começar do zero</Button>
                </div>
              </div>
            )}

            {/* ── Passo 1: Período ── */}
            {passo === 1 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Selecionar período</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Defina o intervalo para geração das escalas.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { tipo: "proxima_semana",   label: "Próxima semana",   sub: "7 dias"  },
                    { tipo: "proximos_15_dias",  label: "Próximos 15 dias", sub: "15 dias" },
                    { tipo: "proximo_mes",        label: "Próximo mês",      sub: "30 dias" },
                    { tipo: "personalizado",      label: "Personalizado",    sub: "Escolha" },
                  ].map((op) => (
                    <button key={op.tipo}
                      onClick={() => { setTipoPeriodo(op.tipo); if (op.tipo !== "personalizado") aplicarPeriodoRapido(op.tipo); }}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        tipoPeriodo === op.tipo ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"
                      }`}>
                      <div className="text-xs font-semibold leading-tight">{op.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{op.sub}</div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Data inicial</Label>
                    <input type="date" value={dataInicio}
                      onChange={(e) => { setDataInicio(e.target.value); setTipoPeriodo("personalizado"); }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Data final</Label>
                    <input type="date" value={dataFim}
                      onChange={(e) => { setDataFim(e.target.value); setTipoPeriodo("personalizado"); }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" />
                  </div>
                </div>
                {periodoValido && (
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{missasNoPeriodo}</span> ocorrência(s) previstas com as missas selecionadas
                  </div>
                )}
                {dataInicio && dataFim && dataInicio > dataFim && (
                  <p className="text-xs text-destructive">A data final deve ser após a data inicial.</p>
                )}
              </div>
            )}

            {/* ── Passo 2: Missas ── */}
            {passo === 2 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Selecionar missas padrão</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Apenas as missas marcadas serão incluídas.</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setMissasSelecionadas(new Set(missasPadrao.map((m) => m.id)))}>Selecionar todas</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setMissasSelecionadas(new Set())}>Desmarcar todas</Button>
                </div>
                {missasPadrao.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-10 text-center">
                    <p className="text-sm text-muted-foreground">Nenhuma Missa Padrão cadastrada.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {missasPadrao.map((missa) => {
                      const sel = missasSelecionadas.has(missa.id);
                      return (
                        <label key={missa.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all ${sel ? "border-primary/40 bg-primary/5" : "border-border hover:border-border/80 bg-card"}`}>
                          <Checkbox checked={sel}
                            onCheckedChange={(checked) => {
                              const next = new Set(missasSelecionadas);
                              if (checked) next.add(missa.id); else next.delete(missa.id);
                              setMissasSelecionadas(next);
                            }} className="mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{missa.nome}</span>
                              {missa.solene && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Solene</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {DIA_SEMANA_NOME[missa.dia_semana]}
                              {missa.hora_inicio && ` · ${missa.hora_inicio.slice(0, 5)}`}
                              {missa.local && ` · ${missa.local}`}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                {missasSelecionadas.size === 0 && missasPadrao.length > 0 && (
                  <p className="text-xs text-destructive">Selecione ao menos uma missa para continuar.</p>
                )}
              </div>
            )}

            {/* ── Passo 3: Pré-visualização ── */}
            {passo === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Pré-visualização</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preVisualizacao.length} celebração(ões) · clique em Editar para ajustar individualmente
                    </p>
                  </div>
                </div>
                {preVisualizacao.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-12 text-center">
                    <p className="text-sm text-muted-foreground">Nenhuma celebração no período.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {itemsPagina.map((cel, relIdx) => {
                        const absIdx = paginaAtual * PAGE_SIZE + relIdx;
                        return (
                          <div key={cel._id} className="rounded-xl border border-border bg-card px-4 py-3">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold leading-snug">{cel.titulo}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {format(new Date(cel.data + "T00:00:00"), "EEEE, dd/MM/yyyy", { locale: ptBR })}
                                  {cel.hora_inicio && ` · ${cel.hora_inicio.slice(0, 5)}`}
                                  {cel.local && ` · ${cel.local}`}
                                </p>
                                {cel.funcoes.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {cel.funcoes.map((f) => (
                                      <span key={f.ministerio_id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: f.ministerio_cor }} />
                                        {f.ministerio_nome} × {f.quantidade}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {cel.funcoes.length === 0 && (
                                  <p className="text-[10px] text-red-600 dark:text-red-400 font-medium mt-1">
                                    ⚠ Sem funções configuradas — esta missa será ignorada na geração. Configure as funções em Configurações → Missas.
                                  </p>
                                )}
                              </div>
                              <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0 -mr-1"
                                onClick={() => setEditandoIdx(absIdx)}>
                                <Pencil className="h-3 w-3 mr-1" />Editar
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* P2.1 — Paginação */}
                    {totalPaginas > 1 && (
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          disabled={paginaAtual === 0} onClick={() => setPaginaAtual((p) => p - 1)}>
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {paginaAtual + 1} / {totalPaginas}
                        </span>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPaginaAtual((p) => p + 1)}>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Passo 4: Simulação + Confirmação ── */}
            {passo === 4 && (
              <div className="space-y-4">
                {/* Progresso do commit */}
                {emGeracao ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold">Gravando escalas…</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Aguarde a conclusão do processo.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="relative h-2.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{progresso.atual} de {progresso.total} celebrações</span>
                        <span className="font-semibold text-foreground">
                          {progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-3 py-2">
                      <p className="text-xs text-amber-700 dark:text-amber-400">Não feche esta janela durante a gravação.</p>
                    </div>
                  </div>
                ) : simularMutation.isPending ? (
                  <div className="flex items-center justify-center py-10 gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Simulando geração…</span>
                  </div>
                ) : simulacao ? (
                  /* Resultado da simulação */
                  <>
                    <div>
                      <h3 className="text-sm font-semibold">Resultado da simulação</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Revise antes de gravar as escalas no banco.</p>
                    </div>

                    {/* Métricas da simulação */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { label: "Celebrações",    value: simulacao.sumario.totalCelebracoes,         color: "" },
                        { label: "Completas",       value: simulacao.sumario.celebracoesCompletas,     color: "text-green-600 dark:text-green-400" },
                        { label: "Incompletas",     value: simulacao.sumario.celebracoesIncompletas,   color: simulacao.sumario.celebracoesIncompletas > 0 ? "text-amber-600" : "" },
                        { label: "Sem funções",     value: simulacao.sumario.celebracoesSemFuncoes,    color: simulacao.sumario.celebracoesSemFuncoes > 0 ? "text-red-600" : "" },
                        { label: "Vagas preench.",  value: simulacao.sumario.funcoesPreenchidas,       color: "text-primary" },
                        { label: "Vagas em aberto", value: simulacao.sumario.funcoesVagas,             color: simulacao.sumario.funcoesVagas > 0 ? "text-amber-600" : "" },
                      ].map((item) => (
                        <div key={item.label} className="rounded-xl border border-border bg-muted/30 px-2 py-2.5 text-center">
                          <div className={`text-base font-bold tabular-nums ${item.color}`}>{item.value}</div>
                          <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{item.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Funções sem candidatos */}
                    {simulacao.sumario.celebracoesSemFuncoes > 0 && (
                      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                          <span className="text-xs font-semibold text-red-800 dark:text-red-300">
                            {simulacao.sumario.celebracoesSemFuncoes} celebração(ões) sem funções configuradas
                          </span>
                        </div>
                        <div className="space-y-0.5 ml-6 max-h-24 overflow-y-auto">
                          {simulacao.plano.filter((p) => p.semFuncoes).map((p, i) => (
                            <p key={i} className="text-xs text-red-700 dark:text-red-400">
                              {p.cel.data.split("-").reverse().join("/")} — {p.cel.titulo}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Funções vagas */}
                    {simulacao.sumario.funcoesVagas > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                            {simulacao.sumario.funcoesVagas} vaga(s) não preenchida(s)
                          </span>
                        </div>
                        <div className="space-y-1 ml-6 max-h-36 overflow-y-auto">
                          {simulacao.plano.flatMap((p) => p.funcoesVagas).map((fv, i) => (
                            <div key={i} className="text-xs text-amber-700 dark:text-amber-400">
                              <span className="font-medium">{fv.data.split("-").reverse().join("/")} · {fv.celebracao}</span>
                              {" — "}{fv.ministerio_nome}: {fv.alocados}/{fv.solicitados}
                              {fv.motivo && <span className="text-amber-600/80"> ({fv.motivo})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Membros elegíveis sem escala (têm oportunidades mas não foram alocados) */}
                    {simulacao.sumario.membrosElegiveisSemEscala.length > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                            {simulacao.sumario.membrosElegiveisSemEscala.length} membro(s) elegível(is) sem escala
                          </span>
                        </div>
                        <div className="space-y-1 ml-6 max-h-32 overflow-y-auto">
                          {simulacao.sumario.membrosElegiveisSemEscala.map((m) => (
                            <div key={m.id}>
                              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{m.nome}</p>
                              <p className="text-[11px] text-muted-foreground">{m.motivo_sem_escala ?? `${m.oportunidades} oportunidade(s) disponível(is)`}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Membros inelegíveis: sem oportunidade objetiva no período */}
                    {simulacao.sumario.membrosInelegiveis.length > 0 && (
                      <div className="rounded-xl border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-xs font-semibold">
                            {simulacao.sumario.membrosInelegiveis.length} membro(s) sem oportunidade no período
                          </span>
                        </div>
                        <div className="space-y-1 ml-6 max-h-24 overflow-y-auto">
                          {simulacao.sumario.membrosInelegiveis.map((m) => (
                            <div key={m.id}>
                              <p className="text-xs text-muted-foreground">{m.nome}</p>
                              <p className="text-[11px] text-muted-foreground/70">{m.motivo_sem_escala}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Distribuição */}
                    {simulacao.sumario.distribuicao.length > 0 && (
                      <div className="rounded-xl border border-border bg-card">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b">
                          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                          <p className="text-xs font-semibold">Distribuição simulada</p>
                          <span className="ml-auto text-[10px] text-muted-foreground">{simulacao.sumario.membrosEscalados} escalado(s)</span>
                        </div>
                        <div className="divide-y max-h-40 overflow-y-auto">
                          {simulacao.sumario.distribuicao.filter((d) => d.count > 0).map((m) => (
                            <div key={m.id} className="flex items-center justify-between px-4 py-1.5">
                              <span className="text-xs truncate flex-1">{m.nome}</span>
                              <span className="ml-2 text-[10px] text-muted-foreground tabular-nums shrink-0">
                                {m.oportunidades} oport.
                              </span>
                              <span className="ml-2 text-xs font-semibold tabular-nums text-primary shrink-0">
                                {m.count}×
                              </span>
                              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground shrink-0">
                                ({Math.round(m.taxa * 100)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                      <p className="text-xs text-primary leading-relaxed">
                        <span className="font-semibold">As escalas serão criadas como rascunho.</span>{" "}
                        Nenhuma notificação será enviada. Publique manualmente quando estiver pronto.
                      </p>
                    </div>
                  </>
                ) : (
                  /* Estado inicial: ainda não simulou */
                  <>
                    <div>
                      <h3 className="text-sm font-semibold">Simular geração</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Execute a simulação para ver o resultado antes de gravar as escalas.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: "Período",              value: `${dataInicio.split("-").reverse().slice(0,2).join("/")} → ${dataFim.split("-").reverse().slice(0,2).join("/")}` },
                        { label: "Celebrações",          value: preVisualizacao.length },
                        { label: "Vagas totais",         value: totalVagas },
                        { label: "Membros elegíveis",    value: membrosElegiveis },
                      ].map((item) => (
                        <div key={item.label} className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-center">
                          <div className="text-lg font-bold tabular-nums">{item.value}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{item.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-border bg-muted/20 p-4">
                      <p className="text-xs font-semibold text-foreground mb-2.5">Motor V3 — regras aplicadas</p>
                      <div className="space-y-1.5">
                        {[
                          "Motor único para missas comuns e solenidades",
                          "Funções escassas alocadas primeiro",
                          "Histórico compartilhado durante toda a geração",
                          "Bloqueio de conflito no mesmo dia (hard-block)",
                          "Limites semanal/mensal (pool progressivo)",
                          "Penalidade por repetição consecutiva",
                          "Rodízio por dias sem servir",
                        ].map((r) => (
                          <div key={r} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-green-500 shrink-0" />{r}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Passo 5: Relatório pós-geração ── */}
            {passo === 5 && relatorio && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold">Geração concluída</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Revise as escalas e publique quando estiver pronto.
                  </p>
                </div>

                {/* Métricas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Criadas",           value: relatorio.criadas,            color: "text-green-600 dark:text-green-400" },
                    { label: "Ignoradas (já existiam)", value: relatorio.ignoradas,    color: "text-muted-foreground" },
                    { label: "Vagas preenchidas", value: relatorio.vagasPreenchidas,   color: "text-primary" },
                    { label: "Vagas em aberto",   value: relatorio.vagasNaoPreenchidas, color: relatorio.vagasNaoPreenchidas > 0 ? "text-amber-600" : "text-muted-foreground" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-center">
                      <div className={`text-lg font-bold tabular-nums ${item.color}`}>{item.value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* Distribuição por membro */}
                {relatorio.distribuicao.filter((d) => d.count > 0).length > 0 && (
                  <div className="rounded-xl border border-border bg-card">
                    <div className="flex items-center gap-2 px-4 py-3 border-b">
                      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-xs font-semibold">Distribuição por membro</p>
                      <span className="ml-auto text-[10px] text-muted-foreground">{relatorio.distribuicao.filter((d) => d.count > 0).length} escalado(s)</span>
                    </div>
                    <div className="divide-y max-h-56 overflow-y-auto">
                      {relatorio.distribuicao.filter((d) => d.count > 0).map((m) => (
                        <div key={m.id} className="flex items-center justify-between px-4 py-2 gap-2">
                          <span className="text-xs truncate flex-1">{m.nome}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{m.oportunidades} oport.</span>
                          <span className="text-xs font-semibold tabular-nums text-primary shrink-0">{m.count}×</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">({Math.round(m.taxa * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Membros elegíveis sem escala — após cobertura e deslocamento */}
                {relatorio.distribuicao.filter((d) => d.count === 0 && d.oportunidades > 0).length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {relatorio.distribuicao.filter((d) => d.count === 0 && d.oportunidades > 0).length} membro(s) elegível(is) sem escala
                      </p>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Todos os slots compatíveis estavam ocupados por membros sem disponibilidade para deslocamento:{" "}
                      {relatorio.distribuicao.filter((d) => d.count === 0 && d.oportunidades > 0).slice(0, 5).map((d) => d.nome).join(", ")}
                      {relatorio.distribuicao.filter((d) => d.count === 0 && d.oportunidades > 0).length > 5 && ` e mais ${relatorio.distribuicao.filter((d) => d.count === 0 && d.oportunidades > 0).length - 5}`}
                    </p>
                  </div>
                )}

                {/* Celebrações sem funções */}
                {relatorio.celebracoesSemFuncoes.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                      <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                        {relatorio.celebracoesSemFuncoes.length} celebração(ões) sem funções — não foram geradas
                      </p>
                    </div>
                    <p className="text-xs text-red-700 dark:text-red-400">
                      {relatorio.celebracoesSemFuncoes.slice(0, 3).map((c) => `${c.data.split("-").reverse().join("/")} ${c.titulo}`).join(", ")}
                      {relatorio.celebracoesSemFuncoes.length > 3 && ` e mais ${relatorio.celebracoesSemFuncoes.length - 3}`}
                    </p>
                  </div>
                )}

                {relatorio.vagasNaoPreenchidas > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {relatorio.vagasNaoPreenchidas} vaga(s) em aberto
                      </p>
                    </div>
                    <div className="space-y-0.5 ml-6 max-h-28 overflow-y-auto">
                      {relatorio.funcoesVagas.slice(0, 10).map((fv, i) => (
                        <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                          {fv.data.split("-").reverse().join("/")} · {fv.celebracao} — {fv.ministerio_nome}: {fv.alocados}/{fv.solicitados}
                          {fv.motivo && <span className="text-amber-600/80"> ({fv.motivo})</span>}
                        </p>
                      ))}
                      {relatorio.funcoesVagas.length > 10 && (
                        <p className="text-xs text-amber-500">…e mais {relatorio.funcoesVagas.length - 10}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-t bg-muted/20 shrink-0">
            {/* Botão esquerdo */}
            {passo < 5 ? (
              <Button variant="outline" size="sm" className="h-8"
                disabled={emGeracao}
                onClick={() => { if (passo > 1) setPasso(passo - 1); else onClose(); }}>
                {passo === 1 ? <><X className="h-3.5 w-3.5 mr-1" />Cancelar</> : <><ChevronLeft className="h-3.5 w-3.5 mr-1" />Voltar</>}
              </Button>
            ) : (
              <div /> /* alinha botão direito à direita no passo 5 */
            )}

            {/* Botão direito */}
            {passo < 4 && (
              <Button size="sm" className="h-8"
                disabled={
                  (passo === 1 && !periodoValido) ||
                  (passo === 2 && missasSelecionadas.size === 0) ||
                  (passo === 3 && preVisualizacao.length === 0)
                }
                onClick={() => {
                  if (passo === 1) avancarPara2();
                  else if (passo === 2) avancarPara3();
                  else if (passo === 3) avancarParaResumo();
                }}>
                Próximo {/* P2.1: era "Revisar" no step 3, agora sempre "Próximo" */}
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}

            {passo === 4 && !emGeracao && !simularMutation.isPending && !simulacao && (
              <Button size="sm" className="h-8"
                disabled={preVisualizacao.length === 0}
                onClick={() => simularMutation.mutate()}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Simular
              </Button>
            )}
            {passo === 4 && !emGeracao && !simularMutation.isPending && simulacao && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8"
                  onClick={() => setSimulacao(null)}>
                  Refazer simulação
                </Button>
                <Button size="sm" className="h-8"
                  onClick={() => gerarMutation.mutate()}>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Confirmar e gravar
                </Button>
              </div>
            )}

            {passo === 5 && (
              <Button size="sm" className="h-8" onClick={() => onClose()}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Concluir
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de edição de celebração */}
      {editandoIdx !== null && preVisualizacao[editandoIdx] && (
        <ModalEdicaoCelebracao
          celebracao={preVisualizacao[editandoIdx]}
          ministerios={ministerios}
          onSave={(updated) => {
            setPreVisualizacao((prev) => prev.map((c, i) => i === editandoIdx ? updated : c));
            setEditandoIdx(null);
          }}
          onClose={() => setEditandoIdx(null)}
        />
      )}
    </>
  );
}
