import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/teable/client";
import { LearningStateError } from "./access";
import { CorrectionFields, getConversation, MessageFields, WordFields, WordOccurrenceFields } from "./conversations";
import { matchesLearningScope } from "./scope";
import { addSavedWordsToDailyFeedback } from "./feedback";

export type VocabularyCandidate = {
  id: string;
  text: string;
  normalized: string;
  source: "user" | "assistant";
  messageId: string;
  context: string;
  occurrenceCount: number;
  correctOccurrenceCount: number;
  incorrectOccurrenceCount: number;
  eligible: boolean;
};

type VocabularyOccurrence = Omit<VocabularyCandidate, "id" | "occurrenceCount" | "correctOccurrenceCount" | "incorrectOccurrenceCount" | "eligible"> & {
  wasCorrect: boolean;
  occurrenceOrdinal: number;
};

type VocabularyLinguisticData = { lemma: string; translation: string };

const vocabularySaveLocks = new Map<string, Promise<Awaited<ReturnType<typeof persistSelectedVocabulary>>>>();

export function normalizeVocabularyToken(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function canonicalVocabularyKey(userId: string, profileId: string, lemma: string) {
  return JSON.stringify([userId, profileId, normalizeVocabularyToken(lemma)]);
}

function vocabularyCandidateId(source: VocabularyCandidate["source"], normalized: string) {
  return `${source}:${normalized}`;
}

function tokenize(value: string) {
  return [...value.matchAll(/[\p{L}À-ÿ]+(?:['’][\p{L}À-ÿ]+)*/gu)].map((match) => normalizeVocabularyToken(match[0]));
}

export function findChangedOriginalTokens(originalText: string, correctedText: string) {
  const original = tokenize(originalText);
  const corrected = tokenize(correctedText);
  const lengths = Array.from({ length: original.length + 1 }, () => Array<number>(corrected.length + 1).fill(0));
  for (let left = original.length - 1; left >= 0; left -= 1) {
    for (let right = corrected.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = original[left] === corrected[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const changed: string[] = [];
  let left = 0;
  let right = 0;
  while (left < original.length) {
    if (right < corrected.length && original[left] === corrected[right]) {
      left += 1;
      right += 1;
    } else if (right < corrected.length && lengths[left][right + 1] > lengths[left + 1][right]) {
      right += 1;
    } else {
      changed.push(original[left]);
      left += 1;
    }
  }
  return changed;
}

export function extractVocabularyOccurrences(
  messages: TeableRecord<MessageFields>[],
  corrections: TeableRecord<CorrectionFields>[] = []
) {
  const incorrectByMessage = new Map<string, Map<string, number>>();
  for (const correction of corrections) {
    const counts = incorrectByMessage.get(correction.fields.message_id) ?? new Map<string, number>();
    for (const token of findChangedOriginalTokens(correction.fields.original_text, correction.fields.corrected_text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    incorrectByMessage.set(correction.fields.message_id, counts);
  }
  const occurrences: VocabularyOccurrence[] = [];
  for (const message of messages) {
    if (message.fields.role !== "user" && message.fields.role !== "assistant") continue;
    const ordinalByToken = new Map<string, number>();
    for (const match of message.fields.text.matchAll(/[\p{L}À-ÿ]+(?:['’][\p{L}À-ÿ]+)*/gu)) {
      const text = match[0];
      const normalized = normalizeVocabularyToken(text);
      if (normalized.length < 2) continue;
      const occurrenceOrdinal = (ordinalByToken.get(normalized) ?? 0) + 1;
      ordinalByToken.set(normalized, occurrenceOrdinal);
      const incorrectCounts = incorrectByMessage.get(message.id);
      const incorrectRemaining = incorrectCounts?.get(normalized) ?? 0;
      const wasCorrect = message.fields.role !== "user" || incorrectRemaining === 0;
      if (!wasCorrect) incorrectCounts?.set(normalized, incorrectRemaining - 1);
      occurrences.push({
        text,
        normalized,
        source: message.fields.role,
        messageId: message.id,
        context: message.fields.text,
        wasCorrect,
        occurrenceOrdinal
      });
    }
  }
  return occurrences;
}

export function extractVocabularyCandidates(
  messages: TeableRecord<MessageFields>[],
  corrections: TeableRecord<CorrectionFields>[] = []
) {
  const candidates = new Map<string, VocabularyCandidate>();
  for (const occurrence of extractVocabularyOccurrences(messages, corrections)) {
    const id = vocabularyCandidateId(occurrence.source, occurrence.normalized);
    const existing = candidates.get(id);
    if (existing) {
      existing.occurrenceCount += 1;
      if (occurrence.wasCorrect) existing.correctOccurrenceCount += 1;
      else existing.incorrectOccurrenceCount += 1;
      existing.eligible = existing.correctOccurrenceCount > 0;
      continue;
    }
    candidates.set(id, {
      id,
      text: occurrence.text,
      normalized: occurrence.normalized,
      source: occurrence.source,
      messageId: occurrence.messageId,
      context: occurrence.context,
      occurrenceCount: 1,
      correctOccurrenceCount: occurrence.wasCorrect ? 1 : 0,
      incorrectOccurrenceCount: occurrence.wasCorrect ? 0 : 1,
      eligible: occurrence.wasCorrect
    });
  }
  return [...candidates.values()];
}

export function getSavedVocabularyCandidateIds(
  messages: TeableRecord<MessageFields>[],
  occurrences: TeableRecord<WordOccurrenceFields>[]
) {
  const rolesByMessage = new Map(messages.map((message) => [message.id, message.fields.role]));
  return [...new Set(occurrences.flatMap((occurrence) => {
    const role = rolesByMessage.get(occurrence.fields.message_id);
    if (role !== "user" && role !== "assistant") return [];
    return [vocabularyCandidateId(role, normalizeVocabularyToken(occurrence.fields.used_text))];
  }))];
}

export async function saveSelectedVocabulary(conversationId: string, candidateIds: string[]) {
  const previous = vocabularySaveLocks.get(conversationId) ?? Promise.resolve(undefined);
  const current = previous.catch(() => undefined).then(() => persistSelectedVocabulary(conversationId, candidateIds));
  vocabularySaveLocks.set(conversationId, current);
  try {
    return await current;
  } finally {
    if (vocabularySaveLocks.get(conversationId) === current) vocabularySaveLocks.delete(conversationId);
  }
}

async function persistSelectedVocabulary(conversationId: string, candidateIds: string[]) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (context.conversation.fields.status !== "completed") {
    throw new LearningStateError("Finalize a conversa antes de salvar palavras.", 409);
  }
  const allOccurrences = extractVocabularyOccurrences(context.messages, context.corrections);
  const allowed = new Map(extractVocabularyCandidates(context.messages, context.corrections).map((item) => [item.id, item]));
  const selected = [...new Set(candidateIds)].map((id) => allowed.get(id)).filter((item): item is VocabularyCandidate => Boolean(item)).slice(0, 80);
  if (!selected.length) throw new LearningStateError("Selecione ao menos uma palavra.", 400);

  const client = getTeableClient();
  const [existingWords, occurrences, linguisticData] = await Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
    analyzeVocabulary(selected, context.profile?.fields.language_code ?? "auto")
  ]);
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  let savedCount = 0;
  let newWordCount = 0;
  let rejectedCount = 0;
  const updatedWordIds = new Set<string>();
  const touchedWordIds = new Set<string>();

  for (const candidate of selected) {
    const candidateOccurrences = allOccurrences.filter((item) =>
      item.source === candidate.source && item.normalized === candidate.normalized && item.wasCorrect
    );
    rejectedCount += candidate.incorrectOccurrenceCount;
    if (!candidateOccurrences.length) continue;
    const missingOccurrences = candidateOccurrences.filter((item, index, items) => {
      const ordinalInMessage = items.slice(0, index + 1).filter((previous) => previous.messageId === item.messageId).length;
      const persistedInMessage = occurrences.filter((persisted) =>
        persisted.fields.conversation_id === conversationId &&
        persisted.fields.message_id === item.messageId &&
        normalizeVocabularyToken(persisted.fields.used_text) === candidate.normalized
      ).length;
      return ordinalInMessage > persistedInMessage;
    });
    if (!missingOccurrences.length) continue;
    const linguistic = linguisticData[candidate.id] ?? { lemma: candidate.normalized, translation: "" };
    const canonicalLemma = normalizeVocabularyToken(linguistic.lemma) || candidate.normalized;
    const canonicalKey = canonicalVocabularyKey(context.conversation.fields.user_id, context.conversation.fields.language_profile_id, canonicalLemma);
    const userUseCount = candidate.source === "user" ? missingOccurrences.length : 0;
    let word = existingWords.find((item) =>
      (item.fields.canonical_key === canonicalKey || normalizeVocabularyToken(item.fields.lemma || item.fields.display_text) === canonicalLemma) &&
      matchesLearningScope(item.fields, { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id })
    );
    if (word) {
      const updates: Partial<WordFields> = { review_due_at: reviewDue };
      if (userUseCount > 0) {
        updates.total_uses = Number(word.fields.total_uses ?? 0) + userUseCount;
        updates.last_used_at = now;
      }
      word = await client.updateRecord<WordFields>("words", word.id, updates);
      updatedWordIds.add(word.id);
      const wordIndex = existingWords.findIndex((item) => item.id === word?.id);
      if (wordIndex >= 0) existingWords[wordIndex] = word;
    } else {
      const newWordFields: WordFields = {
        Name: candidate.text,
        user_id: context.conversation.fields.user_id,
        language_profile_id: context.conversation.fields.language_profile_id,
        lemma: canonicalLemma,
        canonical_key: canonicalKey,
        display_text: candidate.text,
        translation: linguistic.translation,
        part_of_speech: "",
        familiarity_score: 1,
        total_uses: userUseCount,
        last_used_at: now,
        first_used_at: now,
        review_due_at: reviewDue
      };
      try {
        word = await client.createRecord<WordFields>("words", newWordFields);
      } catch (error) {
        if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
        const refreshedWords = await client.listAllRecords<WordFields>("words");
        word = refreshedWords.find((item) => item.fields.canonical_key === canonicalKey);
        if (!word) throw error;
        const updates: Partial<WordFields> = { review_due_at: reviewDue };
        if (userUseCount > 0) {
          updates.total_uses = Number(word.fields.total_uses ?? 0) + userUseCount;
          updates.last_used_at = now;
        }
        word = await client.updateRecord<WordFields>("words", word.id, updates);
        updatedWordIds.add(word.id);
      }
      existingWords.push(word);
      if (!updatedWordIds.has(word.id)) newWordCount += 1;
    }
    for (const occurrence of missingOccurrences) {
      const occurrenceKey = JSON.stringify([conversationId, occurrence.messageId, occurrence.normalized, occurrence.occurrenceOrdinal]);
      let created: TeableRecord<WordOccurrenceFields>;
      try {
        created = await client.createRecord<WordOccurrenceFields>("wordOccurrences", {
        Name: occurrence.text,
        word_id: word.id,
        occurrence_key: occurrenceKey,
        conversation_id: conversationId,
        message_id: occurrence.messageId,
        used_text: occurrence.text,
        sentence_context: occurrence.context,
        was_correct: true,
        created_at: now
        });
      } catch (error) {
        if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
        const refreshed = await client.listAllRecords<WordOccurrenceFields>("wordOccurrences");
        const existing = refreshed.find((item) => item.fields.occurrence_key === occurrenceKey);
        if (!existing) throw error;
        created = existing;
      }
      occurrences.push(created);
    }
    touchedWordIds.add(word.id);
    savedCount += missingOccurrences.length;
  }
  await reconcileVocabularyTotals(client, touchedWordIds);
  await addSavedWordsToDailyFeedback(context.conversation, newWordCount);
  return { savedCount, newWordCount, updatedWordCount: updatedWordIds.size, rejectedCount };
}

async function reconcileVocabularyTotals(client: ReturnType<typeof getTeableClient>, wordIds: Set<string>) {
  if (wordIds.size === 0) return;
  // A second pass makes concurrent writers converge after their unique occurrence inserts settle.
  for (let pass = 0; pass < 2; pass += 1) {
    const [allOccurrences, allMessages, allWords] = await Promise.all([
      client.listAllRecords<WordOccurrenceFields>("wordOccurrences"),
      client.listAllRecords<MessageFields>("messages"),
      client.listAllRecords<WordFields>("words")
    ]);
    const rolesByMessage = new Map(allMessages.map((message) => [message.id, message.fields.role]));
    for (const wordId of wordIds) {
      const learnerUses = allOccurrences.filter((occurrence) =>
        occurrence.fields.word_id === wordId &&
        occurrence.fields.was_correct !== false &&
        rolesByMessage.get(occurrence.fields.message_id) === "user"
      );
      const word = allWords.find((item) => item.id === wordId);
      if (!word || Number(word.fields.total_uses ?? 0) === learnerUses.length) continue;
      const lastUsedAt = learnerUses.map((occurrence) => occurrence.fields.created_at).filter(Boolean).sort().at(-1);
      await client.updateRecord<WordFields>("words", wordId, {
        total_uses: learnerUses.length,
        ...(lastUsedAt ? { last_used_at: lastUsedAt } : {})
      });
    }
  }
}

async function analyzeVocabulary(candidates: VocabularyCandidate[], language: string) {
  const fallback = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    lemma: fallbackVocabularyLemma(candidate.normalized, language),
    translation: ""
  }])) as Record<string, VocabularyLinguisticData>;
  try {
    const response = await createChatCompletion([
      {
        role: "system",
        content: "Analise vocabulário no idioma informado. Responda somente JSON válido: um array com objetos {id, lemma, translation}. Preserve cada id exatamente, use no lemma a forma canônica de dicionário no idioma alvo e traduza brevemente para português brasileiro."
      },
      { role: "user", content: `Idioma: ${language}\nItens: ${JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, text: candidate.text, context: candidate.context })))}` }
    ], { temperature: 0, maxTokens: 900 });
    const match = response.content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const allowedIds = new Set(candidates.map((candidate) => candidate.id));
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || !allowedIds.has(item.id) || typeof item.lemma !== "string") continue;
      const lemma = normalizeVocabularyToken(item.lemma);
      if (!lemma) continue;
      fallback[item.id] = {
        lemma,
        translation: typeof item.translation === "string" ? item.translation.trim() : ""
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function fallbackVocabularyLemma(value: string, language: string) {
  const word = normalizeVocabularyToken(value);
  const code = language.toLocaleLowerCase().split(/[-_]/)[0];
  const irregular: Record<string, Record<string, string>> = {
    en: { went: "go", gone: "go", was: "be", were: "be", been: "be", did: "do", done: "do", had: "have", made: "make" }
  };
  if (irregular[code]?.[word]) return irregular[code][word];
  if (code === "en") {
    if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 5 && word.endsWith("ing")) return undoubleFinalConsonant(word.slice(0, -3));
    if (word.length > 4 && word.endsWith("ed")) return undoubleFinalConsonant(word.slice(0, -2));
    if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  }
  if (code === "es") {
    if (word.endsWith("ando") && word.length > 5) return `${word.slice(0, -4)}ar`;
    if (word.endsWith("iendo") && word.length > 6) return `${word.slice(0, -5)}er`;
  }
  if (code === "fr" && word.endsWith("ant") && word.length > 4) return `${word.slice(0, -3)}er`;
  if (code === "it" && word.endsWith("ando") && word.length > 5) return `${word.slice(0, -4)}are`;
  if (code === "it" && word.endsWith("endo") && word.length > 5) return `${word.slice(0, -4)}ere`;
  return word;
}

function undoubleFinalConsonant(value: string) {
  const last = value.at(-1);
  const previous = value.at(-2);
  return last && last === previous && !/[aeiou]/.test(last) ? value.slice(0, -1) : value;
}
