import { parseLiturgicalText } from './parse-pdf';
import { validateLiturgicalEntries } from './validate';
import type { LiturgicalEntry } from '../types';

export interface ImportResult {
  entries: LiturgicalEntry[];
  errors: string[];
  warnings: string[];
  stats: { total: number; valid: number; invalid: number; duplicates: number };
}

/** Importa celebrações litúrgicas a partir de texto extraído de PDF. */
export function importLiturgicalText(
  text: string,
  options?: { verbose?: boolean }
): ImportResult {
  const rawEntries = parseLiturgicalText(text);
  const validation = validateLiturgicalEntries(rawEntries);

  if (options?.verbose) {
    console.log(`[import] ${rawEntries.length} entradas extraídas`);
    if (validation.errors.length) console.warn('[import] Erros:', validation.errors);
  }

  return {
    entries: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    stats: {
      total: rawEntries.length,
      valid: validation.valid.length,
      invalid: validation.errors.length,
      duplicates: validation.duplicates,
    },
  };
}
