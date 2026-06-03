// ─── Enums centrais ───────────────────────────────────────────────────────────

export type LiturgicalRank =
  | 'solenidade'
  | 'festa'
  | 'memorial'
  | 'memorial_facultativo'
  | 'comemoracao';

export type LiturgicalColor =
  | 'verde'
  | 'roxo'
  | 'branco'
  | 'vermelho'
  | 'rosa'
  | 'preto'
  | 'dourado';

export type LiturgicalSeason =
  | 'advento'
  | 'natal'
  | 'quaresma'
  | 'triduo'
  | 'pascoa'
  | 'comum';

export type LiturgicalOrigin = 'romano' | 'diocesano' | 'paroquial';

// ─── Celebração litúrgica (DB + computed) ─────────────────────────────────────

/** Representação de um dia litúrgico usado nos componentes e serviço. */
export interface LiturgicalDayRecord {
  /** ISO date string YYYY-MM-DD */
  date: string;
  titulo: string;
  subtitulo?: string;
  santo?: string;
  grau: LiturgicalRank;
  cor: LiturgicalColor;
  tempo_liturgico: LiturgicalSeason;
  /** Referência textual (ex: "Jo 14,1-6") */
  evangelho?: string;
  leitura_1?: string;
  leitura_2?: string;
  salmo?: string;
  prefacio?: string;
  e_dia_preceito?: boolean;
  e_solene?: boolean;
  e_padroeiro?: boolean;
  origem: LiturgicalOrigin;
  /** ID no banco (undefined = celebração calculada, não persistida) */
  id?: string;
}

// ─── Entrada bruta do importador ─────────────────────────────────────────────

/** Saída crua do parser de PDF/JSON — ainda não validada. */
export interface LiturgicalEntry {
  /** ISO date string YYYY-MM-DD */
  date: string;
  titulo: string;
  subtitulo?: string;
  santo?: string;
  grau?: LiturgicalRank;
  cor?: LiturgicalColor;
  evangelho?: string;
  leitura_1?: string;
  leitura_2?: string;
  salmo?: string;
  e_dia_preceito?: boolean;
  /** Origem do arquivo importado */
  origem: LiturgicalOrigin;
  /** Linha original para debugging */
  raw?: string;
}

// ─── Resultado de resolução de conflitos ─────────────────────────────────────

export interface LiturgicalResolution {
  /** Celebração vencedora após resolver conflitos */
  celebration: LiturgicalDayRecord;
  /** Celebrações perdedoras (grau menor) */
  displaced: LiturgicalDayRecord[];
  /** Todas as celebrações do dia (antes de resolver) */
  allCelebrations: LiturgicalDayRecord[];
  /** Fonte da celebração final */
  origin: LiturgicalOrigin;
  /** Nível numérico de prioridade (4=solenidade … 1=comemoracao) */
  priority: number;
}
