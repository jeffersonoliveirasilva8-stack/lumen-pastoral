// ═══════════════════════════════════════════════════════════════════════════════
// Motor Inteligente de Escalas — Lumen Pastoral
// Algoritmo de distribuição justa com rodízio real e 5 critérios ponderados.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type MembroEngine = {
  id: string;
  nome: string;
  score: number;
  ativo: boolean;
  forcar_escalacao_solene: boolean;
  ministerio_ids: string[];
  funcoes_nao_pode_ids?: string[];
  restricoes_dia_semana?: number[];
  atuacao_ids?: string[];
  sexo?: "M" | "F" | null;
  prioridade_escala?: string;
};

export type IndisponibilidadeEngine = {
  membro_id: string;
  data: string;       // YYYY-MM-DD
  tipo?: string;      // 'dia' | 'periodo' | 'intervalo'
  hora_inicio?: string | null; // HH:MM
  hora_fim?: string | null;    // HH:MM
  data_fim?: string | null;    // YYYY-MM-DD (for 'intervalo')
};

export type FuncaoNecessaria = {
  ministerio_id: string;
  ministerio_nome: string;
  quantidade: number;
  atuacoes_exigidas?: string[];
};

export type ContextoEscala = {
  data: string;
  tipo: string;
  solene: boolean;
  tem_adoracao: boolean;
  tem_bispo: boolean;
};

export type ConfigParoquia = {
  usa_tochas: boolean;
  usa_turibulo?: boolean;
  usa_naveta?: boolean;
  usa_baculifero?: boolean;
  usa_mitrifero?: boolean;
  limite_semanal?: number;
  limite_mensal?: number;
  impedir_repeticao_seguida?: boolean;
  intervalo_minimo_dias?: number;   // dias mínimos entre escalações do mesmo membro
  prioridade_score?: boolean;       // true = maior score (mérito); false/undef = equidade
  prioridade_bonus_alto?: number;   // bonus pts para prioridade_escala alta/mestre_cerimonia/coordenador (padrão: 15)
  prioridade_bonus_medio?: number;  // bonus pts para prioridade_escala media (padrão: 8)
  distribuicao_masc_pct?: number;   // % masculino alvo (0-100); undefined = sem controle de gênero
  variedade_ministerio?: boolean;   // bonus para membros que servirão em ministério diferente do último
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
  tempo_sem_servir: number;     // 0–100, peso 40%
  participacao_recente: number; // 0–100, peso 30%
  frequencia_historica: number; // 0–100, peso 15%
  ranking_bonus: number;        // 0–100, peso 10%
  aleatoriedade: number;        // 0–100, peso  5%
  penalidade: number;           // subtraída do total (celebração próxima)
  prioridade_bonus: number;     // bonus fixo por prioridade_escala do membro
  total: number;                // score final 0–100
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
    sem_vinculo: number;       // sem membro_ministerios para esta função
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

// ── Histórico de participações ────────────────────────────────────────────────

export type HistoricoRecente = {
  membro_id: string;
  ministerio_id: string;
  data: string; // YYYY-MM-DD
};

// ── Constantes do algoritmo ───────────────────────────────────────────────────

const PESOS = {
  tempoSemServir:       0.40,
  participacaoRecente:  0.30,
  frequenciaHistorica:  0.15,
  rankingBonus:         0.10,
  aleatoriedade:        0.05,
} as const;

const CAP_DIAS_SEM_SERVIR  = 60;  // 60+ dias = pontuação máxima
const CAP_PARTICIPACOES_30D = 5;  // 5+ participações nos últimos 30 dias = 0 pontos

const PENALIDADE_MESMO_DIA    = 50; // escalado hoje em outra celebração
const PENALIDADE_DIA_ANTERIOR = 30; // escalado ontem
const PENALIDADE_DOIS_DIAS    = 15; // escalado anteontem

// ── Termos de identificação de ministérios ────────────────────────────────────

const TERMOS: Record<string, string[]> = {
  ce_padre:   ["ce. do padre", "ce do padre", "cerimoniário do padre", "cerimoniar do padre", "ce padre"],
  ce_mor:     ["ce. mor", "ce mor", "cerimoniário mor", "cerimoniário-mor", "ce.mor"],
  turibulo:   ["turíbulo", "turibulo", "incenso", "turifer", "turiferário"],
  naveta:     ["naveta", "naveteiro", "naviculário", "navicular"],
  tocha:      ["tocha", "torch", "archeiro"],
  baculifero: ["baculífero", "baculifero", "báculo", "baculo", "portador do báculo"],
  mitrifero:  ["mitrífero", "mitrifero", "mitra", "portador da mitra"],
};

function nomeContem(nome: string, termos: string[]): boolean {
  const lower = nome.toLowerCase();
  return termos.some((t) => lower.includes(t));
}

// ── Utilitários de data ───────────────────────────────────────────────────────

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
    // 'intervalo': unavailable for a date range [data, data_fim]
    if (i.tipo === "intervalo" && i.data_fim) {
      return data >= i.data && data <= i.data_fim;
    }
    // 'dia' or 'periodo': match exact date (partial-time treated conservatively as full day)
    return i.data === data;
  });
}

