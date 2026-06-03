import type { LiturgicalSeason } from '@/biblioteca/liturgia/types';
import { SEASON_LABEL, SEASON_COLOR_CLASS, SEASON_DOT_CLASS } from '@/biblioteca/liturgia/constants/seasons';
import { cn } from '@/lib/utils';

interface SeasonBannerProps {
  season: LiturgicalSeason;
  year?: number;
  className?: string;
}

export function SeasonBanner({ season, year, className }: SeasonBannerProps) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', SEASON_COLOR_CLASS[season], className)}>
      <span className={cn('h-2.5 w-2.5 rounded-full', SEASON_DOT_CLASS[season])} />
      <span className="text-sm font-medium">
        {SEASON_LABEL[season]}
        {year && <span className="ml-1 font-normal opacity-70">{year}</span>}
      </span>
    </div>
  );
}
