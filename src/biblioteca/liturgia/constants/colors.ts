import type { LiturgicalColor } from '../types';

/** Cor CSS (hex) para cada cor litúrgica. */
export const LITURGICAL_COLOR_HEX: Record<LiturgicalColor, string> = {
  verde: '#2d6a4f',
  roxo: '#6b21a8',
  branco: '#f5f0e8',
  vermelho: '#b91c1c',
  rosa: '#db2777',
  preto: '#1c1917',
  dourado: '#b45309',
};

export const LITURGICAL_COLOR_LABEL: Record<LiturgicalColor, string> = {
  verde: 'Verde',
  roxo: 'Roxo',
  branco: 'Branco',
  vermelho: 'Vermelho',
  rosa: 'Rosa',
  preto: 'Preto',
  dourado: 'Dourado',
};

/** Classes Tailwind para dot/badge de cor litúrgica. */
export const LITURGICAL_COLOR_CLASS: Record<LiturgicalColor, string> = {
  verde: 'bg-green-700',
  roxo: 'bg-purple-700',
  branco: 'bg-amber-50 border border-amber-200',
  vermelho: 'bg-red-700',
  rosa: 'bg-pink-500',
  preto: 'bg-stone-900',
  dourado: 'bg-amber-600',
};

/** Classes Tailwind para fundo leve (cards, destaques). */
export const LITURGICAL_COLOR_BG: Record<LiturgicalColor, string> = {
  verde: 'bg-green-50 border-green-200',
  roxo: 'bg-purple-50 border-purple-200',
  branco: 'bg-amber-50 border-amber-200',
  vermelho: 'bg-red-50 border-red-200',
  rosa: 'bg-pink-50 border-pink-200',
  preto: 'bg-stone-100 border-stone-300',
  dourado: 'bg-amber-50 border-amber-300',
};

/** Normaliza variações textuais de cor encontradas em PDFs. */
export function normalizeColor(raw: string): LiturgicalColor | undefined {
  const s = raw.toLowerCase().trim();
  if (s.includes('verde')) return 'verde';
  if (s.includes('roxo') || s.includes('violeta') || s.includes('mos')) return 'roxo';
  if (s.includes('branco')) return 'branco';
  if (s.includes('vermelho')) return 'vermelho';
  if (s.includes('rosa')) return 'rosa';
  if (s.includes('preto') || s.includes('negro')) return 'preto';
  if (s.includes('doura') || s.includes('ouro')) return 'dourado';
  return undefined;
}
