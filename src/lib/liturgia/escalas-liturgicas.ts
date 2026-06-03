/**
 * Integração calendário litúrgico → escalas.
 * Dado um dia litúrgico resolvido, retorna:
 *  - Tipo de missa recomendado
 *  - Funções extras necessárias
 *  - Flags (solene, adoração, bispo)
 *  - Regras especiais
 */

import type { LiturgicalDayRecord, LiturgicalResolution } from '@/biblioteca/liturgia/types';
import { RANK_WEIGHT } from '@/biblioteca/liturgia/constants/ranks';

// ─── Tipos de resultado ───────────────────────────────────────────────────────

export interface EscalaLiturgicaConfig {
  /** true = evento solene (aplica Regra Jefferson no engine de escalas) */
  solene: boolean;
  /** Nome do tipo de missa recomendado (para buscar no banco) */
  tipoMissaNome?: string;
  /** Funções litúrgicas extras além das padrão da missa */
  funcoesExtras: FuncaoExtra[];
  /** Observações litúrgicas para exibir no formulário de escala */
  observacoes: string[];
  /** Cor litúrgica do dia */
  corLiturgica: LiturgicalDayRecord['cor'];
  /** Grau da celebração */
  grau: LiturgicalDayRecord['grau'];
  /** Tempo litúrgico */
  tempoLiturgico: LiturgicalDayRecord['tempo_liturgico'];
}

export interface FuncaoExtra {
  /** Nome da função (deve existir em ministerios) */
  nome: string;
  quantidade: number;
  motivo: string;
}

// ─── Configuração de paróquia (injetada) ─────────────────────────────────────

export interface ParoquiaLiturgicaConfig {
  usa_turibulo: boolean;
  usa_naveta: boolean;
  usa_baculifero: boolean;
  usa_mitrifero: boolean;
  usa_tochas: boolean;
}

// ─── Engine de integração ─────────────────────────────────────────────────────

/**
 * Deriva a configuração da escala a partir da resolução litúrgica do dia.
 *
 * Não acessa o banco — usa apenas os dados já resolvidos pela priority-engine.
 */
export function getEscalaConfigForDay(
  resolution: LiturgicalResolution,
  paroquiaConfig: ParoquiaLiturgicaConfig,
  options?: {
    /** Quinta-feira: adiciona turíbulo se paróquia usa e for solene */
    isThursday?: boolean;
    /** Se haverá adoração (informado no formulário de escala) */
    temAdoracao?: boolean;
    /** Se haverá bispo (informado no formulário de escala) */
    temBispo?: boolean;
  }
): EscalaLiturgicaConfig {
  const cel = resolution.celebration;
  const rank = RANK_WEIGHT[cel.grau] ?? 1;

  const isSolene = rank >= RANK_WEIGHT['festa'] || cel.e_solene === true;
  const isSolenidade = rank >= RANK_WEIGHT['solenidade'];

  const funcoesExtras: FuncaoExtra[] = [];
  const observacoes: string[] = [];

  // ── Turíbulo e naveta ──────────────────────────────────────────────────────
  const needsIncense =
    options?.temAdoracao ||
    options?.isThursday ||
    isSolenidade ||
    cel.titulo.toLowerCase().includes('corpus') ||
    cel.titulo.toLowerCase().includes('quinta');

  if (needsIncense) {
    if (paroquiaConfig.usa_turibulo) {
      funcoesExtras.push({ nome: 'Turiferário', quantidade: 1, motivo: 'Missa solene / adoração' });
    }
    if (paroquiaConfig.usa_naveta) {
      funcoesExtras.push({ nome: 'Naveteiro', quantidade: 1, motivo: 'Missa com turíbulo' });
    }
  }

  // ── Baculífero e mitrífero (missa com bispo) ──────────────────────────────
  if (options?.temBispo) {
    if (paroquiaConfig.usa_baculifero) {
      funcoesExtras.push({ nome: 'Baculífero', quantidade: 1, motivo: 'Missa episcopal' });
    }
    if (paroquiaConfig.usa_mitrifero) {
      funcoesExtras.push({ nome: 'Mitrífero', quantidade: 1, motivo: 'Missa episcopal' });
    }
    observacoes.push('Missa presidida por Bispo — protocolo especial necessário');
  }

  // ── Tochas ────────────────────────────────────────────────────────────────
  if (paroquiaConfig.usa_tochas && isSolenidade) {
    funcoesExtras.push({ nome: 'Tochas', quantidade: 2, motivo: 'Solenidade' });
  }

  // ── Observações litúrgicas ────────────────────────────────────────────────
  if (isSolenidade) observacoes.push(`Solenidade: ${cel.titulo}`);
  if (cel.e_padroeiro) observacoes.push('Dia do Padroeiro — escala reforçada recomendada');
  if (cel.e_dia_preceito) observacoes.push('Dia de preceito — maior participação esperada');
  if (options?.temAdoracao) observacoes.push('Missa com Adoração ao Santíssimo');

  // ── Tipo de missa recomendado ─────────────────────────────────────────────
  let tipoMissaNome: string | undefined;
  if (options?.temBispo) tipoMissaNome = 'Missa Episcopal';
  else if (cel.e_padroeiro) tipoMissaNome = 'Missa do Padroeiro';
  else if (isSolenidade) tipoMissaNome = 'Missa Solene';
  else if (rank >= RANK_WEIGHT['festa']) tipoMissaNome = 'Missa Festiva';

  return {
    solene: isSolene,
    tipoMissaNome,
    funcoesExtras,
    observacoes,
    corLiturgica: cel.cor,
    grau: cel.grau,
    tempoLiturgico: cel.tempo_liturgico,
  };
}

/**
 * Retorna funções litúrgicas extras para o contexto informado,
 * sem depender de uma resolução completa (uso direto no formulário de escala).
 */
export function getFuncoesExtrasParaContexto(
  contexto: {
    solene: boolean;
    temAdoracao: boolean;
    temBispo: boolean;
    isThursday?: boolean;
  },
  paroquiaConfig: ParoquiaLiturgicaConfig
): FuncaoExtra[] {
  const extras: FuncaoExtra[] = [];

  const needsIncense = contexto.temAdoracao || contexto.isThursday || (contexto.solene);
  if (needsIncense && paroquiaConfig.usa_turibulo) {
    extras.push({ nome: 'Turiferário', quantidade: 1, motivo: 'Contexto litúrgico' });
  }
  if (needsIncense && paroquiaConfig.usa_naveta) {
    extras.push({ nome: 'Naveteiro', quantidade: 1, motivo: 'Contexto litúrgico' });
  }
  if (contexto.temBispo) {
    if (paroquiaConfig.usa_baculifero) extras.push({ nome: 'Baculífero', quantidade: 1, motivo: 'Missa episcopal' });
    if (paroquiaConfig.usa_mitrifero) extras.push({ nome: 'Mitrífero', quantidade: 1, motivo: 'Missa episcopal' });
  }
  if (paroquiaConfig.usa_tochas && contexto.solene) {
    extras.push({ nome: 'Tochas', quantidade: 2, motivo: 'Solenidade' });
  }

  return extras;
}
