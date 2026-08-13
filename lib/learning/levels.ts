export const LANGUAGE_LEVELS = ["Iniciante", "Intermediário (B1)", "Avançado"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
export const DEFAULT_LANGUAGE_LEVEL: LanguageLevel = "Intermediário (B1)";

export function isLanguageLevel(value: unknown): value is LanguageLevel {
  return typeof value === "string" && (LANGUAGE_LEVELS as readonly string[]).includes(value);
}
