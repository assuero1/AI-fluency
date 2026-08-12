import { getTeableClient, TeableConfigError, TeableRecord, TeableRequestError } from "@/lib/teable/client";
import { getSchemaTable } from "@/lib/teable/schema";
import { normalizeVocabularyToken } from "./vocabulary-selection";
import type { WordFields, WordSenseFields } from "./conversations";

export function canonicalSenseKey(userId: string, profileId: string, lemma: string, translation: string) {
  return JSON.stringify([userId, profileId, normalizeVocabularyToken(lemma), normalizeVocabularyToken(translation)]);
}

/**
 * Legacy rows may store sense_key values built with a previous normalization
 * (same situation as canonical_key in matchesCanonicalVocabularyKey). Both
 * sides are normalized at lookup time so an old key still matches.
 */
export function matchesCanonicalSenseKey(storedKey: string | undefined, senseKey: string) {
  if (!storedKey) return false;
  if (storedKey === senseKey) return true;
  try {
    const parsed = JSON.parse(storedKey) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return false;
    const [userId, profileId, lemma, translation] = parsed;
    if (typeof userId !== "string" || typeof profileId !== "string" || typeof lemma !== "string" || typeof translation !== "string") {
      return false;
    }
    return canonicalSenseKey(userId, profileId, lemma, translation) === senseKey;
  } catch {
    return false;
  }
}

/**
 * Read fallback during the transition: a word that has no senses yet is
 * represented by a synthetic primary sense built from words.translation and
 * the word-level SRS cache.
 */
export function synthesizeLegacySense(word: TeableRecord<WordFields>): WordSenseFields {
  const fields = word.fields;
  const translation = fields.translation ?? "";
  return {
    word_id: word.id,
    ...(translation.trim() ? { sense_key: canonicalSenseKey(fields.user_id, fields.language_profile_id, fields.lemma, translation) } : {}),
    translation,
    part_of_speech: fields.part_of_speech,
    is_primary: true,
    sense_order: 1,
    review_due_at: fields.review_due_at,
    review_interval_days: fields.review_interval_days,
    review_ease: fields.review_ease,
    review_streak: fields.review_streak,
    lapse_count: fields.lapse_count,
    learning_step: fields.learning_step,
    last_reviewed_at: fields.last_reviewed_at,
    last_rating: fields.last_rating,
    average_response_time_ms: fields.average_response_time_ms,
    review_state: fields.review_state,
    review_version: fields.review_version,
    leech_flagged_at: fields.leech_flagged_at
  };
}

const REVIEW_STATE_SEVERITY: Record<NonNullable<WordSenseFields["review_state"]>, number> = {
  difficult: 4,
  learning: 3,
  review: 2,
  new: 1,
  suspended: 0
};

/**
 * Aggregates per-sense review state back into the word-level cache fields:
 * the most urgent sense drives review_due_at, the weakest drives review_state,
 * and the primary sense keeps owning translation/part_of_speech.
 */
export function aggregateSenseReviewToWordFields(senses: TeableRecord<WordSenseFields>[]): Partial<WordFields> {
  if (!senses.length) return {};

  const result: Partial<WordFields> = {};
  const primary = senses.find((sense) => sense.fields.is_primary) ?? senses[0];
  result.translation = primary.fields.translation;
  if (primary.fields.part_of_speech !== undefined) result.part_of_speech = primary.fields.part_of_speech;

  const active = senses.filter((sense) => sense.fields.review_state !== "suspended");
  if (active.length) {
    const dueTimes = active
      .map((sense) => ({ sense, time: sense.fields.review_due_at ? Date.parse(sense.fields.review_due_at) : Number.NaN }))
      .filter((entry) => Number.isFinite(entry.time))
      .sort((left, right) => left.time - right.time);
    if (dueTimes.length) result.review_due_at = dueTimes[0].sense.fields.review_due_at;

    result.review_state = active.reduce<NonNullable<WordFields["review_state"]>>(
      (worst, sense) => (REVIEW_STATE_SEVERITY[sense.fields.review_state ?? "new"] > REVIEW_STATE_SEVERITY[worst] ? (sense.fields.review_state ?? "new") : worst),
      "new"
    );
  } else {
    result.review_state = "suspended";
  }

  result.review_streak = Math.min(...senses.map((sense) => Number(sense.fields.review_streak ?? 0)));
  result.lapse_count = senses.reduce((sum, sense) => sum + Number(sense.fields.lapse_count ?? 0), 0);

  const reviewed = senses
    .map((sense) => ({ sense, time: sense.fields.last_reviewed_at ? Date.parse(sense.fields.last_reviewed_at) : Number.NaN }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time);
  if (reviewed.length) {
    result.last_reviewed_at = reviewed[0].sense.fields.last_reviewed_at;
    if (reviewed[0].sense.fields.last_rating) result.last_rating = reviewed[0].sense.fields.last_rating;
  }

  return result;
}

const WORD_SENSES_ENV_NAME = getSchemaTable("wordSenses")?.envName ?? "TEABLE_WORD_SENSES_TABLE_ID";

// Deploy-ordering guard: only the "table not configured" error degrades.
// Network, auth and server errors must keep propagating.
function isUnconfiguredWordSensesTableError(error: unknown): boolean {
  return error instanceof TeableConfigError && error.message.startsWith(`${WORD_SENSES_ENV_NAME} is not configured`);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    })
  );
  return results;
}

const SENSE_LOOKUP_CONCURRENCY = 8;

