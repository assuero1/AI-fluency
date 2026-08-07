import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";

const TRANSLATION_BATCH_SIZE = 20;
const TRANSLATION_FALLBACK_BATCH_SIZE = 5;
const AI_TIMEOUT_MS = 90_000;

export function wordsMissingTranslation(records) {
  return records.filter((record) => !String(record.fields?.translation ?? "").trim());
}

export function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function parseTranslationItems(content, allowedIds) {
  const result = {};
  try {
    const match = String(content ?? "").match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]");
    if (!Array.isArray(parsed)) return result;
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (typeof value.id !== "string" || !allowedIds.has(value.id)) continue;
      const translation = typeof value.translation === "string" ? value.translation.trim() : "";
      if (translation) result[value.id] = translation;
    }
  } catch (error) {
    console.error("Translation response could not be parsed.", error);
  }
  return result;
}

async function translateBatch(env, batch) {
  const baseUrl = required(env, "AI_BASE_URL").replace(/\/+$/, "");
  const language = String(batch[0]?.language ?? "").trim();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required(env, "AI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: required(env, "AI_CHAT_MODEL"),
      messages: [
        {
          role: "system",
          content: "Traduza cada item para português brasileiro. Responda somente JSON válido: um array com objetos {id, translation}. Preserve cada id exatamente."
        },
        { role: "user", content: `${language ? `Idioma: ${language}\n` : ""}Itens: ${JSON.stringify(batch.map((item) => ({ id: item.id, text: item.text })))}` }
      ],
      temperature: 0,
      max_tokens: 2_000,
      thinking: { type: "disabled" }
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`AI translation request failed with ${response.status}.`);
  const body = await response.json();
  const content = String(body?.choices?.[0]?.message?.content ?? "").trim();
  return parseTranslationItems(content, new Set(batch.map((item) => item.id)));
}

function groupByLanguage(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.language || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

export async function translateWords(env, words, translate = translateBatch, languageByProfileId = {}) {
  const translations = {};
  const items = words.map((record) => ({
    id: record.id,
    text: String(record.fields?.display_text || record.fields?.lemma || record.fields?.Name || record.id),
    language: String(languageByProfileId[record.fields?.language_profile_id] ?? "")
  }));
  for (const group of groupByLanguage(items)) {
    for (const batch of chunkItems(group, TRANSLATION_BATCH_SIZE)) {
      try {
        Object.assign(translations, await translate(env, batch));
      } catch (error) {
        console.error(`Translation batch failed for ${batch.length} word(s).`, error);
      }
    }
  }
  const missing = items.filter((item) => !translations[item.id]);
  let consecutiveFailures = 0;
  let aborted = false;
  for (const group of groupByLanguage(missing)) {
    for (const batch of chunkItems(group, TRANSLATION_FALLBACK_BATCH_SIZE)) {
      try {
        Object.assign(translations, await translate(env, batch));
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        console.error(`Translation fallback batch failed for ${batch.length} word(s).`, error);
        if (consecutiveFailures >= 2) {
          console.error("Aborting remaining fallback batches after consecutive failures.");
          aborted = true;
          break;
        }
      }
    }
    if (aborted) break;
  }
  return translations;
}

async function main() {
  const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const envPath = option("--env") ?? ".env.local";
  const apply = process.argv.includes("--apply");
  const backupPath = option("--backup");
  if (apply && !backupPath) throw new Error("Use --backup <arquivo.json> ao executar com --apply.");
  const env = readEnv(envPath);
  const tableId = required(env, "TEABLE_WORDS_TABLE_ID");
  const records = [];
  for (let skip = 0; ; skip += 1000) {
    const page = recordsFrom(await teableRequest(env, `/api/table/${tableId}/record?take=1000&skip=${skip}&fieldKeyType=name`));
    records.push(...page);
    if (page.length < 1000) break;
  }
  const languageByProfileId = {};
  const profilesTableId = env.TEABLE_LANGUAGE_PROFILES_TABLE_ID?.trim();
  if (profilesTableId) {
    for (let skip = 0; ; skip += 1000) {
      const page = recordsFrom(await teableRequest(env, `/api/table/${profilesTableId}/record?take=1000&skip=${skip}&fieldKeyType=name`));
      for (const profile of page) languageByProfileId[profile.id] = String(profile.fields?.language_code ?? "");
      if (page.length < 1000) break;
    }
  } else {
    console.error("TEABLE_LANGUAGE_PROFILES_TABLE_ID is not set; translation prompts will be sent without language context.");
  }
  const missing = wordsMissingTranslation(records);

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry-run",
      missing: missing.length,
      sample: missing.slice(0, 20).map((record) => ({ id: record.id, lemma: record.fields?.lemma ?? record.fields?.display_text }))
    }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), words: missing }, null, 2)}\n`, { mode: 0o600, flag: "wx" });

  const translations = await translateWords(env, missing, undefined, languageByProfileId);
  let written = 0;
  const failed = [];
  for (const record of missing) {
    const translation = translations[record.id];
    if (!translation) { failed.push(record.id); continue; }
    try {
      await teableRequest(env, `/api/table/${tableId}/record/${record.id}?fieldKeyType=name`, {
        method: "PATCH",
        body: JSON.stringify({ record: { fields: { translation } } })
      });
      written += 1;
    } catch (error) {
      console.error(`Failed to write translation for record ${record.id}.`, error);
      failed.push(record.id);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    missing: missing.length,
    translated: Object.keys(translations).length,
    written,
    failed,
    backupPath
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
