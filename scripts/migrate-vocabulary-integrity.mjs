import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

const TABLES = {
  words: "TEABLE_WORDS_TABLE_ID",
  occurrences: "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  messages: "TEABLE_MESSAGES_TABLE_ID",
  corrections: "TEABLE_CORRECTIONS_TABLE_ID",
  flashcards: "TEABLE_FLASHCARDS_TABLE_ID",
  attempts: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  topics: "TEABLE_TOPICS_TABLE_ID",
  sessions: "TEABLE_PRACTICE_SESSIONS_TABLE_ID"
};

export function normalizeVocabularyKey(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

export function buildVocabularyMigrationPlan(data) {
  const messagesById = new Map(data.messages.map((record) => [record.id, record]));
  const correctedTokensByMessage = new Map();
  for (const correction of data.corrections ?? []) {
    const messageId = relationId(correction.fields?.message_id);
    const tokens = correctedTokensByMessage.get(messageId) ?? new Set();
    for (const token of changedOriginalTokens(correction.fields?.original_text, correction.fields?.corrected_text)) tokens.add(token);
    correctedTokensByMessage.set(messageId, tokens);
  }
  const occurrencesByWord = groupBy(data.occurrences, (record) => relationId(record.fields?.word_id));
  const groups = groupBy(data.words, wordGroupKey);
  const duplicateGroups = [];
  const replacements = new Map();
  const recountUpdates = [];
  const occurrenceCorrectnessUpdates = [];
  const occurrenceKeyUpdates = [];
  const occurrenceGroups = groupBy(data.occurrences, (record) => JSON.stringify([
    relationId(record.fields?.conversation_id),
    relationId(record.fields?.message_id),
    normalizeVocabularyKey(record.fields?.used_text)
  ]));
  for (const [baseKey, group] of occurrenceGroups) {
    [...group].sort((left, right) => dateValue(left.fields?.created_at || left.createdTime) - dateValue(right.fields?.created_at || right.createdTime) || left.id.localeCompare(right.id)).forEach((record, index) => {
      const occurrenceKey = JSON.stringify([...JSON.parse(baseKey), index + 1]);
      if (record.fields?.occurrence_key !== occurrenceKey) occurrenceKeyUpdates.push({ id: record.id, fields: { occurrence_key: occurrenceKey } });
    });
  }

  for (const [key, words] of groups) {
    if (!key) continue;
    const ordered = [...words].sort((left, right) => keeperScore(right, occurrencesByWord) - keeperScore(left, occurrencesByWord) || dateValue(left.createdTime) - dateValue(right.createdTime));
    const keeper = ordered[0];
    const duplicates = ordered.slice(1);
    for (const duplicate of duplicates) replacements.set(duplicate.id, keeper.id);
    const allOccurrences = ordered.flatMap((word) => occurrencesByWord.get(word.id) ?? []);
    const learnerCorrectOccurrences = allOccurrences.filter((occurrence) => {
      const message = messagesById.get(relationId(occurrence.fields?.message_id));
      const correctedTokens = correctedTokensByMessage.get(relationId(occurrence.fields?.message_id));
      const corrected = correctedTokens?.has(normalizeVocabularyKey(occurrence.fields?.used_text));
      if (corrected && occurrence.fields?.was_correct !== false) occurrenceCorrectnessUpdates.push({ id: occurrence.id, fields: { was_correct: false } });
      return message?.fields?.role === "user" && occurrence.fields?.was_correct !== false && !corrected;
    });
    const mergedFields = { ...mergeWordFields(ordered, learnerCorrectOccurrences), canonical_key: key };
    if (duplicates.length === 0) {
      const current = number(keeper.fields?.total_uses);
      const fields = {};
      if (current !== mergedFields.total_uses) fields.total_uses = mergedFields.total_uses;
      if (keeper.fields?.canonical_key !== key) fields.canonical_key = key;
      if (Object.keys(fields).length) recountUpdates.push({ id: keeper.id, fields });
      continue;
    }
    duplicateGroups.push({
      key,
      keeperId: keeper.id,
      duplicateIds: duplicates.map((word) => word.id),
      occurrenceIds: allOccurrences.filter((occurrence) => relationId(occurrence.fields?.word_id) !== keeper.id).map((occurrence) => occurrence.id),
      mergedFields
    });
  }

  return {
    duplicateGroups,
    replacements,
    recountUpdates,
    occurrenceCorrectnessUpdates,
    occurrenceKeyUpdates,
    referenceUpdates: {
      flashcards: data.flashcards.flatMap((record) => replacementPatch(record, replacements, ["target_word_id"], ["supporting_word_ids"])),
      attempts: data.attempts.flatMap((record) => replacementPatch(record, replacements, ["word_id"], [])),
      topics: data.topics.flatMap((record) => replacementPatch(record, replacements, [], ["related_words"])),
      sessions: data.sessions.flatMap((record) => jsonReplacementPatch(record, replacements, "focus"))
    }
  };
}

function wordGroupKey(record) {
  const userId = relationId(record.fields?.user_id);
  const profileId = relationId(record.fields?.language_profile_id);
  const lemma = normalizeVocabularyKey(record.fields?.lemma || record.fields?.display_text);
  return userId && profileId && lemma ? JSON.stringify([userId, profileId, lemma]) : "";
}

function changedOriginalTokens(originalText, correctedText) {
  const original = tokenize(originalText);
  const corrected = tokenize(correctedText);
  const lengths = Array.from({ length: original.length + 1 }, () => Array(corrected.length + 1).fill(0));
  for (let left = original.length - 1; left >= 0; left -= 1) for (let right = corrected.length - 1; right >= 0; right -= 1) {
    lengths[left][right] = original[left] === corrected[right] ? lengths[left + 1][right + 1] + 1 : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
  }
  const changed = [];
  let left = 0;
  let right = 0;
  while (left < original.length) {
    if (right < corrected.length && original[left] === corrected[right]) { left += 1; right += 1; }
    else if (right < corrected.length && lengths[left][right + 1] > lengths[left + 1][right]) right += 1;
    else { changed.push(original[left]); left += 1; }
  }
  return changed;
}

function tokenize(value) {
  return [...String(value ?? "").matchAll(/[\p{L}À-ÿ]+(?:['’][\p{L}À-ÿ]+)*/gu)].map((match) => normalizeVocabularyKey(match[0]));
}

function mergeWordFields(words, correctOccurrences) {
  const firstUsedAt = earliest(words.map((word) => word.fields?.first_used_at));
  const lastUsedAt = latest(words.map((word) => word.fields?.last_used_at));
  const best = [...words].sort((left, right) => completeness(right.fields) - completeness(left.fields))[0];
  return {
    lemma: normalizeVocabularyKey(best.fields?.lemma || best.fields?.display_text),
    display_text: best.fields?.display_text || best.fields?.lemma || "",
    translation: best.fields?.translation || "",
    part_of_speech: best.fields?.part_of_speech || "",
    familiarity_score: Math.max(...words.map((word) => number(word.fields?.familiarity_score))),
    total_uses: correctOccurrences.length,
    first_used_at: firstUsedAt,
    last_used_at: lastUsedAt,
    review_due_at: earliest(words.map((word) => word.fields?.review_due_at)),
    review_interval_days: Math.max(...words.map((word) => number(word.fields?.review_interval_days))),
    review_ease: Math.max(...words.map((word) => number(word.fields?.review_ease))),
    review_streak: Math.max(...words.map((word) => number(word.fields?.review_streak))),
    lapse_count: Math.max(...words.map((word) => number(word.fields?.lapse_count))),
    last_reviewed_at: latest(words.map((word) => word.fields?.last_reviewed_at)),
    last_rating: latestField(words, "last_reviewed_at", "last_rating"),
    average_response_time_ms: average(words.map((word) => number(word.fields?.average_response_time_ms)).filter((value) => value > 0)),
    review_state: latestField(words, "last_reviewed_at", "review_state") || "new",
    review_version: latestField(words, "last_reviewed_at", "review_version") || ""
  };
}

function replacementPatch(record, replacements, scalarFields, jsonFields) {
  const fields = {};
  for (const field of scalarFields) {
    const current = relationId(record.fields?.[field]);
    if (replacements.has(current)) fields[field] = replacements.get(current);
  }
  for (const field of jsonFields) {
    const current = parseIds(record.fields?.[field]);
    const next = [...new Set(current.map((id) => replacements.get(id) ?? id))];
    if (JSON.stringify(current) !== JSON.stringify(next)) fields[field] = JSON.stringify(next);
  }
  return Object.keys(fields).length ? [{ id: record.id, fields }] : [];
}

function jsonReplacementPatch(record, replacements, field) {
  if (typeof record.fields?.[field] !== "string") return [];
  try {
    const parsed = JSON.parse(record.fields[field]);
    const next = replaceDeep(parsed, replacements);
    return JSON.stringify(parsed) === JSON.stringify(next) ? [] : [{ id: record.id, fields: { [field]: JSON.stringify(next) } }];
  } catch {
    return [];
  }
}

function replaceDeep(value, replacements) {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return [...new Set(value.map((item) => replaceDeep(item, replacements)))];
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDeep(item, replacements)]));
}

function keeperScore(word, occurrencesByWord) {
  return (occurrencesByWord.get(word.id)?.length ?? 0) * 100 + completeness(word.fields);
}

function completeness(fields = {}) {
  return [fields.translation, fields.part_of_speech, fields.review_version, fields.last_reviewed_at].filter(Boolean).length;
}

function relationId(value) {
  if (Array.isArray(value)) return String(value[0]?.id ?? value[0] ?? "");
  if (value && typeof value === "object") return String(value.id ?? "");
  return String(value ?? "");
}

function parseIds(value) {
  if (Array.isArray(value)) return value.map(relationId).filter(Boolean);
  if (typeof value !== "string") return [];
  try { return parseIds(JSON.parse(value)); } catch { return value.split(",").map((item) => item.trim()).filter(Boolean); }
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function dateValue(value) { const time = new Date(value ?? 0).getTime(); return Number.isNaN(time) ? 0 : time; }
function earliest(values) { return values.filter(Boolean).sort((a, b) => dateValue(a) - dateValue(b))[0] ?? ""; }
function latest(values) { return values.filter(Boolean).sort((a, b) => dateValue(b) - dateValue(a))[0] ?? ""; }
function average(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function latestField(words, dateField, valueField) { return [...words].sort((a, b) => dateValue(b.fields?.[dateField]) - dateValue(a.fields?.[dateField])).find((word) => word.fields?.[valueField])?.fields?.[valueField] ?? ""; }

async function main() {
  const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const envPath = option("--env") ?? ".env.local";
  const apply = process.argv.includes("--apply");
  const backupPath = option("--backup");
  if (apply && !backupPath) throw new Error("Use --backup <arquivo.json> ao executar com --apply.");
  const env = readEnv(envPath);
  const tableId = (name) => required(env, name);
  const list = async (name) => {
    const records = [];
    for (let skip = 0; ; skip += 1000) {
      const page = recordsFrom(await teableRequest(env, `/api/table/${tableId(name)}/record?take=1000&skip=${skip}&fieldKeyType=name`));
      records.push(...page);
      if (page.length < 1000) return records;
    }
  };
  const data = Object.fromEntries(await Promise.all(Object.entries(TABLES).map(async ([key, name]) => [key, await list(name)])));
  const plan = buildVocabularyMigrationPlan(data);

  if (apply) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: data }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const patch = async (tableName, id, fields) => teableRequest(env, `/api/table/${tableId(tableName)}/record/${id}?fieldKeyType=name`, { method: "PATCH", body: JSON.stringify({ record: { fields } }) });
    for (const group of plan.duplicateGroups) {
      await patch(TABLES.words, group.keeperId, group.mergedFields);
      for (const occurrenceId of group.occurrenceIds) await patch(TABLES.occurrences, occurrenceId, { word_id: group.keeperId });
    }
    for (const update of plan.recountUpdates) await patch(TABLES.words, update.id, update.fields);
    for (const update of plan.occurrenceCorrectnessUpdates) await patch(TABLES.occurrences, update.id, update.fields);
    for (const update of plan.occurrenceKeyUpdates) await patch(TABLES.occurrences, update.id, update.fields);
    for (const [key, updates] of Object.entries(plan.referenceUpdates)) {
      for (const update of updates) await patch(TABLES[key], update.id, update.fields);
    }
    for (const group of plan.duplicateGroups) {
      for (const id of group.duplicateIds) await teableRequest(env, `/api/table/${tableId(TABLES.words)}/record/${id}?fieldKeyType=name`, { method: "DELETE" });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    duplicateGroups: plan.duplicateGroups.map((group) => ({ keeperId: group.keeperId, duplicateIds: group.duplicateIds, occurrencesMoved: group.occurrenceIds.length, totalUses: group.mergedFields.total_uses })),
    referenceUpdates: Object.fromEntries(Object.entries(plan.referenceUpdates).map(([key, updates]) => [key, updates.length])),
    recountUpdates: plan.recountUpdates.length,
    correctedOccurrencesFound: plan.occurrenceCorrectnessUpdates.length,
    occurrenceKeyUpdates: plan.occurrenceKeyUpdates.length,
    backupPath: apply ? backupPath : undefined
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
