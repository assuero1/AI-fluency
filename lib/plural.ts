// Pluralização pt-BR para strings de UI — mata o "(s)" mecânico.
// Uso: plura(1, "conversa") → "1 conversa" · plura(3, "conversa") → "3 conversas"
// Plural irregular: plura(2, "nível", "níveis").
export function plura(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
