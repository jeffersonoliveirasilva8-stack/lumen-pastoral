import type { LiturgicalSeason } from '../types';

export const SEASON_LABEL: Record<LiturgicalSeason, string> = {
  advento: 'Advento',
  natal: 'Natal',
  quaresma: 'Quaresma',
  triduo: 'Tríduo Pascal',
  pascoa: 'Tempo Pascal',
  comum: 'Tempo Comum',
};

export const SEASON_COLOR_CLASS: Record<LiturgicalSeason, string> = {
  advento: 'bg-purple-100 text-purple-800 border-purple-200',
  natal: 'bg-amber-100 text-amber-800 border-amber-200',
  quaresma: 'bg-violet-100 text-violet-800 border-violet-200',
  triduo: 'bg-red-100 text-red-800 border-red-200',
  pascoa: 'bg-yellow-100 text-yellow-900 border-yellow-200',
  comum: 'bg-green-100 text-green-800 border-green-200',
};

export const SEASON_DOT_CLASS: Record<LiturgicalSeason, string> = {
  advento: 'bg-purple-500',
  natal: 'bg-amber-400',
  quaresma: 'bg-violet-500',
  triduo: 'bg-red-600',
  pascoa: 'bg-yellow-500',
  comum: 'bg-green-600',
};

/** Cor litúrgica dominante de cada tempo. */
export const SEASON_LITURGICAL_COLOR: Record<LiturgicalSeason, string> = {
  advento: 'roxo',
  natal: 'branco',
  quaresma: 'roxo',
  triduo: 'vermelho',
  pascoa: 'branco',
  comum: 'verde',
};