function ehDomingo(data: string): boolean {
  return new Date(data + "T12:00:00").getDay() === 0;
}

function ehSoleneContexto(ctx: ContextoEscala): boolean {
  return ctx.solene || ctx.tem_bispo;
}

export function getDiaSemana(data: string): number {
  return new Date(data + "T12:00:00").getDay();
}

// ── isApto ────────────────────────────────────────────────────────────────────

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

// ── Estatísticas do grupo (pré-computadas para normalização) ──────────────────

type GrupoStats = {
  maxTotal:     number;
  maxRecente:   number;
  maxDbScore:   number;
};

function computeGrupoStats(
  membros: MembroEngine[],
  historico: HistoricoRecente[],
  data30dAtras: string,
): GrupoStats {
  let maxTotal = 0, maxRecente = 0, maxDbScore = 0;
  for (const m of membros) {
    const hist = historico.filter((h) => h.membro_id === m.id);
    maxTotal   = Math.max(maxTotal, hist.length);
    maxRecente = Math.max(maxRecente, hist.filter((h) => h.data >= data30dAtras).length);
    maxDbScore = Math.max(maxDbScore, m.score);
  }
  return { maxTotal, maxRecente, maxDbScore };
}

// ── calcularScorePrioridade ───────────────────────────────────────────────────
// Calcula o score de prioridade de um membro para uma função específica.
// Retorna um valor entre 0 e 100 (maior = maior prioridade).

