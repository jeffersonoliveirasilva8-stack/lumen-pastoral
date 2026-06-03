import type { LiturgicalRank } from '../types';

/** Peso numérico de cada grau litúrgico (maior = maior precedência). */
export const RANK_WEIGHT: Record<LiturgicalRank, number> = {
  solenidade: 5,
  festa: 4,
  memorial: 3,
  memorial_facultativo: 2,
  comemoracao: 1,
};

export const RANK_LABEL: Record<LiturgicalRank, string> = {
  solenidade: 'Solenidade',
  festa: 'Festa',
  memorial: 'Memorial',
  memorial_facultativo: 'Memorial Facultativo',
  comemoracao: 'Comemoração',
};

export const RANK_ABBR: Record<LiturgicalRank, string> = {
  solenidade: 'Sol.',
  festa: 'Fest.',
  memorial: 'Mem.',
  memorial_facultativo: 'Mem.Fac.',
  comemoracao: 'Com.',
};

/** Classes Tailwind para badge de grau. */
export const RANK_BADGE_CLASS: Record<LiturgicalRank, string> = {
  solenidade: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  festa: 'bg-blue-100 text-blue-900 border-blue-300',
  memorial: 'bg-slate-100 text-slate-800 border-slate-200',
  memorial_facultativo: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  comemoracao: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** Normaliza variações textuais encontradas em PDFs para o enum interno. */
export function normalizeRank(raw: string): LiturgicalRank | undefined {
  const s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.includes('solenidade') || s.includes('sol.')) return 'solenidade';
  if (s.includes('festa') || s.includes('fest.')) return 'festa';
  if (s.includes('memorial fac') || s.includes('mem.fac') || s.includes('opt')) return 'memorial_facultativo';
  if (s.includes('memorial') || s.includes('mem.')) return 'memorial';
  if (s.includes('comemora')) return 'comemoracao';
  return undefined;
}
