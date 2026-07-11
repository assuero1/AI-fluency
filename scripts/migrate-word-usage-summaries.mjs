import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

const FIELD_SPECS = [
  ["usage_key", "singleLineText", true],
  ["word_id", "singleLineText", false],
  ["conversation_id", "singleLineText", false],
  ["forms_json", "longText", false],
  ["observed_count", "number", false],
  ["correct_use_count", "number", false],
  ["correction_count", "number", false],
  ["first_used_at", "date", false],
  ["last_used_at", "date", false]
];

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const envPath = option("--env") ?? ".env.local";
  const env = readEnv(envPath);
  const apply = process.argv.includes("--apply");
  const baseId = required(env, "TEABLE_BASE_ID");
  const wordsTableId = required(env, "TEABLE_WORDS_TABLE_ID");
  const occurrencesTableId = required(env, "TEABLE_WORD_OCCURRENCES_TABLE_ID");
  const messagesTableId = required(env, "TEABLE_MESSAGES_TABLE_ID");
  const correctionsTableId = required(env, "TEABLE_CORRECTIONS_TABLE_ID");
  const tables = await teableRequest(env, `/api/base/${baseId}/table`);
  let summaryTable = tables.find((table) => table?.name === "WordUsageSummaries");

  if (!summaryTable && apply) {
    summaryTable = await teableRequest(env, `/api/base/${baseId}/table`, {
      method: "POST",
      body: JSON.stringify({ name: "WordUsageSummaries" })
    });
  }

  if (!summaryTable) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", action: "create-table-required", table: "WordUsageSummaries" }, null, 2));
    return;
  }

  const fields = await teableRequest(env, `/api/table/${summaryTable.id}/field`);
  for (const [name, type, unique] of FIELD_SPECS) {
    const existing = fields.find((field) => field?.name === name);
    if (!existing && apply) {
      await teableRequest(env, `/api/table/${summaryTable.id}/field`, {
        method: "POST",
        body: JSON.stringify({ type, name, unique, notNull: false })
      });
    }
  }

  if (apply) updateEnvFile(envPath, "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID", summaryTable.id);
  const [words, occurrences, messages, corrections, existingSummaries] = await Promise.all([
    listAll(env, wordsTableId),
    listAll(env, occurrencesTableId),
    listAll(env, messagesTableId),
    listAll(env, correctionsTableId),
    listAll(env, summaryTable.id)
  ]);
  const roles = new Map(messages.map((message) => [message.id, message.fields?.role]));
  const correctedMessages = new Set(corrections.map((correction) => relationId(correction.fields?.message_id)).filter(Boolean));
  const grouped = new Map();

  for (const occurrence of occurrences) {
    const wordId = relationId(occurrence.fields?.word_id);
    const conversationId = relationId(occurrence.fields?.conversation_id);
    if (!wordId || !conversationId) continue;
    const usageKey = JSON.stringify([wordId, conversationId]);
    const group = grouped.get(usageKey) ?? {
      usageKey, wordId, conversationId, forms: new Map(), observedCount: 0, correctUseCount: 0, correctionCount: 0, dates: []
    };
    const usedText = String(occurrence.fields?.used_text ?? "").trim();
    if (usedText) group.forms.set(normalize(usedText), usedText);
    if (occurrence.fields?.was_correct !== false) group.observedCount += 1;
    if (roles.get(relationId(occurrence.fields?.message_id)) === "user" && occurrence.fields?.was_correct !== false) group.correctUseCount += 1;
    if (correctedMessages.has(relationId(occurrence.fields?.message_id))) group.correctionCount += 1;
    if (occurrence.fields?.created_at) group.dates.push(occurrence.fields.created_at);
    grouped.set(usageKey, group);
  }

  const existingByKey = new Map(existingSummaries.map((summary) => [summary.fields?.usage_key, summary]));
  const creates = [];
  const updates = [];
  for (const group of grouped.values()) {
    const dates = group.dates.sort();
    const fields = {
      Name: group.forms.values().next().value ?? group.usageKey,
      usage_key: group.usageKey,
      word_id: group.wordId,
      conversation_id: group.conversationId,
      forms_json: JSON.stringify([...group.forms.values()]),
      observed_count: group.observedCount,
      correct_use_count: group.correctUseCount,
      correction_count: group.correctionCount,
      first_used_at: dates[0] ?? "",
      last_used_at: dates.at(-1) ?? ""
    };
    const existing = existingByKey.get(group.usageKey);
    if (existing) updates.push({ id: existing.id, fields });
    else creates.push({ fields });
  }

  const comparison = compareMetrics(words, occurrences, [...grouped.values()], roles, correctedMessages);
  if (!comparison.ok) throw new Error(`Metric comparison failed: ${JSON.stringify(comparison.mismatches.slice(0, 10))}`);

  if (apply) {
    for (const item of creates) await createRecord(env, summaryTable.id, item.fields);
    for (const item of updates) await updateRecord(env, summaryTable.id, item.id, item.fields);
    for (const word of words) {
      const forms = unique(occurrences.filter((occurrence) => relationId(occurrence.fields?.word_id) === word.id).map((occurrence) => occurrence.fields?.used_text));
      if (forms.length) await updateRecord(env, wordsTableId, word.id, { forms_json: JSON.stringify(forms) });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    tableId: summaryTable.id,
    legacyOccurrences: occurrences.length,
    aggregateRows: grouped.size,
    creates: creates.length,
    updates: updates.length,
    wordsWithVerifiedMetrics: comparison.checkedWords
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

function compareMetrics(words, occurrences, groups, roles, correctedMessages) {
  const mismatches = [];
  for (const word of words) {
    const legacy = occurrences.filter((occurrence) => relationId(occurrence.fields?.word_id) === word.id);
    const legacyUses = legacy.filter((occurrence) => roles.get(relationId(occurrence.fields?.message_id)) === "user" && occurrence.fields?.was_correct !== false).length;
    const legacyConversations = new Set(legacy.filter((occurrence) => roles.get(relationId(occurrence.fields?.message_id)) === "user" && occurrence.fields?.was_correct !== false).map((occurrence) => relationId(occurrence.fields?.conversation_id))).size;
    const legacyCorrections = legacy.filter((occurrence) => correctedMessages.has(relationId(occurrence.fields?.message_id))).length;
    const summaries = groups.filter((group) => group.wordId === word.id);
    const aggregate = {
      uses: summaries.reduce((sum, group) => sum + group.correctUseCount, 0),
      conversations: summaries.filter((group) => group.correctUseCount > 0).length,
      corrections: summaries.reduce((sum, group) => sum + group.correctionCount, 0)
    };
    if (legacyUses !== aggregate.uses || legacyConversations !== aggregate.conversations || legacyCorrections !== aggregate.corrections) {
      mismatches.push({ wordId: word.id, legacy: { uses: legacyUses, conversations: legacyConversations, corrections: legacyCorrections }, aggregate });
    }
  }
  return { ok: mismatches.length === 0, checkedWords: words.length, mismatches };
}

async function createRecord(env, tableId, fields) {
  return teableRequest(env, `/api/table/${tableId}/record?fieldKeyType=name`, { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
}

async function updateRecord(env, tableId, id, fields) {
  return teableRequest(env, `/api/table/${tableId}/record/${id}?fieldKeyType=name`, { method: "PATCH", body: JSON.stringify({ record: { fields } }) });
}

function updateEnvFile(path, key, value) {
  const original = fs.readFileSync(path, "utf8");
  const next = new RegExp(`^${key}=`, "m").test(original)
    ? original.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
    : `${original}${original.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  fs.writeFileSync(path, next);
}

function relationId(value) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function unique(values) {
  const seen = new Set();
  return values.map((value) => String(value ?? "").trim()).filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