function calcularScorePrioridade(
  membro: MembroEngine,
  historico: HistoricoRecente[],
  dataEvento: string,
  data30dAtras: string,
  stats: GrupoStats,
  config?: ConfigParoquia,
): ScoreBreakdown {
  const histMembro = historico.filter((h) => h.membro_id === membro.id);

  // ── Critério 1: Tempo sem servir (40%) ──────────────────────────────────────
  // Histórico exclui o próprio dia do evento para evitar viés
  const histAnterior = histMembro.filter((h) => h.data < dataEvento);
  let diasSemServir: number;
  if (histAnterior.length === 0) {
    diasSemServir = 365; // membro novo ou sem histórico = máxima prioridade
  } else {
    const ultimaData = histAnterior.reduce((max, h) => h.data > max ? h.data : max, histAnterior[0].data);
    diasSemServir = dateDiffDays(ultimaData, dataEvento);
  }
  const tempoSemServir = Math.min(diasSemServir, CAP_DIAS_SEM_SERVIR) / CAP_DIAS_SEM_SERVIR * 100;

  // ── Critério 2: Participação recente — últimos 30 dias (30%) ────────────────
  const count30d = histMembro.filter((h) => h.data >= data30dAtras && h.data < dataEvento).length;
  const participacaoRecente = Math.max(0, (1 - count30d / CAP_PARTICIPACOES_30D) * 100);

  // ── Critério 3: Frequência histórica total (15%) ────────────────────────────
  // Membros com menos participações acumuladas recebem prioridade
  const totalHist = histMembro.filter((h) => h.data < dataEvento).length;
  const frequenciaHistorica = stats.maxTotal > 0
    ? (1 - totalHist / stats.maxTotal) * 100
    : 100;

  // ── Critério 4: Equidade / mérito pelo score acumulado (10%) ──────────────────
  // prioridade_score=true (mérito): maior score histórico = mais prioridade
  // prioridade_score=false/undef (equidade): menor score = mais prioridade → rodízio real
  const rankingBonus = stats.maxDbScore > 0
    ? config?.prioridade_score
      ? (membro.score / stats.maxDbScore) * 100
      : (1 - membro.score / stats.maxDbScore) * 100
    : 0;

  // ── Critério 5: Aleatoriedade controlada (5%) ───────────────────────────────
  const aleatoriedade = Math.random() * 100;

  // ── Penalidades por celebrações próximas ────────────────────────────────────
  let penalidade = 0;
  const ontem = somarDias(dataEvento, -1);
  const anteontem = somarDias(dataEvento, -2);
  const historicoComHoje = histMembro.filter((h) => h.data <= dataEvento);
  const serviu_hoje = historicoComHoje.some((h) => h.data === dataEvento);
  const serviu_ontem = historicoComHoje.some((h) => h.data === ontem);
  const serviu_anteontem = historicoComHoje.some((h) => h.data === anteontem);

  if (serviu_hoje)      penalidade += PENALIDADE_MESMO_DIA;
  else if (serviu_ontem)      penalidade += PENALIDADE_DIA_ANTERIOR;
  else if (serviu_anteontem)  penalidade += PENALIDADE_DOIS_DIAS;

  // ── Score final ponderado ───────────────────────────────────────────────────
  const raw =
    PESOS.tempoSemServir      * tempoSemServir +
    PESOS.participacaoRecente * participacaoRecente +
    PESOS.frequenciaHistorica * frequenciaHistorica +
    PESOS.rankingBonus        * rankingBonus +
    PESOS.aleatoriedade       * aleatoriedade;

  // ── Bonus por prioridade_escala ──────────────────────────────────────────
  // 'sempre_solenes' é tratado pela Regra Jefferson; os demais recebem bonus.
  // Configurável via config.prioridade_bonus_alto / config.prioridade_bonus_medio.
  let prioridadeBonus = 0;
  const prio = membro.prioridade_escala;
  if (prio === "alta" || prio === "mestre_cerimonia" || prio === "coordenador") {
    prioridadeBonus = config?.prioridade_bonus_alto ?? 15;
  } else if (prio === "media") {
    prioridadeBonus = config?.prioridade_bonus_medio ?? 8;
  }

  const total = Math.max(0, Math.min(100, raw - penalidade + prioridadeBonus));

  return {
    tempo_sem_servir:      Math.round(tempoSemServir),
    participacao_recente:  Math.round(participacaoRecente),
    frequencia_historica:  Math.round(frequenciaHistorica),
    ranking_bonus:         Math.round(rankingBonus),
    aleatoriedade:         Math.round(aleatoriedade),
    penalidade:            Math.round(penalidade),
    prioridade_bonus:      Math.round(prioridadeBonus),
    total:                 Math.round(total),
  };
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
    if (config.usa_turibulo !== false) addSeFaltando(TERMOS.turibulo, 1);
    if (config.usa_naveta !== false)   addSeFaltando(TERMOS.naveta, 1);
  }
  if (contexto.tem_bispo) {
    if (config.usa_baculifero !== false) addSeFaltando(TERMOS.baculifero, 1);
    if (config.usa_mitrifero !== false)  addSeFaltando(TERMOS.mitrifero, 1);
  }
  if (!config.usa_tochas) {
    return adicionais.filter((f) => !nomeContem(f.ministerio_nome, TERMOS.tocha));
  }
  return adicionais;
}

