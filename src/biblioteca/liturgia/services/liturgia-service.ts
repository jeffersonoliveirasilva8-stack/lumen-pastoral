import type { LiturgicalDayRecord, LiturgicalResolution } from '../types';
import { getComputedCelebrations, resolveCelebrations } from '../engine/liturgical-engine';
import { getLiturgicalSeason } from '../engine/seasons';
import { liturgiaCache, cacheKey } from './liturgia-cache';

// ─── Adaptador de banco (injetado em runtime para manter este módulo puro) ───

export interface LiturgiaDbAdapter {
  /** Busca celebrações da liturgia_base para um intervalo de datas. */
  queryBase(startDate: string, endDate: string): Promise<LiturgicalDayRecord[]>;
  /** Busca overrides da diocese para um intervalo. */
  queryDiocese(startDate: string, endDate: string, dioceseId?: string): Promise<LiturgicalDayRecord[]>;
  /** Busca customizações da paróquia para um intervalo. */
  queryParoquia(startDate: string, endDate: string, paroquiaId: string): Promise<LiturgicalDayRecord[]>;
}

let _adapter: LiturgiaDbAdapter | null = null;

/** Injeta o adaptador de banco (deve ser chamado na inicialização do app). */
export function setDbAdapter(adapter: LiturgiaDbAdapter): void {
  _adapter = adapter;
}

// ─── Serviço principal ───────────────────────────────────────────────────────

/**
 * Retorna celebrações para um mês, mesclando DB + calendário computado.
 * Se o banco não tiver dados para o ano, usa apenas o calendário computado.
 */
export async function getLiturgicalMonth(
  year: number,
  month: number, // 1–12
  paroquiaId?: string
): Promise<Map<string, LiturgicalDayRecord[]>> {
  const key = cacheKey({ year, month, paroquiaId });
  const cached = liturgiaCache.get(key);
  if (cached) {
    return groupByDate(cached);
  }

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = lastDayOfMonth(year, month);

  // Coleta de todas as celebrações do mês
  const all: LiturgicalDayRecord[] = [];

  // 1. Calendário computado (sempre disponível, offline)
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const computed = getComputedCelebrations(dateStr);
    all.push(...computed);
  }

  // 2. DB overrides (quando o adaptador estiver configurado)
  if (_adapter) {
    try {
      const [base, diocese, paroquia] = await Promise.all([
        _adapter.queryBase(start, end),
        _adapter.queryDiocese(start, end),
        paroquiaId ? _adapter.queryParoquia(start, end, paroquiaId) : Promise.resolve([]),
      ]);
      // DB tem precedência sobre computed para mesmas datas
      all.push(...base, ...diocese, ...paroquia);
    } catch {
      // fallback silencioso para calendário computado
    }
  }

  liturgiaCache.set(key, all);
  return groupByDate(all);
}

/**
 * Retorna a resolução litúrgica final para uma data específica.
 * Agrega computed + DB, resolve conflitos e retorna celebração vencedora.
 */
export async function resolveLiturgicalDay(
  date: string,
  paroquiaId?: string
): Promise<LiturgicalResolution | null> {
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(5, 7), 10);
  const map = await getLiturgicalMonth(year, month, paroquiaId);
  const celebrations = map.get(date) ?? [];
  return resolveCelebrations(celebrations);
}

/**
 * Retorna o tempo litúrgico de uma data sem consultar o banco.
 * Útil para colorir calendários sem async.
 */
export function getSeasonSync(date: string): ReturnType<typeof getLiturgicalSeason> {
  const d = new Date(date + 'T12:00:00');
  return getLiturgicalSeason(d, d.getFullYear());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByDate(records: LiturgicalDayRecord[]): Map<string, LiturgicalDayRecord[]> {
  const map = new Map<string, LiturgicalDayRecord[]>();
  for (const rec of records) {
    const list = map.get(rec.date) ?? [];
    list.push(rec);
    map.set(rec.date, list);
  }
  return map;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function lastDayOfMonth(year: number, month: number): string {
  const d = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
