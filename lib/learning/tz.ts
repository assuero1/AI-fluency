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

// Colunas DATE do Postgres (ex.: daily_feedbacks.date) chegam do Supabase como
// "YYYY-MM-DDT00:00:00+00:00": a meia-noite UTC é artefato do tipo, não um
// instante. Reconverter esse valor pelo fuso do usuário desloca o dia para trás
// em fusos negativos (todo o Brasil). A parte da data JÁ É o dia local gravado
// pela escrita — extrair, nunca converter. Instants reais (ended_at, created_at)
// continuam indo por dateKeyInTimeZone.
export function dayKeyFromDateColumn(value: string | undefined | null, timeZone = DEFAULT_TIMEZONE) {
  const raw = String(value ?? "");
  // Serializações de coluna DATE: chave pura ou meia-noite UTC exata.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T00:00:00/.test(raw)) return raw.slice(0, 10);
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return "";
  return dateKeyInTimeZone(instant, timeZone);
}