export async function listSensesByWordIds(wordIds: string[]): Promise<Map<string, TeableRecord<WordSenseFields>[]>> {
  const byWord = new Map<string, TeableRecord<WordSenseFields>[]>();
  if (!wordIds.length) return byWord;
  const client = getTeableClient();
  // Deploy-ordering guard: se a tabela ainda não existe neste ambiente, degrada
  // para "sem sentidos" (caminho legado) em vez de 503 — mesmo comportamento de
  // antes, agora detectado na primeira query filtrada.
  let unconfigured = false;
  const groups = await mapWithConcurrency(wordIds, SENSE_LOOKUP_CONCURRENCY, async (wordId) => {
    if (unconfigured) return [] as TeableRecord<WordSenseFields>[];
    try {
      return await client.listRecordsWhere<WordSenseFields>("wordSenses", "word_id", wordId);
    } catch (error) {
      if (!isUnconfiguredWordSensesTableError(error)) throw error;
      // Aviso único mesmo quando várias buscas concorrentes degradam juntas.
      if (!unconfigured) {
        unconfigured = true;
        console.warn(`[word-senses] ${WORD_SENSES_ENV_NAME} is not configured; treating every word as sense-less (legacy path).`);
      }
      return [] as TeableRecord<WordSenseFields>[];
    }
  });
  wordIds.forEach((wordId, index) => {
    if (groups[index].length) byWord.set(wordId, groups[index]);
  });
  return byWord;
}

export async function findSenseByKey(senseKey: string): Promise<TeableRecord<WordSenseFields> | undefined> {
  const senses = await getTeableClient().listAllRecords<WordSenseFields>("wordSenses");
  return senses.find((sense) => matchesCanonicalSenseKey(sense.fields.sense_key, senseKey));
}

export async function getPrimarySense(wordId: string): Promise<TeableRecord<WordSenseFields> | undefined> {
  const senses = (await listSensesByWordIds([wordId])).get(wordId) ?? [];
  const byOrder = (left: TeableRecord<WordSenseFields>, right: TeableRecord<WordSenseFields>) =>
    Number(left.fields.sense_order ?? 1) - Number(right.fields.sense_order ?? 1);
  return senses.filter((sense) => sense.fields.is_primary).sort(byOrder)[0] ?? [...senses].sort(byOrder)[0];
}

/** Próximo sense_order a partir de sentidos já carregados (sem nova leitura). */
export function nextSenseOrderFromList(senses: Array<{ fields: Pick<WordSenseFields, "sense_order"> }>): number {
  return senses.reduce((order, sense) => Math.max(order, Number(sense.fields.sense_order ?? 0) || 0), 0) + 1;
}

/** Próximo sense_order da palavra (maior existente + 1; 1 quando não há sentidos). */
export async function nextSenseOrder(wordId: string): Promise<number> {
  const senses = (await listSensesByWordIds([wordId])).get(wordId) ?? [];
  return nextSenseOrderFromList(senses);
}

export async function createWordSense(fields: WordSenseFields): Promise<TeableRecord<WordSenseFields>> {
  const client = getTeableClient();
  try {
    return await client.createRecord<WordSenseFields>("wordSenses", fields);
  } catch (error) {
    // Idempotent create, same pattern as persistSelectedVocabulary: a
    // uniqueness conflict on sense_key means a concurrent write won; re-read
    // and return the existing sense instead of failing.
    if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status) || !fields.sense_key) throw error;
    const existing = await findSenseByKey(fields.sense_key);
    if (!existing) throw error;
    return existing;
  }
}

export async function updateWordSense(senseId: string, fields: Partial<WordSenseFields>): Promise<TeableRecord<WordSenseFields>> {
  return getTeableClient().updateRecord<WordSenseFields>("wordSenses", senseId, fields);
}

export type DueSense = {
  word: TeableRecord<WordFields>;
  sense: TeableRecord<WordSenseFields>;   // real or synthesized via synthesizeLegacySense
  synthetic: boolean;                      // true = word still has no senses (legacy)
};

function senseDueTime(sense: TeableRecord<WordSenseFields>) {
  // Senses never scheduled count as due first, like new cards in an SRS deck.
  const time = sense.fields.review_due_at ? Date.parse(sense.fields.review_due_at) : 0;
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Resolves, for each word, the sense a flashcard should exercise: the most-due
 * sense, preferring senses already due at `now`. Words without senses enter with
 * a synthetic legacy sense (SRS fields of the word itself, empty id), preserving
 * the current behavior for data not yet migrated — their cards carry no
 * target_sense_id and reviews keep updating the word directly.
 */
export function resolveDueSenses(
  words: TeableRecord<WordFields>[],
  sensesByWord: Map<string, TeableRecord<WordSenseFields>[]>,
  now: Date = new Date()
): DueSense[] {
  const nowTime = now.getTime();
  return words.map((word) => {
    const senses = sensesByWord.get(word.id) ?? [];
    if (!senses.length) {
      return { word, sense: { id: "", fields: synthesizeLegacySense(word) }, synthetic: true };
    }
    const active = senses.filter((sense) => sense.fields.review_state !== "suspended");
    const candidates = active.length ? active : senses;
    const due = candidates.filter((sense) => senseDueTime(sense) <= nowTime);
    const pool = due.length ? due : candidates;
    const sense = pool.reduce((mostDue, candidate) => (senseDueTime(candidate) < senseDueTime(mostDue) ? candidate : mostDue));
    return { word, sense, synthetic: false };
  });
}
