declare module "*.mjs" {
  export function buildVocabularyMigrationPlan(data: Record<string, Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }>>): {
    duplicateGroups: Array<{ keeperId: string; duplicateIds: string[]; occurrenceIds: string[]; mergedFields: Record<string, unknown> }>;
    replacements: Map<string, string>;
    recountUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    occurrenceCorrectnessUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    occurrenceKeyUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    referenceUpdates: Record<string, Array<{ id: string; fields: Record<string, unknown> }>>;
  };
  export function wordsMissingTranslation(records: Array<{ id: string; fields?: Record<string, unknown> }>): Array<{ id: string; fields?: Record<string, unknown> }>;
  export function chunkItems<T>(items: T[], size: number): T[][];
  export function parseTranslationItems(content: string, allowedIds: Set<string>): Record<string, string>;
  export function translateWords(
    env: Record<string, string>,
    words: Array<{ id: string; fields?: Record<string, unknown> }>,
    translate?: (env: Record<string, string>, batch: Array<{ id: string; text: string; language: string }>) => Promise<Record<string, string>>,
    languageByProfileId?: Record<string, string>
  ): Promise<Record<string, string>>;
  export function senseKey(userId: unknown, profileId: unknown, lemma: unknown, translation: unknown): string;
  export function buildWordSenseBackfillPlan(
    words: Array<{ id: string; fields?: Record<string, unknown> }>,
    existingSenses: Array<{ id: string; fields?: Record<string, unknown> }>,
    now: string
  ): {
    creates: Array<{ wordId: string; fields: Record<string, unknown> }>;
    skippedExisting: number;
    skippedNoTranslation: number;
  };
}
