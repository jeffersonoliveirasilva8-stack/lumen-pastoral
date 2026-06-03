import type { LiturgicalRank, LiturgicalColor, LiturgicalSeason, LiturgicalDayRecord } from '../types';
import { easterDate } from './easter';
import { getLiturgicalSeason } from './seasons';

interface MovableFeast {
  /** Offset em dias a partir da Páscoa (negativo = antes). */
  offset: number;
  titulo: string;
  subtitulo?: string;
  grau: LiturgicalRank;
  cor: LiturgicalColor;
  season?: LiturgicalSeason;
  e_dia_preceito?: boolean;
  e_solene?: boolean;
}

const MOVABLE_FEASTS: MovableFeast[] = [
  { offset: -46, titulo: 'Quarta-feira de Cinzas', grau: 'solenidade', cor: 'roxo', season: 'quaresma' },
  { offset: -7,  titulo: 'Domingo de Ramos', subtitulo: 'Paixão do Senhor', grau: 'solenidade', cor: 'vermelho', season: 'quaresma' },
  { offset: -3,  titulo: 'Quinta-feira Santa', subtitulo: 'Missa In Cena Domini', grau: 'solenidade', cor: 'branco', season: 'triduo', e_solene: true },
  { offset: -2,  titulo: 'Sexta-feira da Paixão do Senhor', grau: 'solenidade', cor: 'vermelho', season: 'triduo' },
  { offset: -1,  titulo: 'Sábado Santo', subtitulo: 'Vigília Pascal', grau: 'solenidade', cor: 'branco', season: 'triduo' },
  { offset: 0,   titulo: 'Domingo de Páscoa', subtitulo: 'Ressurreição do Senhor', grau: 'solenidade', cor: 'branco', season: 'pascoa', e_dia_preceito: true, e_solene: true },
  { offset: 7,   titulo: 'Domingo da Misericórdia', subtitulo: '2º Domingo de Páscoa', grau: 'solenidade', cor: 'branco', season: 'pascoa' },
  { offset: 39,  titulo: 'Ascensão do Senhor', grau: 'solenidade', cor: 'branco', season: 'pascoa', e_dia_preceito: true },
  { offset: 49,  titulo: 'Pentecostes', grau: 'solenidade', cor: 'vermelho', e_dia_preceito: true, e_solene: true },
  { offset: 56,  titulo: 'Santíssima Trindade', grau: 'solenidade', cor: 'branco', e_solene: true },
  { offset: 60,  titulo: 'Corpus Christi', subtitulo: 'Santíssimo Corpo e Sangue de Cristo', grau: 'solenidade', cor: 'branco', e_dia_preceito: true, e_solene: true },
  { offset: 68,  titulo: 'Sagrado Coração de Jesus', grau: 'solenidade', cor: 'vermelho', e_solene: true },
  { offset: 69,  titulo: 'Imaculado Coração de Maria', grau: 'memorial', cor: 'branco' },
];

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Retorna todas as celebrações móveis calculadas para um ano. */
export function getMovableFeasts(year: number): LiturgicalDayRecord[] {
  const easter = easterDate(year);
  const records: LiturgicalDayRecord[] = [];

  for (const feast of MOVABLE_FEASTS) {
    const date = addDays(easter, feast.offset);
    records.push({
      date: toISO(date),
      titulo: feast.titulo,
      subtitulo: feast.subtitulo,
      grau: feast.grau,
      cor: feast.cor,
      tempo_liturgico: feast.season ?? getLiturgicalSeason(date, year),
      e_dia_preceito: feast.e_dia_preceito ?? false,
      e_solene: feast.e_solene ?? false,
      origem: 'romano',
    });
  }

  // Batismo do Senhor — domingo após a Epifania (6 jan)
  // Se a Epifania cair num sábado, o Batismo é na segunda-feira seguinte
  const epiphany = new Date(year, 0, 6);
  const epiphanyDay = epiphany.getDay(); // 0=dom … 6=sab
  const daysToNextSunday = epiphanyDay === 0 ? 7 : (7 - epiphanyDay);
  const baptism = addDays(epiphany, daysToNextSunday);
  records.push({
    date: toISO(baptism),
    titulo: 'Batismo do Senhor',
    grau: 'festa',
    cor: 'branco',
    tempo_liturgico: 'natal',
    origem: 'romano',
  });

  // Sagrada Família — domingo na oitava do Natal
  // Se não houver domingo entre 26/12 e 31/12, celebra-se em 30/12
  let familyDate: Date | null = null;
  for (let d = 26; d <= 31; d++) {
    const candidate = new Date(year, 11, d);
    if (candidate.getDay() === 0) { familyDate = candidate; break; }
  }
  if (!familyDate) familyDate = new Date(year, 11, 30);
  records.push({
    date: toISO(familyDate),
    titulo: 'Sagrada Família de Jesus, Maria e José',
    grau: 'festa',
    cor: 'branco',
    tempo_liturgico: 'natal',
    e_solene: true,
    origem: 'romano',
  });

  // Primeiro Domingo do Advento
  const christmas = new Date(year, 11, 25);
  const christmasWeekday = christmas.getDay();
  const daysToSubtract = christmasWeekday === 0 ? 28 : 22 + christmasWeekday;
  const firstAdvent = new Date(year, 11, 25 - daysToSubtract);
  records.push({
    date: toISO(firstAdvent),
    titulo: '1º Domingo do Advento',
    grau: 'solenidade',
    cor: 'roxo',
    tempo_liturgico: 'advento',
    origem: 'romano',
  });

  // Cristo Rei (domingo antes do 1º Advento)
  const christRex = addDays(firstAdvent, -7);
  records.push({
    date: toISO(christRex),
    titulo: 'Nosso Senhor Jesus Cristo, Rei do Universo',
    subtitulo: 'Solenidade',
    grau: 'solenidade',
    cor: 'branco',
    tempo_liturgico: 'comum',
    e_solene: true,
    origem: 'romano',
  });

  return records;
}
