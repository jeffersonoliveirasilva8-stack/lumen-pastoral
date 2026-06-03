// src/biblioteca/liturgical-calendar.ts
// Calendário Litúrgico Católico — versão expandida e preparada para atualização anual
// Compatível com o sistema de escalas / calendário litúrgico da pastoral

export type LiturgicalRank =
  | "solenidade"
  | "festa"
  | "memorial"
  | "comemoracao";

export type LiturgicalColor =
  | "branco"
  | "roxo"
  | "verde"
  | "vermelho"
  | "rosa"
  | "preto"
  | "dourado";

export type LiturgicalSeason =
  | "advento"
  | "natal"
  | "comum"
  | "quaresma"
  | "triduo"
  | "pascoa";

export interface LiturgicalDay {
  date: Date;
  name: string;
  rank: LiturgicalRank;
  color: LiturgicalColor;
  season?: LiturgicalSeason;
  moveable: boolean;
  saint?: boolean;
  obligation?: boolean;
}

interface FixedCelebration {
  month: number;
  day: number;
  name: string;
  rank: LiturgicalRank;
  color: LiturgicalColor;
  season?: LiturgicalSeason;
  saint?: boolean;
  obligation?: boolean;
}

interface MoveableCelebration {
  offset: number;
  name: string;
  rank: LiturgicalRank;
  color: LiturgicalColor;
  season?: LiturgicalSeason;
  saint?: boolean;
  obligation?: boolean;
}

/* ============================================================================
   ALGORITMO DA PÁSCOA
============================================================================ */

export function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);

  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/* ============================================================================
   CELEBRAÇÕES FIXAS
============================================================================ */

