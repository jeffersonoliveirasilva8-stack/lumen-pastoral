import type { LiturgicalRank, LiturgicalColor, LiturgicalSeason } from '@/biblioteca/liturgia/types';
import { RANK_BADGE_CLASS, RANK_LABEL } from '@/biblioteca/liturgia/constants/ranks';
import { LITURGICAL_COLOR_CLASS } from '@/biblioteca/liturgia/constants/colors';
import { SEASON_COLOR_CLASS, SEASON_LABEL } from '@/biblioteca/liturgia/constants/seasons';
import { cn } from '@/lib/utils';

// ─── Badge de grau ────────────────────────────────────────────────────────────

interface RankBadgeProps {
  rank: LiturgicalRank;
  size?: 'xs' | 'sm';
  className?: string;
}

export function RankBadge({ rank, size = 'xs', className }: RankBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        RANK_BADGE_CLASS[rank],
        className
      )}
    >
      {RANK_LABEL[rank]}
    </span>
  );
}

// ─── Ponto de cor litúrgica ───────────────────────────────────────────────────

interface ColorDotProps {
  color: LiturgicalColor;
  size?: 'sm' | 'md';
  className?: string;
}

export function LiturgicalColorDot({ color, size = 'sm', className }: ColorDotProps) {
  return (
    <span
      className={cn(
        'rounded-full shrink-0',
        size === 'sm' ? 'h-2 w-2' : 'h-3 w-3',
        LITURGICAL_COLOR_CLASS[color],
        className
      )}
      title={color}
    />
  );
}

// ─── Badge de tempo litúrgico ─────────────────────────────────────────────────

interface SeasonBadgeProps {
  season: LiturgicalSeason;
  size?: 'xs' | 'sm';
  className?: string;
}

export function SeasonBadge({ season, size = 'xs', className }: SeasonBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        SEASON_COLOR_CLASS[season],
        className
      )}
    >
      {SEASON_LABEL[season]}
    </span>
  );
}

// ─── Badge composto (grau + cor) ──────────────────────────────────────────────

interface LiturgicalBadgeProps {
  rank: LiturgicalRank;
  color: LiturgicalColor;
  showColor?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

export function LiturgicalBadge({ rank, color, showColor = true, size = 'xs', className }: LiturgicalBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {showColor && <LiturgicalColorDot color={color} />}
      <RankBadge rank={rank} size={size} />
    </span>
  );
}
