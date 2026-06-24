// ═══════════════════════════════════════════════════════════════════════════════
// Motor de Escalas V3 — Lumen Pastoral
// Algoritmo configurável, sem hardcodes de função/paróquia.
// Dois modos de scoring: equidade (escalas comuns) e mérito+rodízio (solenidades/funções principais).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type MembroEngine = {
  id: string;
  nome: string;
  score: number;
  ativo: boolean;
  /** @deprecated use preferenciaisSolene param em alocarMembros. Mantido para compatibilidade. */
  forcar_escalacao_solene?: boolean;
  ministerio_ids: string[];
  funcoes_nao_pode_ids?: string[];
  restricoes_dia_semana?: number[];
  atuacao_ids?: string[];
  sexo?: "M" | "F" | null;
  prioridade_escala?: string;
};

export type IndisponibilidadeEngine = {
  membro_id: string;
  data: string;
  tipo?: string;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  data_fim?: string | null;
};

export type FuncaoNecessaria = {
  ministerio_id: string;
  ministerio_nome: string;
  quantidade: number;
  atuacoes_exigidas?: string[];
  /** normal = equilíbrio primeiro; principal = experiência+rodízio em solenidades */
  relevancia?: "normal" | "principal";
  /** quando true, membro já alocado pode ser usado como fallback de último recurso */
  duplicidade_permitida?: boolean;
  /** menor = processado antes (funções mais importantes primeiro) */
  ordem_prioridade?: number;
};

export type ContextoEscala = {
  data: string;
  tipo: string;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
  paramentacao_obrigatoria?: boolean;
};

export type ConfigParoquia = {
  usa_tochas?: boolean;
  usa_turibulo?: boolean;
  usa_naveta?: boolean;
  usa_baculifero?: boolean;
  usa_mitrifero?: boolean;
  limite_semanal?: number;
  limite_mensal?: number;
  impedir_repeticao_seguida?: boolean;
  intervalo_minimo_dias?: number;
  /** @deprecated ignorado no V3 — relevancia por função substitui este flag global */
  prioridade_score?: boolean;
  prioridade_bonus_alto?: number;
  prioridade_bonus_medio?: number;
  distribuicao_masc_pct?: number;
  variedade_ministerio?: boolean;
  /** pts extras para membro marcado como preferencial em solenidades (padrão: 20) */
  bonus_preferencial_solene?: number;
};

/** Vínculo membro–função que confere bônus em solenidades (substitui Regra Jefferson) */
export type PreferencialSolene = {
  ministerio_id: string;
  membro_id: string;
};

export type MinisterioBase = {
  id: string;
  nome: string;
  ativo: boolean;
};

export type MembroAlocado = {
  membro_id: string;
  membro_nome: string;
  ministerio_id: string;
  forcado: boolean;
  motivo: string;
};

export type DetalheFuncao = {
  ministerio_id: string;
  ministerio_nome: string;
  solicitados: number;
  alocados: number;
  motivo_vazio?: string;
};

// ── Tipos de insight (diagnóstico detalhado) ──────────────────────────────────

export type ScoreBreakdown = {
  // Campos modo COMUM (equidade)
  tempo_sem_servir: number;
  participacao_recente: number;
  frequencia_historica: number;
  ranking_bonus: number;
  aleatoriedade: number;
  // Campos modo SOLENE_PRINCIPAL (mérito + rodízio)
  rotacao_funcao: number;
  experiencia_funcao: number;
  score_merito: number;
  bonus_preferencial: number;
  // Comuns
  penalidade: number;
  prioridade_bonus: number;
  total: number;
  modo: "comum" | "solene_principal";
};

export type InsightCandidato = {
  membro_id: string;
  nome: string;
  score_final: number;
  dias_sem_servir: number;
  participacoes_30d: number;
  participacoes_total: number;
  breakdown: ScoreBreakdown;
  escolhido: boolean;
  motivo_exclusao?: string;
};

export type InsightFuncao = {
  ministerio_id: string;
  ministerio_nome: string;
  solicitados: number;
  alocados: number;
  candidatos_avaliados: number;
  excluidos: {
    sem_vinculo: number;
    indisponibilidade: number;
    dia_semana: number;
    funcao_nao_pode: number;
    atuacao: number;
    ja_alocado: number;
    acima_limite: number;
  };
  top_candidatos: InsightCandidato[];
  escolhidos: InsightCandidato[];
  motivo_vazio?: string;
};

export type ResultadoAlocacao = {
  alocacoes: MembroAlocado[];
  alertas: string[];
  detalhesPorFuncao: DetalheFuncao[];
  insights: InsightFuncao[];
};

