// Motor litúrgico de geração de escalas — puro TypeScript, sem dependências externas.
// Toda lógica de regras da paróquia fica centralizada aqui.

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
};

export type IndisponibilidadeEngine = {
  membro_id: string;
  data: string; // YYYY-MM-DD
};

export type FuncaoNecessaria = {
  ministerio_id: string;
  ministerio_nome: string;
  quantidade: number;
  // IDs de atuações exigidas para esta função (vazio = qualquer membro apto)
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
  // Quando true: membros com MAIOR score são priorizados (mérito)
  // Quando false/undefined: membros com MENOR score são priorizados (equidade)
  prioridade_score?: boolean;
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

// ── Detalhes por função (diagnóstico) ────────────────────────────────────────

export type DetalheFuncao = {
  ministerio_id: string;
  ministerio_nome: string;
  solicitados: number;
  alocados: number;
  motivo_vazio?: string; // preenchido quando alocados < solicitados
};

export type ResultadoAlocacao = {
  alocacoes: MembroAlocado[];
  alertas: string[];
  detalhesPorFuncao: DetalheFuncao[];
};

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

function estaIndisponivel(
  membro_id: string,
  data: string,
  indisponibilidades: IndisponibilidadeEngine[],
): boolean {
  return indisponibilidades.some(
    (ind) => ind.membro_id === membro_id && ind.data === data,
  );
}

function ehDomingo(data: string): boolean {
  return new Date(data + "T12:00:00").getDay() === 0;
}

function ehSoleneContexto(ctx: ContextoEscala): boolean {
  return ctx.solene || ctx.tem_bispo;
}

// ── isApto ────────────────────────────────────────────────────────────────────
// Verifica se um membro pode ser escalado para um ministério numa data.

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

  // Restrição por dia da semana
  if (membro.restricoes_dia_semana && membro.restricoes_dia_semana.length > 0) {
    if (membro.restricoes_dia_semana.includes(getDiaSemana(data))) return false;
  }

  // Blocklist: ministério explicitamente proibido para este membro
  if (membro.funcoes_nao_pode_ids && membro.funcoes_nao_pode_ids.includes(ministerio_id)) {
    return false;
  }

  // Filtro por atuação: se a função exige atuações específicas, o membro deve ter pelo menos uma
  if (atuacoes_exigidas && atuacoes_exigidas.length > 0) {
    const membroAtuacoes = membro.atuacao_ids ?? [];
    if (!atuacoes_exigidas.some((a) => membroAtuacoes.includes(a))) return false;
  }

  return true;
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
    const min = ministerios_disponiveis.find(
      (m) => m.ativo && nomeContem(m.nome, termos),
    );
    if (min && !ids_existentes.has(min.id)) {
      adicionais.push({ ministerio_id: min.id, ministerio_nome: min.nome, quantidade });
      ids_existentes.add(min.id);
    }
  }

  if (contexto.tem_adoracao && !domingo) {
    if (config.usa_turibulo !== false) addSeFaltando(TERMOS.turibulo, 1);
    if (config.usa_naveta !== false) addSeFaltando(TERMOS.naveta, 1);
  }

  if (contexto.tem_bispo) {
    if (config.usa_baculifero !== false) addSeFaltando(TERMOS.baculifero, 1);
    if (config.usa_mitrifero !== false) addSeFaltando(TERMOS.mitrifero, 1);
  }

  if (!config.usa_tochas) {
    return adicionais.filter((f) => !nomeContem(f.ministerio_nome, TERMOS.tocha));
  }

  return adicionais;
}

export type HistoricoRecente = {
  membro_id: string;
  ministerio_id: string;
  data: string;
};

// ── alocarMembros ─────────────────────────────────────────────────────────────

