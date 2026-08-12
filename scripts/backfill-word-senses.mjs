import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

// Mirrors lib/learning/word-senses.ts (TypeScript modules are not importable
// from .mjs scripts): NFKC + trim + lowercase + diacritic stripping, then a
// JSON-array key, so lookups stay diacritic-insensitive on both sides.
function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function senseKey(userId, profileId, lemma, translation) {
  return JSON.stringify([String(userId ?? ""), String(profileId ?? ""), normalize(lemma), normalize(translation)]);
}

const SRS_FIELDS = [
  "review_due_at",
  "review_interval_days",
  "review_ease",
  "review_streak",
  "lapse_count",
  "learning_step",
  "last_reviewed_at",
  "last_rating",
  "average_response_time_ms",
  "review_state",
  "review_version",
  "leech_flagged_at"
];

const CREATE_BATCH_SIZE = 100;

/**
 * Pure planner: decides which words get a primary sense. Idempotent — a word
 * whose sense_key already exists (or was already planned in this run) is
 * skipped, and words without translation never get a sense.
 */
export function buildWordSenseBackfillPlan(words, existingSenses, now) {
  const takenKeys = new Set();
  for (const sense of existingSenses) {
    const raw = sense?.fields?.sense_key;
    if (typeof raw !== "string" || !raw) continue;
    takenKeys.add(raw);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((value) => typeof value === "string")) {
        takenKeys.add(senseKey(parsed[0], parsed[1], parsed[2], parsed[3]));
      }
    } catch {
      // Non-JSON legacy keys are covered by the raw-string entry above.
    }
  }

  const creates = [];
  let skippedExisting = 0;
  let skippedNoTranslation = 0;

  for (const word of words) {
    const fields = word?.fields ?? {};
    const translation = String(fields.translation ?? "").trim();
    if (!translation) {
      skippedNoTranslation += 1;
      continue;
    }
    const key = senseKey(fields.user_id, fields.language_profile_id, fields.lemma, translation);
    if (takenKeys.has(key)) {
      skippedExisting += 1;
      continue;
    }
    takenKeys.add(key);

    const senseFields = {
      Name: String(fields.lemma ?? ""),
      word_id: word.id,
      sense_key: key,
      translation,
      source: "backfill",
      is_primary: true,
      sense_order: 1,
      created_at: now
    };
    if (fields.part_of_speech) senseFields.part_of_speech = String(fields.part_of_speech);
    for (const name of SRS_FIELDS) {
      if (fields[name] !== undefined && fields[name] !== null && fields[name] !== "") senseFields[name] = fields[name];
    }
    creates.push({ wordId: word.id, fields: senseFields });
  }

  return { creates, skippedExisting, skippedNoTranslation };
}

async function main() {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const envPath = option("--env") ?? ".env.local";
  const env = readEnv(envPath);
  const apply = process.argv.includes("--apply");
  const backupPath = option("--backup");
  if (apply && !backupPath) throw new Error("Use --backup <arquivo.json> ao executar com --apply (ex.: npm run scope:backup -- --out backups/<arquivo>.json ou deixe este script gravar).");

  const wordsTableId = required(env, "TEABLE_WORDS_TABLE_ID");
  const sensesTableId = env.TEABLE_WORD_SENSES_TABLE_ID?.trim();

  const words = await listAll(env, wordsTableId);
  const existingSenses = sensesTableId ? await listAll(env, sensesTableId) : [];
  const now = new Date().toISOString();
  const plan = buildWordSenseBackfillPlan(words, existingSenses, now);

  if (apply && !sensesTableId) {
    throw new Error("TEABLE_WORD_SENSES_TABLE_ID is required. Run scripts/ensure-word-senses-table.mjs first.");
  }

  let created = 0;
  if (apply) {
    const plannedWordIds = new Set(plan.creates.map((item) => item.wordId));
    const backupWords = words.filter((word) => plannedWordIds.has(word.id));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, `${JSON.stringify({ version: 1, createdAt: now, words: backupWords }, null, 2)}\n`, { mode: 0o600, flag: "wx" });

    for (let index = 0; index < plan.creates.length; index += CREATE_BATCH_SIZE) {
      const batch = plan.creates.slice(index, index + CREATE_BATCH_SIZE);
      await teableRequest(env, `/api/table/${sensesTableId}/record?fieldKeyType=name`, {
        method: "POST",
        body: JSON.stringify({ records: batch.map((item) => ({ fields: item.fields })) })
      });
      created += batch.length;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    table: sensesTableId ? "configured" : "missing",
    words: words.length,
    existingSenses: existingSenses.length,
    ...(apply
      ? { created, backupPath }
      : { would_create: plan.creates.length }),
    skipped_existing: plan.skippedExisting,
    skipped_no_translation: plan.skippedNoTranslation
  }, null, 2));
}

async function listAll(env, tableId) {
  const records = [];
  for (let skip = 0; ; skip += 1000) {
    const page = recordsFrom(await teableRequest(env, `/api/table/${tableId}/record?take=1000&skip=${skip}&fieldKeyType=name`));
    records.push(...page);
    if (page.length < 1000) return records;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
