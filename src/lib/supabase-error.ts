// Formata erros do Supabase incluindo code, hint e details quando disponíveis.
export function supabaseErrorMessage(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const err = e as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof err.message === "string") parts.push(err.message);
  if (typeof err.hint === "string" && err.hint) parts.push(`Dica: ${err.hint}`);
  if (typeof err.details === "string" && err.details) parts.push(err.details);
  if (typeof err.code === "string" && err.code) parts.push(`(${err.code})`);
  const msg = parts.length > 0 ? parts.join(" · ") : "Erro desconhecido.";
  console.error("[Supabase]", e);
  return msg;
}
