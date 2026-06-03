import type { LiturgicalDayRecord } from '../types';

interface CacheEntry {
  data: LiturgicalDayRecord[];
  expiresAt: number;
}

/** Cache em memória para dados litúrgicos com TTL configurável. */
export class LiturgiaCache {
  private store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMinutes = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(key: string): LiturgicalDayRecord[] | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: LiturgicalDayRecord[]): void {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key?: string): void {
    if (key) this.store.delete(key);
    else this.store.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  get size(): number {
    return this.store.size;
  }
}

/** Gera chave de cache para ano/mês ou range. */
export function cacheKey(params: { year: number; month?: number; paroquiaId?: string }): string {
  const parts = [`y:${params.year}`];
  if (params.month !== undefined) parts.push(`m:${params.month}`);
  if (params.paroquiaId) parts.push(`p:${params.paroquiaId}`);
  return parts.join('|');
}

/** Singleton compartilhado. TTL: 60 min. */
export const liturgiaCache = new LiturgiaCache(60);
