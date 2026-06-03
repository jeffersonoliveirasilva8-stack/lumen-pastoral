export function normalizeLiturgicalText(
  text: string
) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const celebrations = [];

  for (const line of lines) {
    if (line.includes('São') || line.includes('Santa')) {
      celebrations.push({
        raw: line,
      });
    }
  }

  return celebrations;
}