// ── alocarMembros ─────────────────────────────────────────────────────────────
// Motor principal com rodízio inteligente e 5 critérios ponderados.

export function alocarMembros(
  funcoes: FuncaoNecessaria[],
  membros: MembroEngine[],
  indisponibilidades: IndisponibilidadeEngine[],
  contexto: ContextoEscala,
  historicoRecente: HistoricoRecente[] = [],
  config?: ConfigParoquia,
): ResultadoAlocacao {
  const alocacoes:       MembroAlocado[]  = [];
  const alertas:         string[]         = [];
  const detalhesPorFuncao: DetalheFuncao[] = [];
  const insights:        InsightFuncao[]  = [];
  const ja_alocados = new Set<string>();

  // ── Pré-computação para o algoritmo ────────────────────────────────────────
  const data30dAtras = somarDias(contexto.data, -30);
  const stats        = computeGrupoStats(membros, historicoRecente, data30dAtras);

  // ── Pré-computação: ontem (para impedir_repeticao_seguida) ─────────────────
  const ontemStr = somarDias(contexto.data, -1);

  // ── Limites de participação (semanal / mensal) ─────────────────────────────
  const acima_limite = new Set<string>();
  if (historicoRecente.length > 0 && (config?.limite_semanal || config?.limite_mensal)) {
    const semanaInicio = somarDias(contexto.data, -6);
    const mesInicio    = contexto.data.slice(0, 7) + "-01";
    for (const m of membros) {
      if (config?.limite_semanal) {
        const cnt = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= semanaInicio && h.data <= contexto.data,
        ).length;
        if (cnt >= config.limite_semanal) acima_limite.add(m.id);
      }
      if (config?.limite_mensal && !acima_limite.has(m.id)) {
        const cnt = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= mesInicio && h.data <= contexto.data,
        ).length;
        if (cnt >= config.limite_mensal) acima_limite.add(m.id);
      }
    }
  }

  // ── Regra Jefferson (prioridade absoluta em missas solenes) ─────────────────
  if (ehSoleneContexto(contexto)) {
    const jefferson = membros.find((m) => m.forcar_escalacao_solene && m.ativo);
    if (jefferson) {
      const funcao_jeff =
        funcoes.find((f) => nomeContem(f.ministerio_nome, TERMOS.ce_padre)) ??
        funcoes.find((f) => nomeContem(f.ministerio_nome, TERMOS.ce_mor));
      if (funcao_jeff) {
        if (jefferson.ministerio_ids.includes(funcao_jeff.ministerio_id)) {
          alocacoes.push({
            membro_id:    jefferson.id,
            membro_nome:  jefferson.nome,
            ministerio_id: funcao_jeff.ministerio_id,
            forcado:      true,
            motivo:       "Regra Jefferson (missa solene) — escalação forçada",
          });
          ja_alocados.add(jefferson.id);
          if (estaIndisponivel(jefferson.id, contexto.data, indisponibilidades)) {
            alertas.push(`⚠ ${jefferson.nome} está indisponível, mas foi escalado pela Regra Jefferson.`);
          }
        } else {
          alertas.push(`⚠ Regra Jefferson: ${jefferson.nome} não tem "${funcao_jeff.ministerio_nome}". Verifique o cadastro.`);
        }
      } else {
        alertas.push(`⚠ Regra Jefferson: nenhuma função Ce. do Padre / Ce. Mor definida nesta escala.`);
      }
    }
  }

  // ── Alocação inteligente por função ────────────────────────────────────────
  for (const funcao of funcoes) {
    const jaNestaFuncao = alocacoes.filter((a) => a.ministerio_id === funcao.ministerio_id).length;
    let vagas = funcao.quantidade - jaNestaFuncao;
    if (vagas <= 0) {
      detalhesPorFuncao.push({ ministerio_id: funcao.ministerio_id, ministerio_nome: funcao.ministerio_nome, solicitados: funcao.quantidade, alocados: jaNestaFuncao });
      continue;
    }

    // Contadores de exclusão para insights
    const excluidos = { sem_vinculo: 0, indisponibilidade: 0, dia_semana: 0, funcao_nao_pode: 0, atuacao: 0, ja_alocado: 0, acima_limite: 0 };

    // ── Fase 1: Filtrar candidatos base (sem considerar limite) ────────────
    const candidatosBase: MembroEngine[] = [];
    const candidatosLimitados: MembroEngine[] = []; // aptos mas acima do limite

    for (const m of membros) {
      // Verifica cada filtro individualmente para diagnóstico
      if (!m.ministerio_ids.includes(funcao.ministerio_id)) { excluidos.sem_vinculo++; continue; }
      if (m.funcoes_nao_pode_ids?.includes(funcao.ministerio_id)) { excluidos.funcao_nao_pode++; continue; }
      if (funcao.atuacoes_exigidas?.length && !(funcao.atuacoes_exigidas.some((a) => (m.atuacao_ids ?? []).includes(a)))) { excluidos.atuacao++; continue; }
      if (ja_alocados.has(m.id)) { excluidos.ja_alocado++; continue; }
      if (estaIndisponivel(m.id, contexto.data, indisponibilidades)) { excluidos.indisponibilidade++; continue; }
      if (m.restricoes_dia_semana?.includes(getDiaSemana(contexto.data))) { excluidos.dia_semana++; continue; }
      // Hard-block: impede escalação em dias consecutivos quando configurado
      if (config?.impedir_repeticao_seguida) {
        const serviuOntem = historicoRecente.some((h) => h.membro_id === m.id && h.data === ontemStr);
        if (serviuOntem) { excluidos.indisponibilidade++; continue; }
      }
      // Hard-block: intervalo mínimo entre escalações
      if (config?.intervalo_minimo_dias && config.intervalo_minimo_dias > 0) {
        const limite = somarDias(contexto.data, -config.intervalo_minimo_dias);
        const serviuRecente = historicoRecente.some((h) => h.membro_id === m.id && h.data > limite && h.data < contexto.data);
        if (serviuRecente) { excluidos.indisponibilidade++; continue; }
      }

      if (acima_limite.has(m.id)) {
        excluidos.acima_limite++;
        candidatosLimitados.push(m);
      } else {
        candidatosBase.push(m);
      }
    }

    // ── Fase 2: Calcular scores ─────────────────────────────────────────────
    // Se não há candidatos livres, usa os que estão acima do limite (fallback)
    const pool = candidatosBase.length > 0 ? candidatosBase : candidatosLimitados;

    const candidatosComScore = pool.map((m) => {
      const hist_m    = historicoRecente.filter((h) => h.membro_id === m.id);
      const histAnterior = hist_m.filter((h) => h.data < contexto.data);
      const ultimaData = histAnterior.length > 0
        ? histAnterior.reduce((max, h) => h.data > max ? h.data : max, histAnterior[0].data)
        : null;
      const diasSemServir = ultimaData ? dateDiffDays(ultimaData, contexto.data) : 365;
      const count30d      = hist_m.filter((h) => h.data >= data30dAtras && h.data < contexto.data).length;
      const totalHist     = histAnterior.length;

      const breakdown = calcularScorePrioridade(m, historicoRecente, contexto.data, data30dAtras, stats, config);

      return { membro: m, breakdown, diasSemServir, count30d, totalHist };
    });

    // Bonus de variedade de ministério: membro que servirá em ministério diferente do último
    if (config?.variedade_ministerio) {
      candidatosComScore.forEach((c) => {
        const histMembro = historicoRecente.filter((h) => h.membro_id === c.membro.id && h.data < contexto.data);
        if (histMembro.length > 0) {
          const ultimaEntry = histMembro.reduce((acc, h) => h.data > acc.data ? h : acc, histMembro[0]);
          if (ultimaEntry.ministerio_id !== funcao.ministerio_id) {
            c.breakdown.total = Math.min(100, c.breakdown.total + 8);
          }
        }
      });
    }

    // Ordena por score decrescente (maior score = maior prioridade = será escolhido primeiro)
    candidatosComScore.sort((a, b) => b.breakdown.total - a.breakdown.total);

    // ── Fase 3: Distribuição de gênero configurada ─────────────────────────
    // Usa distribuicao_masc_pct da config (default 50 = equidade).
    // undefined = sem controle (pega os top N por score puro).
    const selecionados = (() => {
      const mascPct = config?.distribuicao_masc_pct;
      if (mascPct === undefined || vagas < 2 || candidatosComScore.length < 2) {
        return candidatosComScore.slice(0, vagas);
      }
      const alvoMasc = Math.round(vagas * mascPct / 100);
      const alvoFem  = vagas - alvoMasc;
      const machos  = candidatosComScore.filter((c) => c.membro.sexo === "M");
      const femeas  = candidatosComScore.filter((c) => c.membro.sexo === "F");
      const escolhidos = [
        ...machos.slice(0, alvoMasc),
        ...femeas.slice(0, alvoFem),
      ];
      const escolhidosIds = new Set(escolhidos.map((c) => c.membro.id));
      // Preenche vagas restantes com os melhores de qualquer gênero
      const faltam = vagas - escolhidos.length;
      if (faltam > 0) {
        const restantes = candidatosComScore.filter((c) => !escolhidosIds.has(c.membro.id));
        escolhidos.push(...restantes.slice(0, faltam));
      }
      // Alerta quando a proporção configurada não pôde ser atingida
      const mascObtidos = escolhidos.filter((c) => c.membro.sexo === "M").length;
      const femObtidos  = escolhidos.filter((c) => c.membro.sexo === "F").length;
      if (
        (alvoMasc > 0 && mascObtidos < alvoMasc && machos.length < alvoMasc) ||
        (alvoFem  > 0 && femObtidos  < alvoFem  && femeas.length < alvoFem)
      ) {
        alertas.push(
          `⚠ "${funcao.ministerio_nome}": proporção ${mascPct}/${100 - mascPct} (M/F) não atingida` +
          ` — M disponíveis: ${machos.length} (alvo ${alvoMasc}), F disponíveis: ${femeas.length} (alvo ${alvoFem}).` +
          " Número insuficiente de candidatos para atingir a proporção configurada.",
        );
      }
      return escolhidos;
    })();

    // ── Fase 4: Registrar alocações ─────────────────────────────────────────
    const selecionadosSet = new Set(selecionados.map((c) => c.membro.id));

    for (const c of selecionados) {
      const emLimite = acima_limite.has(c.membro.id) && candidatosBase.length === 0;
      alocacoes.push({
        membro_id:    c.membro.id,
        membro_nome:  c.membro.nome,
        ministerio_id: funcao.ministerio_id,
        forcado:      emLimite,
        motivo: buildMotivo(c.diasSemServir, c.count30d, c.breakdown, emLimite),
      });
      ja_alocados.add(c.membro.id);
    }

    // ── Fase 5: Insights desta função ───────────────────────────────────────
    const topCandidatos: InsightCandidato[] = candidatosComScore.slice(0, 8).map((c) => ({
      membro_id:             c.membro.id,
      nome:                  c.membro.nome,
      score_final:           c.breakdown.total,
      dias_sem_servir:       c.diasSemServir,
      participacoes_30d:     c.count30d,
      participacoes_total:   c.totalHist,
      breakdown:             c.breakdown,
      escolhido:             selecionadosSet.has(c.membro.id),
      motivo_exclusao:       !selecionadosSet.has(c.membro.id) ? "Score inferior" : undefined,
    }));

    const escolhidos = topCandidatos.filter((c) => c.escolhido);

    // ── Fase 6: Diagnóstico de funções não preenchidas ──────────────────────
    const faltando = vagas - selecionados.length;
    let motivoVazio: string | undefined;

    if (faltando > 0) {
      const totalComVinculo = membros.filter((m) => m.ministerio_ids.includes(funcao.ministerio_id)).length;
      if (totalComVinculo === 0) {
        motivoVazio = `Nenhum dos ${membros.length} membros ativos possui vínculo com esta função (sem_vinculo=${excluidos.sem_vinculo})`;
      } else if (excluidos.indisponibilidade >= totalComVinculo) {
        motivoVazio = `Todos os ${totalComVinculo} membros desta função estão indisponíveis`;
      } else if (excluidos.atuacao >= totalComVinculo) {
        motivoVazio = "Nenhum membro tem a atuação exigida para esta função";
      } else if (excluidos.funcao_nao_pode >= totalComVinculo) {
        motivoVazio = `Todos os ${totalComVinculo} membros desta função têm restrição "não pode"`;
      } else if (excluidos.ja_alocado + excluidos.acima_limite >= candidatosBase.length + excluidos.ja_alocado) {
        motivoVazio = "Candidatos insuficientes (verifique indisponibilidades e limites)";
      } else {
        motivoVazio = `${faltando} vaga(s) em aberto — candidatos insuficientes`;
      }
      alertas.push(`⚠ Faltam ${faltando} para "${funcao.ministerio_nome}": ${motivoVazio}.`);
    }

    const alocadosFinal = selecionados.length + jaNestaFuncao;
    detalhesPorFuncao.push({
      ministerio_id:  funcao.ministerio_id,
      ministerio_nome: funcao.ministerio_nome,
      solicitados:    funcao.quantidade,
      alocados:       alocadosFinal,
      motivo_vazio:   motivoVazio,
    });

    insights.push({
      ministerio_id:      funcao.ministerio_id,
      ministerio_nome:    funcao.ministerio_nome,
      solicitados:        funcao.quantidade,
      alocados:           alocadosFinal,
      candidatos_avaliados: candidatosComScore.length,
      excluidos,
      top_candidatos:     topCandidatos,
      escolhidos,
      motivo_vazio:       motivoVazio,
    });
  }

  return { alocacoes, alertas, detalhesPorFuncao, insights };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMotivo(
  diasSemServir: number,
  count30d: number,
  bd: ScoreBreakdown,
  emLimite: boolean,
): string {
  const partes: string[] = [];
  if (diasSemServir >= 365) partes.push("membro novo / sem histórico recente");
  else partes.push(`${diasSemServir}d sem servir`);
  if (count30d === 0) partes.push("não serviu nos últimos 30 dias");
  else partes.push(`${count30d} escalação(ões) nos últimos 30 dias`);
  if (bd.penalidade > 0) partes.push(`penalidade −${bd.penalidade} (celebração próxima)`);
  if (emLimite) partes.push("escalado acima do limite (fallback)");
  return `Score ${bd.total} — ${partes.join("; ")}`;
}

// ── Regras litúrgicas ─────────────────────────────────────────────────────────

export function ehMissaSolene(tipo: string, solene: boolean, tem_bispo: boolean): boolean {
  if (solene || tem_bispo) return true;
  if (tipo === "festa" || tipo === "novena") return true;
  return false;
}

export type NomeDiaSemana =
  | "Domingo" | "Segunda" | "Terça" | "Quarta"
  | "Quinta" | "Sexta" | "Sábado";

export const DIAS_SEMANA: NomeDiaSemana[] = [
  "Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado",
];

export function getNomeDia(data: string): NomeDiaSemana {
  return DIAS_SEMANA[getDiaSemana(data)];
}
