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
  // Blocklist: ministérios em que o membro não pode ser alocado
  funcoes_nao_pode_ids?: string[];
  // Dias da semana em que o membro NÃO está disponível (0=Dom … 6=Sáb)
  restricoes_dia_semana?: number[];
  // Atuações pastorais para filtragem por categoria
  atuacao_ids?: string[];
  // Sexo: "M" = masculino, "F" = feminino, null = não informado
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
};

export type ContextoEscala = {
  data: string;         // YYYY-MM-DD
  tipo: string;         // missa | evento | retiro | novena | outro
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
  forcado: boolean; // true = Regra Jefferson
  motivo: string;   // human-readable reason for selection
};

export type ResultadoAlocacao = {
  alocacoes: MembroAlocado[];
  alertas: string[];
};

// ── Termos de identificação de ministérios ────────────────────────────────────
// Comparação case-insensitive e flexível para diferentes grafias paroquiais.

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
// NÃO aplica a Regra Jefferson (ela tem lógica própria em alocarMembros).

export function isApto(
  membro: MembroEngine,
  ministerio_id: string,
  data: string,
  indisponibilidades: IndisponibilidadeEngine[],
  ja_alocados: Set<string>,
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
  return true;
}

// ── getFuncoesAdicionais ──────────────────────────────────────────────────────
// Retorna funções extras que devem ser adicionadas com base nas regras litúrgicas.
// Não duplica funções já presentes em funcoes_existentes.

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
      adicionais.push({
        ministerio_id: min.id,
        ministerio_nome: min.nome,
        quantidade,
      });
      ids_existentes.add(min.id);
    }
  }

  // Quinta-feira com Adoração: Turíbulo + Naveta (nunca em domingo)
  // Regra: missas dominicais NÃO recebem turíbulo/naveta automaticamente.
  if (contexto.tem_adoracao && !domingo) {
    if (config.usa_turibulo !== false) addSeFaltando(TERMOS.turibulo, 1);
    if (config.usa_naveta !== false) addSeFaltando(TERMOS.naveta, 1);
  }

  // Missa com Bispo: Baculífero + Mitrífero
  if (contexto.tem_bispo) {
    if (config.usa_baculifero !== false) addSeFaltando(TERMOS.baculifero, 1);
    if (config.usa_mitrifero !== false) addSeFaltando(TERMOS.mitrifero, 1);
  }

  // Remover tochas se a paróquia não as usa
  if (!config.usa_tochas) {
    return adicionais.filter((f) => !nomeContem(f.ministerio_nome, TERMOS.tocha));
  }

  return adicionais;
}

export type HistoricoRecente = {
  membro_id: string;
  ministerio_id: string;
  data: string; // YYYY-MM-DD — data da última alocação neste ministério
};

