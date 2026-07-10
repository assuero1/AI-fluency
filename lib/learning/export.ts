export const PERSONAL_DATA_EXPORT_SCHEMA_VERSION = 1;

export function buildPersonalDataExportFileName(languageCode: string | undefined, date = new Date()) {
  const language = sanitizeFileSegment(languageCode) || "sem-idioma";
  const day = date.toISOString().slice(0, 10);
  return `ai-fluency-${language}-${day}.json`;
}

function sanitizeFileSegment(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}
