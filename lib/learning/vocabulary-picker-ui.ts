import type { VocabularyCandidateGroup } from "./vocabulary-selection";

/** Badge do card de grupo no picker de vocabulário do resumo. */
export function getVocabularyGroupBadge(group: Pick<VocabularyCandidateGroup, "kind">) {
  return group.kind === "new_sense_of_existing" ? "novo significado" : null;
}

/** Subtítulo do card de novo significado: o primeiro sentido que o usuário já conhece. */
export function getVocabularyGroupSubtitle(group: Pick<VocabularyCandidateGroup, "kind" | "existingTranslation">) {
  if (group.kind !== "new_sense_of_existing" || !group.existingTranslation) return null;
  return `você já conhece «${group.existingTranslation}»`;
}

export type SavedWordSenseUsage = {
  wordId: string;
  translation: string;
  isPrimary: boolean;
  totalUses: number;
};

/** Meta da linha "Já salvas desta conversa": usos por sentido quando existem. */
export function formatSavedWordMeta(
  word: { id: string; fields: { translation?: string; total_uses?: number } },
  senses: SavedWordSenseUsage[]
) {
  const own = senses.filter((sense) => sense.wordId === word.id);
  if (!own.length) return word.fields.translation || `usada ${Number(word.fields.total_uses ?? 0)} vez(es)`;
  return own.map((sense) => `${sense.translation || "sem tradução"} · usada ${sense.totalUses}x`).join(" · ");
}
