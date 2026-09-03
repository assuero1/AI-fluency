// Fundação de fuso horário do produto: todo "dia" do usuário (streak, feedback
// diário, calendário, fila) é calculado no fuso dele — nunca em UTC.
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function resolveTimeZone(value?: string) {
  if (!value) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function dateKeyInTimeZone(value: Date, timeZone: string) {
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