export function alocarMembros(
  funcoes: FuncaoNecessaria[],
  membros: MembroEngine[],
  indisponibilidades: IndisponibilidadeEngine[],
  contexto: ContextoEscala,
  historicoRecente?: HistoricoRecente[],
  config?: ConfigParoquia,
): ResultadoAlocacao {
  const alocacoes: MembroAlocado[] = [];
  const alertas: string[] = [];
  const detalhesPorFuncao: DetalheFuncao[] = [];
  const ja_alocados = new Set<string>();

  const usarPenalidade = config?.impedir_repeticao_seguida !== false;
  // prioridade_score: true = maior score tem preferência (mérito)
  //                  false/undefined = menor score tem preferência (equidade)
  const prioridadeScore = config?.prioridade_score === true;

  // ── Score efetivo ──────────────────────────────────────────────────────────
  function scoreEfetivo(m: MembroEngine, ministerio_id: string): number {
    const totalServicos = historicoRecente
      ? historicoRecente.filter((h) => h.membro_id === m.id).length
      : 0;

    // Base: score do banco + serviços históricos totais
    let score = m.score + totalServicos;

    // Penalidade por serviço recente (últimos 7 dias) — apenas no modo equidade
    if (usarPenalidade && historicoRecente && historicoRecente.length > 0) {
      const cutoff = new Date(contexto.data + "T12:00:00");
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const recentes = historicoRecente.filter(
        (h) => h.membro_id === m.id && h.data >= cutoffStr,
      );

      if (recentes.length > 0) {
        if (!prioridadeScore) {
          // Equidade: penalizar quem serviu recentemente
          score += recentes.length * 10000;
          if (recentes.some((h) => h.ministerio_id === ministerio_id)) score += 50000;
        } else {
          // Mérito: bonificar quem serviu recentemente (experiência)
          score += recentes.length * 100;
        }
      }
    }

    // No modo equidade, inverter sinal para que sort ascending = maior participação primeiro
    return prioridadeScore ? -score : score;
  }

  // Fisher-Yates shuffle para aleatoriedade dentro de scores iguais
  function embaralhar<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Limites de participação (semanal / mensal) ─────────────────────────────
  const membros_acima_do_limite = new Set<string>();
  if (historicoRecente && historicoRecente.length > 0 && (config?.limite_semanal || config?.limite_mensal)) {
    const dataEvento = new Date(contexto.data + "T12:00:00");

    const semanaInicio = new Date(dataEvento);
    semanaInicio.setDate(semanaInicio.getDate() - 6);
    const semanaInicioStr = semanaInicio.toISOString().slice(0, 10);

    const ano = dataEvento.getFullYear();
    const mes = String(dataEvento.getMonth() + 1).padStart(2, "0");
    const mesInicioStr = `${ano}-${mes}-01`;

    for (const m of membros) {
      if (config!.limite_semanal) {
        const countSemana = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= semanaInicioStr && h.data <= contexto.data,
        ).length;
        if (countSemana >= config!.limite_semanal) membros_acima_do_limite.add(m.id);
      }
      if (config!.limite_mensal && !membros_acima_do_limite.has(m.id)) {
        const countMes = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= mesInicioStr && h.data <= contexto.data,
        ).length;
        if (countMes >= config!.limite_mensal) membros_acima_do_limite.add(m.id);
      }
    }
  }

  // ── Regra Jefferson ────────────────────────────────────────────────────────
  const solene = ehSoleneContexto(contexto);
  const jefferson = membros.find((m) => m.forcar_escalacao_solene && m.ativo);

  if (jefferson && solene) {
    const funcao_jeff =
      funcoes.find((f) => nomeContem(f.ministerio_nome, TERMOS.ce_padre)) ??
      funcoes.find((f) => nomeContem(f.ministerio_nome, TERMOS.ce_mor));

    if (funcao_jeff) {
      if (jefferson.ministerio_ids.includes(funcao_jeff.ministerio_id)) {
        alocacoes.push({
          membro_id: jefferson.id,
          membro_nome: jefferson.nome,
          ministerio_id: funcao_jeff.ministerio_id,
          forcado: true,
          motivo: "Regra Jefferson (missa solene)",
        });
        ja_alocados.add(jefferson.id);

        if (estaIndisponivel(jefferson.id, contexto.data, indisponibilidades)) {
          alertas.push(
            `⚠ ${jefferson.nome} está indisponível em ${contexto.data}, mas foi escalado pela Regra Jefferson.`,
          );
        }
      } else {
        alertas.push(
          `⚠ Regra Jefferson: ${jefferson.nome} não tem o ministério "${funcao_jeff.ministerio_nome}". Verifique o cadastro.`,
        );
      }
    } else {
      alertas.push(
        `⚠ Regra Jefferson: nenhuma função Ce. do Padre / Ce. Mor nesta escala. Adicione manualmente.`,
      );
    }
  }

  // ── Alocação geral por score ────────────────────────────────────────────────
  for (const funcao of funcoes) {
    const ja_nessa_funcao = alocacoes.filter(
      (a) => a.ministerio_id === funcao.ministerio_id,
    ).length;

    let vagas = funcao.quantidade - ja_nessa_funcao;
    if (vagas <= 0) {
      detalhesPorFuncao.push({
        ministerio_id: funcao.ministerio_id,
        ministerio_nome: funcao.ministerio_nome,
        solicitados: funcao.quantidade,
        alocados: ja_nessa_funcao,
      });
      continue;
    }

    // Filtra membros aptos: respeita limites + isApto (inclui filtro de atuação)
    const aptosBase = membros.filter((m) =>
      !membros_acima_do_limite.has(m.id) &&
      isApto(m, funcao.ministerio_id, contexto.data, indisponibilidades, ja_alocados, funcao.atuacoes_exigidas),
    );

    // Se não há aptos e havia limite, tenta sem limite (fallback)
    const aptos =
      aptosBase.length > 0
        ? aptosBase
        : membros_acima_do_limite.size > 0
          ? membros.filter((m) =>
              isApto(m, funcao.ministerio_id, contexto.data, indisponibilidades, ja_alocados, funcao.atuacoes_exigidas),
            )
          : [];

    const aptosOrdenados = embaralhar(aptos).sort(
      (a, b) => scoreEfetivo(a, funcao.ministerio_id) - scoreEfetivo(b, funcao.ministerio_id),
    );

    // ── Mix de gênero ──────────────────────────────────────────────────────
    const selecionados = (() => {
      const inicial = aptosOrdenados.slice(0, vagas);
      if (vagas < 2) return inicial;
      const comGenero = inicial.filter((m) => m.sexo === "M" || m.sexo === "F");
      if (comGenero.length === 0) return inicial;
      const generoBase = comGenero[0].sexo;
      if (!comGenero.every((m) => m.sexo === generoBase)) return inicial;
      const diferente = aptosOrdenados.slice(vagas).find(
        (m) => m.sexo !== generoBase && (m.sexo === "M" || m.sexo === "F"),
      );
      if (!diferente) return inicial;
      return [...inicial.slice(0, vagas - 1), diferente];
    })();

    for (const m of selecionados) {
      const emLimite = membros_acima_do_limite.has(m.id) && aptosBase.length === 0;
      const modoScore = prioridadeScore ? "maior score" : "menor score";
      alocacoes.push({
        membro_id: m.id,
        membro_nome: m.nome,
        ministerio_id: funcao.ministerio_id,
        forcado: emLimite,
        motivo: emLimite
          ? `Score ${m.score} — alocado acima do limite (fallback)`
          : `Score ${m.score} — ${modoScore}`,
      });
      ja_alocados.add(m.id);
    }

    // Diagnóstico desta função
    const alocadosNestaFuncao = selecionados.length + ja_nessa_funcao;
    const faltando = vagas - selecionados.length;

    let motivoVazio: string | undefined;
    if (faltando > 0) {
      // Diagnosticar o motivo de não preenchimento
      const semVinculo = membros.filter(
        (m) => !m.ministerio_ids.includes(funcao.ministerio_id),
      ).length;
      const comVinculo = membros.filter(
        (m) => m.ministerio_ids.includes(funcao.ministerio_id),
      );
      const indisps = comVinculo.filter((m) =>
        estaIndisponivel(m.id, contexto.data, indisponibilidades),
      ).length;
      const restricoesdia = comVinculo.filter(
        (m) => m.restricoes_dia_semana?.includes(getDiaSemana(contexto.data)),
      ).length;
      const jaemaloc = comVinculo.filter((m) => ja_alocados.has(m.id)).length;
      const acimalimite = comVinculo.filter((m) => membros_acima_do_limite.has(m.id)).length;

      if (comVinculo.length === 0) {
        motivoVazio = `Nenhum membro vinculado a esta função (${membros.length} membros sem vínculo)`;
      } else if (indisps >= comVinculo.length) {
        motivoVazio = `Todos os ${comVinculo.length} membro(s) com esta função estão indisponíveis nesta data`;
      } else if (restricoesdia >= comVinculo.length) {
        motivoVazio = `Todos os membro(s) com esta função têm restrição para ${getDiaSemana(contexto.data) === 0 ? "domingo" : "este dia da semana"}`;
      } else if (jaemaloc >= comVinculo.length) {
        motivoVazio = `Todos os membro(s) com esta função já foram atribuídos a outra função nesta escala`;
      } else if (acimalimite > 0 && aptosBase.length === 0) {
        motivoVazio = `${acimalimite} membro(s) atingiu o limite semanal/mensal; ${comVinculo.length - acimalimite} alocado(s)`;
      } else {
        motivoVazio = `${faltando} vaga(s) em aberto — candidatos insuficientes (${semVinculo} sem vínculo)`;
      }

      alertas.push(
        `⚠ Faltam ${faltando} para "${funcao.ministerio_nome}": ${motivoVazio}.`,
      );
    }

    detalhesPorFuncao.push({
      ministerio_id: funcao.ministerio_id,
      ministerio_nome: funcao.ministerio_nome,
      solicitados: funcao.quantidade,
      alocados: alocadosNestaFuncao,
      motivo_vazio: motivoVazio,
    });
  }

  return { alocacoes, alertas, detalhesPorFuncao };
}

// ── Regras litúrgicas ─────────────────────────────────────────────────────────

export function ehMissaSolene(tipo: string, solene: boolean, tem_bispo: boolean): boolean {
  if (solene || tem_bispo) return true;
  if (tipo === "festa" || tipo === "novena") return true;
  return false;
}

export function getDiaSemana(data: string): number {
  return new Date(data + "T12:00:00").getDay();
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