const FIXED_CELEBRATIONS: FixedCelebration[] = [
  // JANEIRO
  {
    month: 1,
    day: 1,
    name: "Santa Maria, Mãe de Deus",
    rank: "solenidade",
    color: "branco",
    saint: true,
    obligation: true,
  },
  {
    month: 1,
    day: 6,
    name: "Epifania do Senhor",
    rank: "solenidade",
    color: "branco",
    obligation: true,
  },
  {
    month: 1,
    day: 25,
    name: "Conversão de São Paulo",
    rank: "festa",
    color: "branco",
    saint: true,
  },

  // FEVEREIRO
  {
    month: 2,
    day: 2,
    name: "Apresentação do Senhor",
    rank: "festa",
    color: "branco",
  },
  {
    month: 2,
    day: 11,
    name: "Nossa Senhora de Lourdes",
    rank: "memorial",
    color: "branco",
    saint: true,
  },
  {
    month: 2,
    day: 22,
    name: "Cátedra de São Pedro",
    rank: "festa",
    color: "branco",
    saint: true,
  },

  // MARÇO
  {
    month: 3,
    day: 19,
    name: "São José",
    rank: "solenidade",
    color: "branco",
    saint: true,
    obligation: true,
  },
  {
    month: 3,
    day: 25,
    name: "Anunciação do Senhor",
    rank: "solenidade",
    color: "branco",
    obligation: true,
  },

  // ABRIL
  {
    month: 4,
    day: 25,
    name: "São Marcos Evangelista",
    rank: "festa",
    color: "vermelho",
    saint: true,
  },

  // MAIO
  {
    month: 5,
    day: 1,
    name: "São José Operário",
    rank: "memorial",
    color: "branco",
    saint: true,
  },
  {
    month: 5,
    day: 13,
    name: "Nossa Senhora de Fátima",
    rank: "memorial",
    color: "branco",
    saint: true,
  },
  {
    month: 5,
    day: 31,
    name: "Visitação de Nossa Senhora",
    rank: "festa",
    color: "branco",
    saint: true,
  },

  // JUNHO
  {
    month: 6,
    day: 24,
    name: "Nascimento de São João Batista",
    rank: "solenidade",
    color: "branco",
    saint: true,
  },
  {
    month: 6,
    day: 29,
    name: "São Pedro e São Paulo",
    rank: "solenidade",
    color: "vermelho",
    saint: true,
    obligation: true,
  },

  // JULHO
  {
    month: 7,
    day: 16,
    name: "Nossa Senhora do Carmo",
    rank: "memorial",
    color: "branco",
    saint: true,
  },
  {
    month: 7,
    day: 22,
    name: "Santa Maria Madalena",
    rank: "festa",
    color: "branco",
    saint: true,
  },

  // AGOSTO
  {
    month: 8,
    day: 6,
    name: "Transfiguração do Senhor",
    rank: "festa",
    color: "branco",
  },
  {
    month: 8,
    day: 15,
    name: "Assunção de Nossa Senhora",
    rank: "solenidade",
    color: "branco",
    saint: true,
    obligation: true,
  },

  // SETEMBRO
  {
    month: 9,
    day: 14,
    name: "Exaltação da Santa Cruz",
    rank: "festa",
    color: "vermelho",
  },
  {
    month: 9,
    day: 29,
    name: "São Miguel, São Gabriel e São Rafael",
    rank: "festa",
    color: "branco",
    saint: true,
  },

  // OUTUBRO
  {
    month: 10,
    day: 1,
    name: "Santa Teresinha do Menino Jesus",
    rank: "memorial",
    color: "branco",
    saint: true,
  },
  {
    month: 10,
    day: 12,
    name: "Nossa Senhora Aparecida",
    rank: "solenidade",
    color: "branco",
    saint: true,
    obligation: true,
  },
  {
    month: 10,
    day: 18,
    name: "São Lucas Evangelista",
    rank: "festa",
    color: "vermelho",
    saint: true,
  },

  // NOVEMBRO
  {
    month: 11,
    day: 1,
    name: "Todos os Santos",
    rank: "solenidade",
    color: "branco",
    obligation: true,
  },
  {
    month: 11,
    day: 2,
    name: "Comemoração de Todos os Fiéis Defuntos",
    rank: "comemoracao",
    color: "preto",
  },

  // DEZEMBRO
  {
    month: 12,
    day: 8,
    name: "Imaculada Conceição",
    rank: "solenidade",
    color: "branco",
    saint: true,
  },
  {
    month: 12,
    day: 25,
    name: "Natal do Senhor",
    rank: "solenidade",
    color: "branco",
    obligation: true,
  },
];

/* ============================================================================
   CELEBRAÇÕES MÓVEIS
============================================================================ */

function getMoveableCelebrations(): MoveableCelebration[] {
  return [
    {
      offset: -46,
      name: "Quarta-feira de Cinzas",
      rank: "solenidade",
      color: "roxo",
      season: "quaresma",
    },
    {
      offset: -7,
      name: "Domingo de Ramos",
      rank: "solenidade",
      color: "vermelho",
      season: "quaresma",
    },
    {
      offset: -3,
      name: "Quinta-feira Santa",
      rank: "solenidade",
      color: "branco",
      season: "triduo",
    },
    {
      offset: -2,
      name: "Sexta-feira da Paixão do Senhor",
      rank: "solenidade",
      color: "vermelho",
      season: "triduo",
    },
    {
      offset: -1,
      name: "Sábado Santo",
      rank: "solenidade",
      color: "branco",
      season: "triduo",
    },
    {
      offset: 0,
      name: "Domingo de Páscoa",
      rank: "solenidade",
      color: "branco",
      season: "pascoa",
    },
    {
      offset: 39,
      name: "Ascensão do Senhor",
      rank: "solenidade",
      color: "branco",
      season: "pascoa",
    },
    {
      offset: 49,
      name: "Pentecostes",
      rank: "solenidade",
      color: "vermelho",
      season: "pascoa",
    },
    {
      offset: 56,
      name: "Santíssima Trindade",
      rank: "solenidade",
      color: "branco",
    },
    {
      offset: 60,
      name: "Corpus Christi",
      rank: "solenidade",
      color: "branco",
    },
    {
      offset: 68,
      name: "Sagrado Coração de Jesus",
      rank: "solenidade",
      color: "vermelho",
    },
  ];
}

