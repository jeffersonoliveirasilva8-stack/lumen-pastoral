import type { LiturgicalRank } from '../types';
import { RANK_WEIGHT } from '../constants/ranks';

export const PRECEDENCE = RANK_WEIGHT;

export function shouldOverride(
  current: LiturgicalRank,
  incoming: LiturgicalRank
): boolean {
  return (RANK_WEIGHT[incoming] ?? 0) > (RANK_WEIGHT[current] ?? 0);
}