export type HistoricoRecente = {
  membro_id: string;
  ministerio_id: string;
  data: string;
};

// ── Constantes ────────────────────────────────────────────────────────────────

const CAP_DIAS_SEM_SERVIR   = 60;
const CAP_DIAS_ROTACAO_FUNC = 180;  // 6 meses = rodízio máximo para funções principais
const CAP_PARTICIPACOES_30D = 5;

const PENALIDADE_MESMO_DIA    = 50;
const PENALIDADE_DIA_ANTERIOR = 30;
const PENALIDADE_DOIS_DIAS    = 15;

// Termos litúrgicos universais para funções acessórias (não são específicos de nenhuma paróquia).
// Usados apenas em getFuncoesAdicionais — nunca para decisões de alocação.
const TERMOS_ACESSORIOS: Record<string, string[]> = {
  turibulo:   ["turíbulo", "turibulo", "incenso", "turifer", "turiferário"],
  naveta:     ["naveta", "naveteiro", "naviculário", "navicular"],
  tocha:      ["tocha", "torch", "archeiro"],
  baculifero: ["baculífero", "baculifero", "báculo", "baculo", "portador do báculo"],
  mitrifero:  ["mitrífero", "mitrifero", "mitra", "portador da mitra"],
};

// ── Utilitários ───────────────────────────────────────────────────────────────

function nomeContem(nome: string, termos: string[]): boolean {
  const lower = nome.toLowerCase();
  return termos.some((t) => lower.includes(t));
}

function dateDiffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) /
    86_400_000,
  );
}

