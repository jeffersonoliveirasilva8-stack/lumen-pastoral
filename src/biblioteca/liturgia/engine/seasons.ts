import type { LiturgicalSeason } from '../types';
import { easterDate } from './easter';

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Limites de início de cada tempo litúrgico no ano informado. */
export interface SeasonBoundaries {
  firstAdvent: Date;
  christmas: Date;
  epiphany: Date;
  baptismOfLord: Date;
  ashWednesday: Date;
  holyThursday: Date;
  easter: Date;
  pentecost: Date;
}

export function getSeasonBoundaries(year: number): SeasonBoundaries {
  const easter = easterDate(year);
  const christmas = new Date(year, 11, 25);
  const christmasWeekday = christmas.getDay();
  // Primeiro domingo do Advento = 4 semanas antes do Natal
  const daysToSubtract = christmasWeekday === 0 ? 28 : 22 + christmasWeekday;
  const firstAdvent = new Date(year, 11, 25 - daysToSubtract);

  return {
    firstAdvent,
    christmas,
    // Epifania: 6 de Janeiro (no Brasil é domingo mais próximo)
    epiphany: new Date(year, 0, 6),
    // Batismo do Senhor: domingo após Epifania
    baptismOfLord: (() => {
      const epi = new Date(year, 0, 6);
      const day = epi.getDay();
      return addDays(epi, day === 0 ? 7 : 7 - day);
    })(),
    ashWednesday: addDays(easter, -46),
    holyThursday: addDays(easter, -3),
    easter,
    pentecost: addDays(easter, 49),
  };
}

/** Retorna o tempo litúrgico para uma data dentro de um ano. */
export function getLiturgicalSeason(date: Date, year: number): LiturgicalSeason {
  const b = getSeasonBoundaries(year);
  const t = date.getTime();

  // Verifica também o advento do ano anterior (Dec/Jan)
  const prevB = getSeasonBoundaries(year - 1);

  if (t >= b.firstAdvent.getTime()) return 'advento';
  if (t >= b.christmas.getTime()) return 'natal';
  if (t >= b.pentecost.getTime()) return 'comum';
  if (t >= b.easter.getTime()) return 'pascoa';
  if (t >= b.holyThursday.getTime()) return 'triduo';
  if (t >= b.ashWednesday.getTime()) return 'quaresma';
  // Entre Batismo do Senhor e Cinzas = Tempo Comum I
  if (t >= b.baptismOfLord.getTime()) return 'comum';
  // Entre Natal do ano anterior e Batismo do Senhor
  if (t >= prevB.christmas.getTime()) return 'natal';

  return 'comum';
}
