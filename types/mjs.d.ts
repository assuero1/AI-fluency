declare module "*.mjs" {
  export function buildVocabularyMigrationPlan(data: Record<string, Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }>>): {
    duplicateGroups: Array<{ keeperId: string; duplicateIds: string[]; occurrenceIds: string[]; mergedFields: Record<string, unknown> }>;
    replacements: Map<string, string>;
    recountUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    occurrenceCorrectnessUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    occurrenceKeyUpdates: Array<{ id: string; fields: Record<string, unknown> }>;
    referenceUpdates: Record<string, Array<{ id: string; fields: Record<string, unknown> }>>;
  };
}