function somarDias(data: string, dias: number): string {
  const d = new Date(data + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function estaIndisponivel(
  membro_id: string,
  data: string,
  indisponibilidades: IndisponibilidadeEngine[],
): boolean {
  return indisponibilidades.some((i) => {
    if (i.membro_id !== membro_id) return false;
    if (i.tipo === "intervalo" && i.data_fim) {
      return data >= i.data && data <= i.data_fim;
    }
    return i.data === data;
  });
}

function ehDomingo(data: string): boolean {
  return new Date(data + "T12:00:00").getDay() === 0;
}

export function getDiaSemana(data: string): number {
  return new Date(data + "T12:00:00").getDay();
}

const TIPOS_SOLENES = new Set(["festa", "novena", "solenidade"]);

export function ehMissaSolene(tipo: string, solene: boolean, tem_bispo: boolean): boolean {
  return solene || tem_bispo || TIPOS_SOLENES.has((tipo ?? "").toLowerCase().trim());
}

export type NomeDiaSemana =
  | "Domingo" | "Segunda" | "Terça" | "Quarta"
  | "Quinta" | "Sexta" | "Sábado";

export const DIAS_SEMANA: NomeDiaSemana[] = [
  "Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado",
];

// ── isApto (utilitário para uso externo) ─────────────────────────────────────

export function isApto(
  membro: MembroEngine,
  ministerio_id: string,
  data: string,
  indisponibilidades: IndisponibilidadeEngine[],
  ja_alocados: Set<string>,
  atuacoes_exigidas?: string[],
): boolean {
  if (!membro.ativo) return false;
  if (!membro.ministerio_ids.includes(ministerio_id)) return false;
  if (ja_alocados.has(membro.id)) return false;
  if (estaIndisponivel(membro.id, data, indisponibilidades)) return false;
  if (membro.restricoes_dia_semana?.length && membro.restricoes_dia_semana.includes(getDiaSemana(data))) return false;
  if (membro.funcoes_nao_pode_ids?.includes(ministerio_id)) return false;
  if (atuacoes_exigidas?.length) {
    const memAtuacoes = membro.atuacao_ids ?? [];
    if (!atuacoes_exigidas.some((a) => memAtuacoes.includes(a))) return false;
  }
  return true;
}

// ── Estatísticas do grupo ─────────────────────────────────────────────────────

type GrupoStats = {
  maxTotal: number;
  maxRecente: number;
  maxDbScore: number;
  maxPorFuncao: Record<string, number>; // ministerio_id → count máximo do grupo
};

function computeGrupoStats(
  membros: MembroEngine[],
  historico: HistoricoRecente[],
  data30dAtras: string,
  dataEvento: string,
): GrupoStats {
  let maxTotal = 0, maxRecente = 0, maxDbScore = 0;
  const maxPorFuncao: Record<string, number> = {};

  for (const m of membros) {
    const hist = historico.filter((h) => h.membro_id === m.id && h.data < dataEvento);
    maxTotal   = Math.max(maxTotal, hist.length);
    maxRecente = Math.max(maxRecente, hist.filter((h) => h.data >= data30dAtras).length);
    maxDbScore = Math.max(maxDbScore, m.score);

    // Máximo por função (para normalizar experiência em modo solene_principal)
    for (const h of hist) {
      maxPorFuncao[h.ministerio_id] = Math.max(maxPorFuncao[h.ministerio_id] ?? 0, 1);
    }
  }
  // Segunda passagem: calcular máximo real por função
  for (const m of membros) {
    const hist = historico.filter((h) => h.membro_id === m.id && h.data < dataEvento);
    for (const funcao_id of Object.keys(maxPorFuncao)) {
      const cnt = hist.filter((h) => h.ministerio_id === funcao_id).length;
      maxPorFuncao[funcao_id] = Math.max(maxPorFuncao[funcao_id] ?? 0, cnt);
    }
  }

  return { maxTotal, maxRecente, maxDbScore, maxPorFuncao };
}

// ── calcularScore ─────────────────────────────────────────────────────────────
// Dois modos:
//   COMUM         → equilíbrio de oportunidades (qualquer função em escala normal)
//   SOLENE_PRINCIPAL → mérito + rodízio (funções com relevancia="principal" em solenidades)

function calcularScore(
  membro: MembroEngine,
  funcao: FuncaoNecessaria,
  historico: HistoricoRecente[],
  dataEvento: string,
  data30dAtras: string,
  stats: GrupoStats,
  modoSolenePrincipal: boolean,
  ehPreferencialSolene: boolean,
  config?: ConfigParoquia,
): ScoreBreakdown {
  const histMembro    = historico.filter((h) => h.membro_id === membro.id);
  const histAnterior  = histMembro.filter((h) => h.data < dataEvento);

  // Computações comuns
  const ultimaData = histAnterior.length > 0
    ? histAnterior.reduce((max, h) => h.data > max ? h.data : max, histAnterior[0].data)
    : null;
  const diasSemServir = ultimaData ? dateDiffDays(ultimaData, dataEvento) : 365;
  const count30d      = histMembro.filter((h) => h.data >= data30dAtras && h.data < dataEvento).length;

  // Penalidades por celebrações próximas (aplicadas em ambos os modos)
  const ontem      = somarDias(dataEvento, -1);
  const anteontem  = somarDias(dataEvento, -2);
  let penalidade = 0;
  const serviuHoje      = histMembro.some((h) => h.data === dataEvento);
  const serviuOntem     = histMembro.some((h) => h.data === ontem);
  const serviuAnteontem = histMembro.some((h) => h.data === anteontem);
  if (serviuHoje)       penalidade += PENALIDADE_MESMO_DIA;
  else if (serviuOntem)      penalidade += PENALIDADE_DIA_ANTERIOR;
  else if (serviuAnteontem)  penalidade += PENALIDADE_DOIS_DIAS;

  // Bonus prioridade_escala (ambos os modos)
  // Apenas "alta" e "media" são tiers genéricos reconhecidos — sem dependência de nomes de cargo.
  let prioridadeBonus = 0;
  const prio = membro.prioridade_escala;
  if (prio === "alta") {
    prioridadeBonus = config?.prioridade_bonus_alto ?? 15;
  } else if (prio === "media") {
    prioridadeBonus = config?.prioridade_bonus_medio ?? 8;
  }

  const breakdown: ScoreBreakdown = {
    tempo_sem_servir:   0,
    participacao_recente: 0,
    frequencia_historica: 0,
    ranking_bonus:      0,
    aleatoriedade:      0,
    rotacao_funcao:     0,
    experiencia_funcao: 0,
    score_merito:       0,
    bonus_preferencial: 0,
    penalidade:         Math.round(penalidade),
    prioridade_bonus:   Math.round(prioridadeBonus),
    total:              0,
    modo:               modoSolenePrincipal ? "solene_principal" : "comum",
  };

  let raw: number;

  if (modoSolenePrincipal) {
    // ── Modo SOLENE_PRINCIPAL: mérito + rodízio ─────────────────────────────
    // 1. Rodízio nesta função específica (35%) — dias desde última vez aqui
    const histNaFuncao = histAnterior.filter((h) => h.ministerio_id === funcao.ministerio_id);
    const ultimaNaFuncao = histNaFuncao.length > 0
      ? histNaFuncao.reduce((max, h) => h.data > max ? h.data : max, histNaFuncao[0].data)
      : null;
    const diasSemFuncao = ultimaNaFuncao ? dateDiffDays(ultimaNaFuncao, dataEvento) : 365;
    const rotacaoFuncao = Math.min(diasSemFuncao, CAP_DIAS_ROTACAO_FUNC) / CAP_DIAS_ROTACAO_FUNC * 100;

    // 2. Experiência nesta função (30%) — mais vezes = mais qualificado
    const totalNaFuncao   = histNaFuncao.length;
    const maxNaFuncao     = stats.maxPorFuncao[funcao.ministerio_id] ?? 1;
    const experienciaFuncao = maxNaFuncao > 0 ? (totalNaFuncao / maxNaFuncao) * 100 : 0;

    // 3. Score de mérito (25%) — maior score = melhor em solenidades
    const scoreMerito = stats.maxDbScore > 0 ? (membro.score / stats.maxDbScore) * 100 : 0;

    // 4. Participação geral recente (10%) — menos recente = melhor (rodízio)
    const participacaoGeral = Math.max(0, (1 - count30d / CAP_PARTICIPACOES_30D) * 100);

    // 5. Bônus preferencial solene (fixo, configurável)
    const bonusPreferencial = ehPreferencialSolene ? (config?.bonus_preferencial_solene ?? 20) : 0;

    raw = 0.35 * rotacaoFuncao + 0.30 * experienciaFuncao + 0.25 * scoreMerito + 0.10 * participacaoGeral;

    breakdown.rotacao_funcao    = Math.round(rotacaoFuncao);
    breakdown.experiencia_funcao = Math.round(experienciaFuncao);
    breakdown.score_merito      = Math.round(scoreMerito);
    breakdown.participacao_recente = Math.round(participacaoGeral);
    breakdown.bonus_preferencial = Math.round(bonusPreferencial);

    breakdown.total = Math.max(0, Math.min(100, Math.round(raw - penalidade + bonusPreferencial + prioridadeBonus)));

  } else {
    // ── Modo COMUM: equilíbrio de oportunidades ─────────────────────────────
    // 1. Participação recente 30d (40%) — menos = maior prioridade
    const participacaoRecente = Math.max(0, (1 - count30d / CAP_PARTICIPACOES_30D) * 100);

    // 2. Tempo sem servir qualquer função (30%) — mais = maior prioridade
    const tempoSemServir = Math.min(diasSemServir, CAP_DIAS_SEM_SERVIR) / CAP_DIAS_SEM_SERVIR * 100;

    // 3. Score de equidade (10%) — menor score = maior prioridade (redistribuição)
    const rankingBonus = stats.maxDbScore > 0 ? (1 - membro.score / stats.maxDbScore) * 100 : 0;

    // 4. Frequência histórica total (5%) — menos = maior prioridade
    const totalHist = histAnterior.length;
    const frequenciaHistorica = stats.maxTotal > 0 ? (1 - totalHist / stats.maxTotal) * 100 : 100;

    // 5. Aleatoriedade controlada (5%) — desempate e variedade
    const aleatoriedade = Math.random() * 100;

    raw = 0.40 * participacaoRecente + 0.30 * tempoSemServir + 0.10 * rankingBonus +
          0.05 * frequenciaHistorica + 0.05 * aleatoriedade;

    breakdown.participacao_recente = Math.round(participacaoRecente);
    breakdown.tempo_sem_servir     = Math.round(tempoSemServir);
    breakdown.ranking_bonus        = Math.round(rankingBonus);
    breakdown.frequencia_historica = Math.round(frequenciaHistorica);
    breakdown.aleatoriedade        = Math.round(aleatoriedade);

    breakdown.total = Math.max(0, Math.min(100, Math.round(raw - penalidade + prioridadeBonus)));
  }

  return breakdown;
}

// ── getFuncoesAdicionais ──────────────────────────────────────────────────────

export function getFuncoesAdicionais(
  contexto: ContextoEscala,
  funcoes_existentes: FuncaoNecessaria[],
  ministerios_disponiveis: MinisterioBase[],
  config: ConfigParoquia,
): FuncaoNecessaria[] {
  const adicionais: FuncaoNecessaria[] = [];
  const ids_existentes = new Set(funcoes_existentes.map((f) => f.ministerio_id));
  const domingo = ehDomingo(contexto.data);

  function addSeFaltando(termos: string[], quantidade: number) {
    const min = ministerios_disponiveis.find((m) => m.ativo && nomeContem(m.nome, termos));
    if (min && !ids_existentes.has(min.id)) {
      adicionais.push({ ministerio_id: min.id, ministerio_nome: min.nome, quantidade });
      ids_existentes.add(min.id);
    }
  }

  if (contexto.tem_adoracao && !domingo) {
    if (config.usa_turibulo !== false) addSeFaltando(TERMOS_ACESSORIOS.turibulo, 1);
    if (config.usa_naveta   !== false) addSeFaltando(TERMOS_ACESSORIOS.naveta, 1);
  }
  if (contexto.tem_bispo) {
    if (config.usa_baculifero !== false) addSeFaltando(TERMOS_ACESSORIOS.baculifero, 1);
    if (config.usa_mitrifero  !== false) addSeFaltando(TERMOS_ACESSORIOS.mitrifero, 1);
  }
  if (!config.usa_tochas) {
    return adicionais.filter((f) => !nomeContem(f.ministerio_nome, TERMOS_ACESSORIOS.tocha));
  }
  return adicionais;
}

// ── Pool helpers ──────────────────────────────────────────────────────────────

type LimitePools = {
  acimaLimiteSemanal: Set<string>;
  acimaLimiteMensal:  Set<string>;
};

function computeLimitePools(
  membros: MembroEngine[],
  historico: HistoricoRecente[],
  dataEvento: string,
  config?: ConfigParoquia,
): LimitePools {
  const acimaLimiteSemanal = new Set<string>();
  const acimaLimiteMensal  = new Set<string>();

  if (!config?.limite_semanal && !config?.limite_mensal) {
    return { acimaLimiteSemanal, acimaLimiteMensal };
  }

  const semanaInicio = somarDias(dataEvento, -6);
  const mesInicio    = somarDias(dataEvento, -30); // janela móvel 30d (não mês calendário)

  for (const m of membros) {
    const histM = historico.filter((h) => h.membro_id === m.id);

    if (config?.limite_semanal) {
      const cnt = histM.filter((h) => h.data >= semanaInicio && h.data < dataEvento).length;
      if (cnt >= config.limite_semanal) acimaLimiteSemanal.add(m.id);
    }
    if (config?.limite_mensal) {
      const cnt = histM.filter((h) => h.data >= mesInicio && h.data < dataEvento).length;
      if (cnt >= config.limite_mensal) acimaLimiteMensal.add(m.id);
    }
  }

  return { acimaLimiteSemanal, acimaLimiteMensal };
}

// ── alocarMembros ─────────────────────────────────────────────────────────────

export function alocarMembros(
  funcoes: FuncaoNecessaria[],
  membros: MembroEngine[],
  indisponibilidades: IndisponibilidadeEngine[],
  contexto: ContextoEscala,
  historicoRecente: HistoricoRecente[] = [],
  config?: ConfigParoquia,
  preferenciaisSolene: PreferencialSolene[] = [],
  incompatMap?: Map<string, Set<string>>,
): ResultadoAlocacao {
  const alocacoes:        MembroAlocado[]  = [];
  const alertas:          string[]         = [];
  const detalhesPorFuncao: DetalheFuncao[] = [];
  const insights:         InsightFuncao[]  = [];
  const ja_alocados = new Set<string>();

  const data30dAtras = somarDias(contexto.data, -30);
  const stats        = computeGrupoStats(membros, historicoRecente, data30dAtras, contexto.data);
  const ontemStr     = somarDias(contexto.data, -1);
  const ehSolene     = ehMissaSolene(contexto.tipo, contexto.solene, contexto.tem_bispo);

  const { acimaLimiteSemanal, acimaLimiteMensal } = computeLimitePools(membros, historicoRecente, contexto.data, config);

  // Compatibilidade retroativa: membros com forcar_escalacao_solene viram preferenciaisSolene
  // para todas as funções com relevancia=principal (sem hardcode de nome de função).
  const preferenciaisEfetivos: PreferencialSolene[] = [...preferenciaisSolene];
  if (preferenciaisSolene.length === 0) {
    for (const m of membros) {
      if (m.forcar_escalacao_solene) {
        for (const funcao of funcoes) {
          if ((funcao.relevancia ?? "normal") === "principal") {
            preferenciaisEfetivos.push({ ministerio_id: funcao.ministerio_id, membro_id: m.id });
          }
        }
      }
    }
  }

  // Ordena funções por ordem_prioridade (menor = mais importante = processa primeiro)
  const funcoesOrdenadas = [...funcoes].sort(
    (a, b) => (a.ordem_prioridade ?? 0) - (b.ordem_prioridade ?? 0),
  );

  for (const funcao of funcoesOrdenadas) {
    const jaNestaFuncao = alocacoes.filter((a) => a.ministerio_id === funcao.ministerio_id).length;
    let vagas = funcao.quantidade - jaNestaFuncao;
    if (vagas <= 0) {
      detalhesPorFuncao.push({
        ministerio_id:   funcao.ministerio_id,
        ministerio_nome: funcao.ministerio_nome,
        solicitados:     funcao.quantidade,
        alocados:        jaNestaFuncao,
      });
      continue;
    }

    const ehPrincipal       = (funcao.relevancia ?? "normal") === "principal";
    const modoSolenePrincipal = ehSolene && ehPrincipal;

    const preferenciaisDaFuncao = new Set(
      preferenciaisEfetivos
        .filter((p) => p.ministerio_id === funcao.ministerio_id)
        .map((p) => p.membro_id),
    );

    // Contadores de exclusão
    const excluidos = { sem_vinculo: 0, indisponibilidade: 0, dia_semana: 0, funcao_nao_pode: 0, atuacao: 0, ja_alocado: 0, acima_limite: 0 };

    // ── Separação em pools progressivos ─────────────────────────────────────
    // Pool 1: apto + abaixo de ambos os limites + não alocado
    // Pool 2: apto + acima limite semanal mas abaixo mensal + não alocado
    // Pool 3: apto + acima limite mensal + não alocado (último recurso)
    // Pool 4: já alocado em outra função MAS funcao.duplicidade_permitida=true

    const pool1: MembroEngine[] = [];
    const pool2: MembroEngine[] = [];
    const pool3: MembroEngine[] = [];
    const pool4: MembroEngine[] = []; // multi-função (duplicidade)

    for (const m of membros) {
      if (!m.ministerio_ids.includes(funcao.ministerio_id)) { excluidos.sem_vinculo++; continue; }
      if (m.funcoes_nao_pode_ids?.includes(funcao.ministerio_id)) { excluidos.funcao_nao_pode++; continue; }
      if (incompatMap?.has(m.id) && [...ja_alocados].some((id) => incompatMap.get(m.id)!.has(id))) { excluidos.funcao_nao_pode++; continue; }
      if (funcao.atuacoes_exigidas?.length && !funcao.atuacoes_exigidas.some((a) => (m.atuacao_ids ?? []).includes(a))) { excluidos.atuacao++; continue; }
      if (estaIndisponivel(m.id, contexto.data, indisponibilidades)) { excluidos.indisponibilidade++; continue; }
      if (m.restricoes_dia_semana?.includes(getDiaSemana(contexto.data))) { excluidos.dia_semana++; continue; }
      if (config?.impedir_repeticao_seguida) {
        if (historicoRecente.some((h) => h.membro_id === m.id && h.data === ontemStr)) {
          excluidos.indisponibilidade++;
          continue;
        }
      }
      if (config?.intervalo_minimo_dias && config.intervalo_minimo_dias > 0) {
        const limite = somarDias(contexto.data, -config.intervalo_minimo_dias);
        if (historicoRecente.some((h) => h.membro_id === m.id && h.data > limite && h.data < contexto.data)) {
          excluidos.indisponibilidade++;
          continue;
        }
      }

      if (ja_alocados.has(m.id)) {
        excluidos.ja_alocado++;
        if (funcao.duplicidade_permitida) pool4.push(m);
        continue;
      }

      const acimaSemanal = acimaLimiteSemanal.has(m.id);
      const acimaMensal  = acimaLimiteMensal.has(m.id);

      if (acimaMensal) {
        excluidos.acima_limite++;
        pool3.push(m);
      } else if (acimaSemanal) {
        excluidos.acima_limite++;
        pool2.push(m);
      } else {
        pool1.push(m);
      }
    }

    // ── Função de scoring e seleção por pool ─────────────────────────────────
    const selecionados: Array<{ membro: MembroEngine; breakdown: ScoreBreakdown; diasSemServir: number; count30d: number; totalHist: number; forcado: boolean }> = [];

    function scorePool(pool: MembroEngine[], forcado: boolean) {
      return pool.map((m) => {
        const hist = historicoRecente.filter((h) => h.membro_id === m.id);
        const histAnterior = hist.filter((h) => h.data < contexto.data);
        const ultimaData = histAnterior.length > 0
          ? histAnterior.reduce((max, h) => h.data > max ? h.data : max, histAnterior[0].data)
          : null;
        const diasSemServir = ultimaData ? dateDiffDays(ultimaData, contexto.data) : 365;
        const count30d      = hist.filter((h) => h.data >= data30dAtras && h.data < contexto.data).length;
        const totalHist     = histAnterior.length;

        const breakdown = calcularScore(
          m, funcao, historicoRecente, contexto.data, data30dAtras, stats,
          modoSolenePrincipal, preferenciaisDaFuncao.has(m.id), config,
        );

        // Bonus variedade de ministério (apenas modo comum)
        if (!modoSolenePrincipal && config?.variedade_ministerio && histAnterior.length > 0) {
          const ultimaEntry = histAnterior.reduce((acc, h) => h.data > acc.data ? h : acc, histAnterior[0]);
          if (ultimaEntry.ministerio_id !== funcao.ministerio_id) {
            breakdown.total = Math.min(100, breakdown.total + 8);
          }
        }

        return { membro: m, breakdown, diasSemServir, count30d, totalHist, forcado };
      }).sort((a, b) => b.breakdown.total - a.breakdown.total);
    }

    // Ordena o pool por prioridade de gênero (alvos GLOBAIS) sem fatiar.
    // Retorna a lista COMPLETA reordenada: cota masculina → cota feminina →
    // neutros (sexo null) → excedente de gênero.
    // A fatiação ocorre DEPOIS, durante a seleção integrada com incompat,
    // garantindo que candidatos válidos do pool não sejam descartados antes
    // de haver chance de substituir um rejeitado.
    function ordenarPorGenero(
      scored: ReturnType<typeof scorePool>,
      mascJa: number,
      femJa: number,
      totalVagas: number,
    ): typeof scored {
      const mascPct = config?.distribuicao_masc_pct;
      if (mascPct === undefined || scored.length < 1) return scored;

      const alvoMascTotal    = Math.round(totalVagas * mascPct / 100);
      const alvoFemTotal     = totalVagas - alvoMascTotal;
      const alvoMascRestante = Math.max(0, alvoMascTotal - mascJa);
      const alvoFemRestante  = Math.max(0, alvoFemTotal  - femJa);

      const machos   = scored.filter((c) => c.membro.sexo === "M");
      const femeas   = scored.filter((c) => c.membro.sexo === "F");
      const neutros  = scored.filter((c) => c.membro.sexo !== "M" && c.membro.sexo !== "F");

      // Ordem de preferência: cota M → cota F → neutros → excedente M → excedente F
      return [
        ...machos.slice(0, alvoMascRestante),
        ...femeas.slice(0, alvoFemRestante),
        ...neutros,
        ...machos.slice(alvoMascRestante),
        ...femeas.slice(alvoFemRestante),
      ];
    }

    // Pontua todos os pools UMA vez — evita double Math.random() entre seleção e insights
    const scored1 = scorePool(pool1, false);
    const scored2 = scorePool(pool2, false);
    const scored3 = scorePool(pool3, true);
    const scored4 = scorePool(pool4, true);

    // Contadores globais de gênero para distribuição consolidada entre pools
    const totalVagasFuncao = vagas;
    let mascSelecionados = 0;
    let femSelecionados  = 0;

    // Seleção progressiva: ordena por gênero e seleciona até `vagas` candidatos
    // compatíveis em um único loop — candidatos rejeitados por incompatibilidade
    // são substituídos pelo próximo na lista ordenada do mesmo pool.
    for (const scored of [scored1, scored2, scored3, scored4]) {
      if (vagas <= 0) break;
      const ordenados = ordenarPorGenero(scored, mascSelecionados, femSelecionados, totalVagasFuncao);

      const aprovados: typeof ordenados = [];
      const aprovadosIds = new Set<string>();

      for (const c of ordenados) {
        if (aprovados.length >= vagas) break;
        const incompat = incompatMap?.get(c.membro.id);
        const conflito = incompat && [...aprovadosIds].some((id) => incompat.has(id));
        if (!conflito) {
          aprovados.push(c);
          aprovadosIds.add(c.membro.id);
        }
      }

      selecionados.push(...aprovados);
      mascSelecionados += aprovados.filter((c) => c.membro.sexo === "M").length;
      femSelecionados  += aprovados.filter((c) => c.membro.sexo === "F").length;
      vagas -= aprovados.length;
    }

    // Alerta de proporção consolidado — emitido UMA vez sobre o resultado final da função
    if (config?.distribuicao_masc_pct !== undefined && selecionados.length > 0) {
      const mascPct       = config.distribuicao_masc_pct;
      const alvoMascTotal = Math.round(totalVagasFuncao * mascPct / 100);
      const alvoFemTotal  = totalVagasFuncao - alvoMascTotal;
      if ((alvoMascTotal > 0 && mascSelecionados < alvoMascTotal) ||
          (alvoFemTotal  > 0 && femSelecionados  < alvoFemTotal)) {
        alertas.push(
          `⚠ "${funcao.ministerio_nome}": proporção ${mascPct}/${100 - mascPct} (M/F) — ` +
          `obtido M:${mascSelecionados} (alvo ${alvoMascTotal}), F:${femSelecionados} (alvo ${alvoFemTotal}).`,
        );
      }
    }

    // ── Registrar alocações ───────────────────────────────────────────────────
    const selecionadosIds = new Set(selecionados.map((c) => c.membro.id));

    for (const c of selecionados) {
      alocacoes.push({
        membro_id:    c.membro.id,
        membro_nome:  c.membro.nome,
        ministerio_id: funcao.ministerio_id,
        forcado:      c.forcado,
        motivo:       buildMotivo(c.diasSemServir, c.count30d, c.breakdown, c.forcado),
      });
      ja_alocados.add(c.membro.id);
    }

    // ── Diagnóstico / insights ────────────────────────────────────────────────
    // Reutiliza scores pré-calculados — sem novo Math.random()
    const todosScored = [...scored1, ...scored2, ...scored3]
      .sort((a, b) => b.breakdown.total - a.breakdown.total);
    const topCandidatos: InsightCandidato[] = todosScored.slice(0, 8).map((c) => ({
      membro_id:           c.membro.id,
      nome:                c.membro.nome,
      score_final:         c.breakdown.total,
      dias_sem_servir:     c.diasSemServir,
      participacoes_30d:   c.count30d,
      participacoes_total: c.totalHist,
      breakdown:           c.breakdown,
      escolhido:           selecionadosIds.has(c.membro.id),
      motivo_exclusao:     !selecionadosIds.has(c.membro.id) ? "Score inferior" : undefined,
    }));

    const faltando = vagas; // vagas restantes após todos os pools
    let motivoVazio: string | undefined;
    if (faltando > 0) {
      const totalComVinculo = membros.filter((m) => m.ministerio_ids.includes(funcao.ministerio_id)).length;
      if (totalComVinculo === 0) {
        motivoVazio = `Nenhum membro possui vínculo com esta função`;
      } else if (excluidos.indisponibilidade >= totalComVinculo) {
        motivoVazio = `Todos os ${totalComVinculo} membros desta função estão indisponíveis`;
      } else if (excluidos.atuacao >= totalComVinculo) {
        motivoVazio = "Nenhum membro tem a atuação exigida";
      } else {
        motivoVazio = `${faltando} vaga(s) em aberto — candidatos insuficientes`;
      }
      alertas.push(`⚠ Faltam ${faltando} para "${funcao.ministerio_nome}": ${motivoVazio}.`);
    }

    const alocadosFinal = selecionados.length + jaNestaFuncao;
    detalhesPorFuncao.push({
      ministerio_id:   funcao.ministerio_id,
      ministerio_nome: funcao.ministerio_nome,
      solicitados:     funcao.quantidade,
      alocados:        alocadosFinal,
      motivo_vazio:    motivoVazio,
    });
    insights.push({
      ministerio_id:        funcao.ministerio_id,
      ministerio_nome:      funcao.ministerio_nome,
      solicitados:          funcao.quantidade,
      alocados:             alocadosFinal,
      candidatos_avaliados: todosScored.length,
      excluidos,
      top_candidatos:       topCandidatos,
      escolhidos:           topCandidatos.filter((c) => c.escolhido),
      motivo_vazio:         motivoVazio,
    });
  }

  return { alocacoes, alertas, detalhesPorFuncao, insights };
}

// ── buildMotivo ───────────────────────────────────────────────────────────────

function buildMotivo(
  diasSemServir: number,
  count30d: number,
  bd: ScoreBreakdown,
  forcado: boolean,
): string {
  const partes: string[] = [];
  if (diasSemServir >= 365) partes.push("sem histórico recente");
  else partes.push(`${diasSemServir}d sem servir`);
  partes.push(count30d === 0 ? "não serviu nos últimos 30d" : `${count30d} vez(es) nos últimos 30d`);
  if (bd.penalidade > 0) partes.push(`penalidade −${bd.penalidade}`);
  if (forcado) partes.push("fallback (acima do limite / multi-função)");
  const modoLabel = bd.modo === "solene_principal" ? " [solenidade/principal]" : "";
  return `Score ${bd.total}${modoLabel} — ${partes.join("; ")}`;
}
