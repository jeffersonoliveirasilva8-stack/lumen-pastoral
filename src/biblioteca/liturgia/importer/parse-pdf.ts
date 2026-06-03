import type { LiturgicalEntry } from '../types';
import { normalizeRank } from '../constants/ranks';
import { normalizeColor } from '../constants/colors';

/**
 * Parser do formato CNBB (Conferência Nacional dos Bispos do Brasil).
 *
 * Formatos reconhecidos:
 *   "6 de janeiro — Epifania do Senhor — Solenidade — Branco"
 *   "6 jan. — Epifania do Senhor (Sol. – Branco)"
 *   "06/01 Epifania do Senhor Sol. Branco"
 *
 * Retorna entradas brutas; use validateLiturgicalEntries para sanitizar.
 */
export function parseLiturgicalText(
  text: string,
  year?: number
): LiturgicalEntry[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 3);

  const entries: LiturgicalEntry[] = [];
  let currentYear = year ?? new Date().getFullYear();

  for (const line of lines) {
    // Detecta cabeçalho de ano ("2026", "Ano litúrgico 2026")
    const yearMatch = line.match(/\b(20\d{2})\b/);
    if (yearMatch && line.length < 30) {
      currentYear = parseInt(yearMatch[1], 10);
      continue;
    }

    const entry = parseLine(line, currentYear);
    if (entry) entries.push(entry);
  }

  return entries;
}

// ─── Parser de linha individual ───────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function parseLine(line: string, year: number): LiturgicalEntry | null {
  // Padrão 1: "DD de MMMM — Título — Grau — Cor"
  let m = line.match(
    /^(\d{1,2})\s+de\s+([a-záéíóúãõçêâô]+)\.?\s*[—–-]\s*(.+)/i
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthKey = m[2].toLowerCase().slice(0, 3);
    const month = MONTH_MAP[monthKey] ?? MONTH_MAP[m[2].toLowerCase()];
    if (!month) return null;
    return buildEntry(year, month, day, m[3]);
  }

  // Padrão 2: "DD/MM — Título — Grau — Cor"
  m = line.match(/^(\d{1,2})\/(\d{1,2})\s*[—–-]\s*(.+)/);
  if (m) {
    return buildEntry(year, parseInt(m[2], 10), parseInt(m[1], 10), m[3]);
  }

  // Padrão 3: "DD MMM. Título Grau Cor" (sem separador —)
  m = line.match(/^(\d{1,2})\s+([a-záéíóúãõç]+)\.?\s+(.+)/i);
  if (m) {
    const monthKey = m[2].toLowerCase().slice(0, 3);
    const month = MONTH_MAP[monthKey];
    if (!month) return null;
    return buildEntry(year, month, parseInt(m[1], 10), m[3]);
  }

  return null;
}

function buildEntry(
  year: number,
  month: number,
  day: number,
  rest: string
): LiturgicalEntry | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Separa partes por — ou –
  const parts = rest.split(/\s*[—–]\s*/).map((p) => p.trim()).filter(Boolean);

  const titulo = parts[0] ?? rest.trim();
  let grau = parts[1] ? normalizeRank(parts[1]) : undefined;
  let cor = parts[2] ? normalizeColor(parts[2]) : undefined;

  // Tenta extrair grau e cor que estejam embutidos no título
  if (!grau) {
    for (const part of parts) {
      const r = normalizeRank(part);
      if (r) { grau = r; break; }
    }
  }
  if (!cor) {
    for (const part of parts) {
      const c = normalizeColor(part);
      if (c) { cor = c; break; }
    }
  }

  return {
    date,
    titulo: cleanTitle(titulo),
    grau,
    cor,
    origem: 'romano',
    raw: rest,
  };
}

function cleanTitle(title: string): string {
  // Remove marcações de grau que ficaram no título
  return title
    .replace(/\b(solenidade|sol\.|festa|fest\.|memorial|mem\.|comemoracao|comemoração)\b/gi, '')
    .replace(/\b(branco|verde|roxo|vermelho|rosa|preto|dourado)\b/gi, '')
    .replace(/[—–\s]+$/, '')
    .trim();
}