// ── alocarMembros ─────────────────────────────────────────────────────────────
// Motor principal de alocação. Aplica:
//   1. Regra Jefferson (prioridade máxima em missas solenes)
//   2. Distribuição por score (menor score → mais prioridade = mais justo)
//   3. Respeito a indisponibilidades
//   4. Allowlist/Blocklist de funções por membro
//   5. Anti-repetição consecutiva (penalidade de score se serviu recentemente)
//   6. Sem duplicação na mesma escala

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
  const ja_alocados = new Set<string>();

  const usarPenalidade = config?.impedir_repeticao_seguida !== false;

  // Score efetivo para ordenação dentro de um ministério.
  // Lógica em camadas:
  //   1. Base = score do banco + total de serviços históricos (proxy quando score=0)
  //   2. Penalidade por serviço nos últimos 7 dias (+10 000 por ocorrência)
  //   3. Penalidade adicional por repetição do mesmo ministério (+50 000)
  // Com membros todos em score=0 e sem histórico, o score efetivo é 0 para todos —
  // o embaralhamento prévio (ver abaixo) garante a rotatividade nesse caso.
  function scoreEfetivo(m: MembroEngine, ministerio_id: string): number {
    const totalServicos = historicoRecente
      ? historicoRecente.filter((h) => h.membro_id === m.id).length
      : 0;

    let score = m.score + totalServicos;

    if (!usarPenalidade || !historicoRecente || historicoRecente.length === 0) return score;

    const cutoff = new Date(contexto.data + "T12:00:00");
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const recentes = historicoRecente.filter(
      (h) => h.membro_id === m.id && h.data >= cutoffStr,
    );

    if (recentes.length > 0) {
      score += recentes.length * 10000;
      if (recentes.some((h) => h.ministerio_id === ministerio_id)) score += 50000;
    }

    return score;
  }

  // Fisher-Yates shuffle — aplicado POR FUNÇÃO, depois da filtragem e
  // antes do sort final por scoreEfetivo. Garante aleatoriedade real dentro
  // de cada faixa de pontuação idêntica, independente do score bruto.
  function embaralhar<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Limites de participação (semanal / mensal) ───────────────────────────────
  // Pré-computa quais membros já atingiram o limite no período.
  // A Regra Jefferson ignora esses limites (escalação forçada).
  const membros_acima_do_limite = new Set<string>();
  if (historicoRecente && historicoRecente.length > 0 && (config?.limite_semanal || config?.limite_mensal)) {
    const dataEvento = new Date(contexto.data + "T12:00:00");

    // Janela semanal: 7 dias anteriores ao evento (inclusive)
    const semanaInicio = new Date(dataEvento);
    semanaInicio.setDate(semanaInicio.getDate() - 6);
    const semanaInicioStr = semanaInicio.toISOString().slice(0, 10);

    // Janela mensal: mês calendário do evento
    const ano = dataEvento.getFullYear();
    const mes = String(dataEvento.getMonth() + 1).padStart(2, "0");
    const mesInicioStr = `${ano}-${mes}-01`;

    for (const m of membros) {
      if (config.limite_semanal) {
        const countSemana = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= semanaInicioStr && h.data <= contexto.data,
        ).length;
        if (countSemana >= config.limite_semanal) {
          membros_acima_do_limite.add(m.id);
        }
      }
      if (config.limite_mensal && !membros_acima_do_limite.has(m.id)) {
        const countMes = historicoRecente.filter(
          (h) => h.membro_id === m.id && h.data >= mesInicioStr && h.data <= contexto.data,
        ).length;
        if (countMes >= config.limite_mensal) {
          membros_acima_do_limite.add(m.id);
        }
      }
    }
  }

  // ── Regra Jefferson ─────────────────────────────────────────────────────────
  const solene = ehSoleneContexto(contexto);
  const jefferson = membros.find((m) => m.forcar_escalacao_solene && m.ativo);

  if (jefferson && solene) {
    // Busca a função mais adequada: Ce. do Padre → Ce. Mor
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

        // Alerta se indisponível mas escalado pela regra
        if (estaIndisponivel(jefferson.id, contexto.data, indisponibilidades)) {
          alertas.push(
            `⚠ ${jefferson.nome} está indisponível em ${contexto.data}, mas foi escalado pela Regra Jefferson (missa solene).`,
          );
        }
      } else {
        alertas.push(
          `⚠ Regra Jefferson: ${jefferson.nome} precisa ser escalado, mas não tem o ministério "${funcao_jeff.ministerio_nome}". Verifique o cadastro do membro.`,
        );
      }
    } else {
      alertas.push(
        `⚠ Regra Jefferson: ${jefferson.nome} deve ser escalado, mas não há função Ce. do Padre / Ce. Mor definida nesta escala. Adicione a função manualmente.`,
      );
    }
  }

  // ── Alocação geral por score ────────────────────────────────────────────────
  for (const funcao of funcoes) {
    const ja_nessa_funcao = alocacoes.filter(
      (a) => a.ministerio_id === funcao.ministerio_id,
    ).length;

    let vagas = funcao.quantidade - ja_nessa_funcao;
    if (vagas <= 0) continue;

    // Filtra aptos → embaralha → ordena por scoreEfetivo.
    // O shuffle garante rotatividade aleatória real dentro de faixas de pontuação
    // idêntica, sem depender de ordenação anterior nem de propriedades do sort.
    const aptos = embaralhar(
      membros.filter((m) =>
        !membros_acima_do_limite.has(m.id) &&
        isApto(m, funcao.ministerio_id, contexto.data, indisponibilidades, ja_alocados),
      ),
    ).sort((a, b) => scoreEfetivo(a, funcao.ministerio_id) - scoreEfetivo(b, funcao.ministerio_id));

    // ── Mix de gênero ────────────────────────────────────────────────────────
    // Se todas as vagas seriam preenchidas pelo mesmo gênero conhecido (M ou F)
    // e há membro do outro gênero disponível no pool, troca o último selecionado
    // (pior score) pelo melhor candidato do gênero faltante.
    // Nunca força mix quando só um gênero está disponível ou cadastrado.
    const selecionados = (() => {
      const inicial = aptos.slice(0, vagas);
      if (vagas < 2) return inicial;
      const comGenero = inicial.filter((m) => m.sexo === "M" || m.sexo === "F");
      if (comGenero.length === 0) return inicial; // nenhum gênero cadastrado
      const generoBase = comGenero[0].sexo;
      if (!comGenero.every((m) => m.sexo === generoBase)) return inicial; // já misto
      // Busca o melhor candidato do outro gênero ainda fora da seleção
      const diferente = aptos.slice(vagas).find(
        (m) => m.sexo !== generoBase && (m.sexo === "M" || m.sexo === "F"),
      );
      if (!diferente) return inicial; // outro gênero não disponível, mantém seleção
      return [...inicial.slice(0, vagas - 1), diferente];
    })();

    for (const m of selecionados) {
      const motivo = solene && m.forcar_escalacao_solene
        ? "Regra Jefferson (missa solene)"
        : `Score ${m.score} — menor pontuação`;
      alocacoes.push({
        membro_id: m.id,
        membro_nome: m.nome,
        ministerio_id: funcao.ministerio_id,
        forcado: false,
        motivo,
      });
      ja_alocados.add(m.id);
    }

    const faltando = vagas - selecionados.length;
    if (faltando > 0) {
      alertas.push(
        `⚠ Faltam ${faltando} membro(s) para "${funcao.ministerio_nome}". Sem membros disponíveis suficientes neste ministério.`,
      );
    }
  }

  return { alocacoes, alertas };
}

// ── Regras litúrgicas de classificação ───────────────────────────────────────

export function ehMissaSolene(tipo: string, solene: boolean, tem_bispo: boolean): boolean {
  if (solene || tem_bispo) return true;
  if (tipo === "festa" || tipo === "novena") return true;
  return false;
}

export function getDiaSemana(data: string): number {
  return new Date(data + "T12:00:00").getDay(); // 0=Dom, 6=Sáb
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
