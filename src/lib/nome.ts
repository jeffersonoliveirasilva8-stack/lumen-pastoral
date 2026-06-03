/**
 * Utilitários de exibição de nomes de membros.
 *
 * Regra: retorna "PrimeiroNome ÚltimoSobrenome" ignorando preposições
 * (de, da, do, dos, das, e, com…), evitando casos como "Renato dos".
 *
 * Exemplos:
 *   "Renato dos Santos"       → "Renato Santos"
 *   "José Carlos da Silva"    → "José Silva"
 *   "Maria Aparecida"         → "Maria Aparecida"
 *   "João"                    → "João"
 */

const PREP = new Set([
  "de", "da", "do", "dos", "das",
  "e", "com", "van", "von", "del", "di", "el",
]);

/** Exibe Primeiro + Último sobrenome significativo, ignorando preposições. */
export function nomeExibicao(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");

  const significant = parts.filter((p) => !PREP.has(p.toLowerCase()));

  if (significant.length >= 2) {
    return `${significant[0]} ${significant[significant.length - 1]}`;
  }

  // Fallback: primeiro + último
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/** Versão para PDF/relatórios: mesma lógica, usado no HTML gerado. */
export function nomeParaPDF(nome: string): string {
  return nomeExibicao(nome);
}
