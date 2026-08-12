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
