import type { TeableClient, TeableRecord } from "@/lib/supabase/client";
import type { WordFields } from "./conversations";

function parseVocabularyForms(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((form): form is string => typeof form === "string" && Boolean(form.trim()))
      : [];
  } catch {
    return [];
  }
}

export type HuntWord = {
  wordId: string;
  lemma: string;
  translation: string;
  forms: string[];
};

export const HUNT_WORD_COUNT = 2;
export const MAX_HUNT_WORDS = 3;

export function parseHuntWords(raw: unknown): HuntWord[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is HuntWord =>
      Boolean(item && typeof item === "object" && "wordId" in item && "lemma" in item)
    );
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseHuntWords(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export async function selectHuntWords(
  client: TeableClient,
  userId: string,
  profileId: string,
  options: {
    specificWordIds?: string[];
    count?: number;
  } = {}
): Promise<HuntWord[]> {
  const targetCount = Math.min(MAX_HUNT_WORDS, Math.max(1, options.count ?? HUNT_WORD_COUNT));
  let words: TeableRecord<WordFields>[] = [];
  if (typeof client.listRecordsWhereAll === "function") {
    words = await client.listRecordsWhereAll<WordFields>("words", [
      { field: "user_id", value: userId },
      { field: "language_profile_id", value: profileId }
    ]);
  } else if (typeof client.listRecordsWhere === "function") {
    words = await client.listRecordsWhere<WordFields>("words", "user_id", userId);
  } else if (typeof client.listRecords === "function") {
    words = await client.listRecords<WordFields>("words");
  }

  if (!words.length) return [];

  if (options.specificWordIds && options.specificWordIds.length > 0) {
    const idSet = new Set(options.specificWordIds);
    const chosen = words.filter((w) => idSet.has(w.id)).slice(0, MAX_HUNT_WORDS);
    if (chosen.length > 0) {
      return chosen.map(toHuntWord);
    }
  }

  const valid = words.filter((w) => {
    const lemma = (w.fields.lemma || "").trim();
    if (!lemma) return false;
    if (w.fields.review_state === "suspended") return false;
    return true;
  });

  if (!valid.length) return [];

  const now = Date.now();
  const sorted = [...valid].sort((a, b) => {
    const scoreA = priorityScore(a.fields, now);
    const scoreB = priorityScore(b.fields, now);
    return scoreB - scoreA;
  });

  return sorted.slice(0, targetCount).map(toHuntWord);
}

function priorityScore(fields: WordFields, now: number): number {
  if (fields.review_state === "learning") return 100;
  if (fields.review_state === "difficult") return 80;
  if (fields.review_due_at) {
    const dueTime = new Date(fields.review_due_at).getTime();
    if (!Number.isNaN(dueTime) && dueTime <= now + 48 * 3600 * 1000) return 60;
  }
  return 10;
}

function toHuntWord(record: TeableRecord<WordFields>): HuntWord {
  const forms = parseVocabularyForms(record.fields.forms_json);
  const lemma = (record.fields.lemma || "").trim();
  const formsWithoutLemma = forms.filter((f) => f.toLowerCase() !== lemma.toLowerCase());
  return {
    wordId: record.id,
    lemma,
    translation: record.fields.translation || "",
    forms: formsWithoutLemma
  };
}

export function detectHuntWordsInMessage(
  message: string,
  huntWords: HuntWord[]
): HuntWord[] {
  if (!message.trim() || !huntWords.length) return [];
  const normalizedMessage = message.toLowerCase().normalize("NFC");

  return huntWords.filter((hw) => {
    const candidates = [hw.lemma, ...hw.forms].map((f) => f.trim()).filter(Boolean);
    return candidates.some((candidate) => {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu");
      return regex.test(normalizedMessage);
    });
  });
}
