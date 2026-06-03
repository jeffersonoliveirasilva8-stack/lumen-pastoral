/**
 * sanitizeLiturgicalText
 * Remove HTML, entidades e rodapés promocionais comuns
 * vindos da API Evangelizo.org / sites litúrgicos externos.
 */

// ── Padrões de rodapé/propaganda a remover (case-insensitive) ────────────────
const PROMO_PATTERNS: RegExp[] = [
  // Domínios / URLs
  /https?:\/\/\S+/gi,
  /www\.\S+\.\S+/gi,
  /evangelhoquotidiano\.org\S*/gi,
  /evangelizo\.org\S*/gi,
  /paroquias\.org\S*/gi,
  /vaticannews\.va\S*/gi,

  // Frases de inscrição / propaganda
  /para receber.*?(evangelho|liturgia).*?inscreva[- ]?se[.:,!]*\s*/gi,
  /para receber todas as manh[aã]s?\b.*/gi,
  /inscreva[- ]?se.*?(gratu[ií]to|email|e-mail|correio)[^.]*[.!]?\s*/gi,
  /envie sua declara[cç][aã]o.*?jesus[^.]*[.!]?\s*/gi,
  /clique aqui para\b.*/gi,
  /acesse\s+(nosso|o)\s+site\b.*/gi,

  // Créditos de tradução / copyright
  /tradu[cç][aã]o lit[uú]rgica da b[ií]blia[^.]*[.!]?\s*/gi,
  /texto\s+extra[ií]do\s+d[ao]\b.*/gi,
  /©.*?reservados\.?\s*/gi,
  /copyright\b.*/gi,
  /todos os direitos reservados\.?\s*/gi,
  /fonte:\s*\S+[.!]?\s*/gi,

  // Marcadores de fim de texto externo
  /\[?\s*(fim|end)\s*\]?\s*$/gi,
];

/** Remove HTML + entidades HTML. */
export function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g,    " ")
    .trim();
}

/**
 * Limpa texto litúrgico bíblico completo.
 * Remove HTML e rodapés externos SEM colapsar quebras de linha,
 * preservando a estrutura de versos/estrofes do salmo e das leituras.
 */
export function sanitizeLiturgicalText(raw: string | null | undefined): string {
  if (!raw) return "";

  // 1. Remove tags HTML preservando quebras de linha
  let text = raw
    .replace(/<br\s*\/?>/gi,   "\n")
    .replace(/<\/p>/gi,        "\n\n")
    .replace(/<\/div>/gi,      "\n")
    .replace(/<[^>]*>/g,       "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ");

  // 2. Remove conteúdo promocional e rodapés
  for (const pat of PROMO_PATTERNS) {
    text = text.replace(pat, "");
  }

  // 3. Normaliza espaços dentro de cada linha (sem tocar em \n)
  text = text
    .replace(/[ \t]+/g,    " ")
    .replace(/\n[ \t]+/g,  "\n")
    .replace(/[ \t]+\n/g,  "\n")
    .replace(/\n{3,}/g,    "\n\n");

  // 4. Descarta linhas finais vazias ou que parecem fragmentos de URL
  const linhas = text.split("\n");
  let fim = linhas.length - 1;
  while (fim >= 0) {
    const l = linhas[fim].trim();
    if (!l || l.length < 4 || /\.(org|com|net|br)/.test(l)) {
      fim--;
    } else {
      break;
    }
  }

  return linhas.slice(0, fim + 1).join("\n").trim();
}