/* ============================================================================
   CALENDÁRIO COMPLETO
============================================================================ */

export function getLiturgicalDays(year: number): LiturgicalDay[] {
  const days: LiturgicalDay[] = [];

  // Datas fixas
  FIXED_CELEBRATIONS.forEach((item) => {
    days.push({
      ...item,
      date: new Date(year, item.month - 1, item.day),
      moveable: false,
    });
  });

  // Datas móveis
  const easter = easterDate(year);

  getMoveableCelebrations().forEach((item) => {
    days.push({
      ...item,
      date: addDays(easter, item.offset),
      moveable: true,
    });
  });

  // 1º Domingo do Advento
  const christmas = new Date(year, 11, 25);
  const christmasWeekday = christmas.getDay();
  const daysBeforeChristmas =
    christmasWeekday === 0 ? 28 : 22 + christmasWeekday;

  const firstAdvent = new Date(
    year,
    11,
    25 - daysBeforeChristmas
  );

  days.push({
    date: firstAdvent,
    name: "1º Domingo do Advento",
    rank: "solenidade",
    color: "roxo",
    season: "advento",
    moveable: true,
  });

  // Cristo Rei
  days.push({
    date: addDays(firstAdvent, -7),
    name: "Nosso Senhor Jesus Cristo, Rei do Universo",
    rank: "solenidade",
    color: "branco",
    moveable: true,
  });

  return days.sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
}

/* ============================================================================
   TEMPO LITÚRGICO
============================================================================ */

export function getLiturgicalSeason(
  date: Date,
  year: number
): LiturgicalSeason {
  const easter = easterDate(year);

  const ashWednesday = addDays(easter, -46);
  const holyThursday = addDays(easter, -3);
  const pentecost = addDays(easter, 49);

  const christmas = new Date(year, 11, 25);

  const christmasWeekday = christmas.getDay();
  const daysBeforeChristmas =
    christmasWeekday === 0 ? 28 : 22 + christmasWeekday;

  const firstAdvent = new Date(
    year,
    11,
    25 - daysBeforeChristmas
  );

  const d = date.getTime();

  if (d >= firstAdvent.getTime()) return "advento";
  if (d >= christmas.getTime()) return "natal";
  if (d >= pentecost.getTime()) return "comum";
  if (d >= holyThursday.getTime()) return "triduo";
  if (d >= easter.getTime()) return "pascoa";
  if (d >= ashWednesday.getTime()) return "quaresma";

  return "comum";
}

/* ============================================================================
   LABELS / CORES
============================================================================ */

export const SEASON_LABELS: Record<LiturgicalSeason, string> = {
  advento: "Advento",
  natal: "Natal",
  comum: "Tempo Comum",
  quaresma: "Quaresma",
  triduo: "Tríduo Pascal",
  pascoa: "Tempo Pascal",
};

export const SEASON_COLOR: Record<LiturgicalSeason, string> = {
  advento: "bg-purple-100 text-purple-800",
  natal: "bg-yellow-100 text-yellow-800",
  comum: "bg-green-100 text-green-800",
  quaresma: "bg-violet-100 text-violet-800",
  triduo: "bg-red-100 text-red-800",
  pascoa: "bg-amber-100 text-amber-800",
};

export const RANK_LABEL: Record<LiturgicalRank, string> = {
  solenidade: "Solenidade",
  festa: "Festa",
  memorial: "Memorial",
  comemoracao: "Comemoração",
};

export const RANK_BADGE: Record<LiturgicalRank, string> = {
  solenidade: "bg-yellow-100 text-yellow-900 border-yellow-200",
  festa: "bg-blue-100 text-blue-900 border-blue-200",
  memorial: "bg-gray-100 text-gray-800 border-gray-200",
  comemoracao: "bg-zinc-100 text-zinc-800 border-zinc-200",
};
