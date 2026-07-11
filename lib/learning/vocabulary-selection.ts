import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/teable/client";
import { LearningStateError } from "./access";
import { CorrectionFields, getConversation, MessageFields, WordFields, WordUsageSummaryFields } from "./conversations";
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

export type VocabularyCandidateGroup = {
  id: string;
  lemma: string;
  displayText: string;
  translation: string;
  partOfSpeech: string;
  forms: string[];
  source: "user" | "assistant";
  candidateIds: string[];
  occurrenceCount: number;
  correctOccurrenceCount: number;
  incorrectOccurrenceCount: number;
  eligible: boolean;
};

export type ExistingVocabularyFamily = {
  lemma: string;
  displayText: string;
  formsJson?: string;
};

type VocabularyOccurrence = Omit<VocabularyCandidate, "id" | "occurrenceCount" | "correctOccurrenceCount" | "incorrectOccurrenceCount" | "eligible"> & {
  wasCorrect: boolean;
  occurrenceOrdinal: number;
};

type VocabularyLinguisticData = { lemma: string; translation: string; partOfSpeech: string };

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

/**
 * Keeps the end-of-conversation picker focused on additions.  Comparing the
 * fallback lemma also avoids offering common inflections (for example,
 * "worked") when its base form is already in the learner's vocabulary.
 */
export function filterNewVocabularyCandidates(
  candidates: VocabularyCandidate[],
  existingWords: string[],
  language: string
) {
  const existing = new Set(existingWords.map(normalizeVocabularyToken));
  return candidates.filter((candidate) =>
    !existing.has(candidate.normalized) &&
    !existing.has(fallbackVocabularyLemma(candidate.normalized, language))
  );
}

export async function groupNewVocabularyCandidates(
  candidates: VocabularyCandidate[],
  existingWords: ExistingVocabularyFamily[],
  language: string
) {
  const limited = candidates.slice(0, 80);
  const linguisticData = await analyzeVocabulary(limited, language);
  const groups = groupCandidatesByLemma(limited, linguisticData);
  const existingKeys = new Set(existingWords.flatMap((word) => [
    normalizeVocabularyToken(word.lemma || word.displayText),
    normalizeVocabularyToken(word.displayText),
    ...parseVocabularyForms(word.formsJson).map(normalizeVocabularyToken)
  ]).filter(Boolean));
  return groups.filter((group) =>
    !existingKeys.has(group.lemma) &&
    !group.forms.some((form) => existingKeys.has(normalizeVocabularyToken(form)))
  );
}

export async function getConversationVocabularyGroups(conversationId: string) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (context.conversation.fields.status !== "completed") {
    throw new LearningStateError("Finalize a conversa antes de escolher palavras.", 409);
  }
  const words = await getTeableClient().listAllRecords<WordFields>("words");
  const scope = {
    userId: context.conversation.fields.user_id,
    profileId: context.conversation.fields.language_profile_id
  };
  return groupNewVocabularyCandidates(
    extractVocabularyCandidates(context.messages, context.corrections),
    words.filter((word) => matchesLearningScope(word.fields, scope)).map((word) => ({
      lemma: word.fields.lemma,
      displayText: word.fields.display_text,
      formsJson: word.fields.forms_json
    })),
    context.profile?.fields.language_code ?? "auto"
  );
}

function groupCandidatesByLemma(
  candidates: VocabularyCandidate[],
  linguisticData: Record<string, VocabularyLinguisticData>
) {
  const groups = new Map<string, VocabularyCandidateGroup>();
  for (const candidate of candidates) {
    const linguistic = linguisticData[candidate.id] ?? {
      lemma: candidate.normalized,
      translation: "",
      partOfSpeech: ""
    };
    const lemma = normalizeVocabularyToken(linguistic.lemma) || candidate.normalized;
    const existing = groups.get(lemma);
    if (existing) {
      existing.forms = uniqueVocabularyForms([...existing.forms, candidate.text]);
      existing.candidateIds.push(candidate.id);
      existing.occurrenceCount += candidate.occurrenceCount;
      existing.correctOccurrenceCount += candidate.correctOccurrenceCount;
      existing.incorrectOccurrenceCount += candidate.incorrectOccurrenceCount;
      existing.eligible = existing.eligible || candidate.eligible;
      if (candidate.source === "user") existing.source = "user";
      if (!existing.translation && linguistic.translation) existing.translation = linguistic.translation;
      if (!existing.partOfSpeech && linguistic.partOfSpeech) existing.partOfSpeech = linguistic.partOfSpeech;
      continue;
    }
    groups.set(lemma, {
      id: `lemma:${lemma}`,
      lemma,
      displayText: lemma,
      translation: linguistic.translation,
      partOfSpeech: linguistic.partOfSpeech,
      forms: uniqueVocabularyForms([candidate.text]),
      source: candidate.source,
      candidateIds: [candidate.id],
      occurrenceCount: candidate.occurrenceCount,
      correctOccurrenceCount: candidate.correctOccurrenceCount,
      incorrectOccurrenceCount: candidate.incorrectOccurrenceCount,
      eligible: candidate.eligible
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    candidateIds: group.candidateIds.filter((id) => candidates.find((candidate) => candidate.id === id)?.eligible)
  })).filter((group) => group.candidateIds.length > 0);
}

export function parseVocabularyForms(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((form): form is string => typeof form === "string" && Boolean(form.trim())) : [];
  } catch {
    return [];
  }
}

function uniqueVocabularyForms(forms: string[]) {
  const seen = new Set<string>();
  return forms.filter((form) => {
    const key = normalizeVocabularyToken(form);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const [existingWords, usageSummaries, linguisticData] = await Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries"),
    analyzeVocabulary(selected, context.profile?.fields.language_code ?? "auto")
  ]);
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const scope = { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id };
  let savedCount = 0;
  let newWordCount = 0;
  let rejectedCount = 0;
  let updatedWordCount = 0;

  for (const family of groupCandidatesByLemma(selected, linguisticData)) {
    const familyCandidates = selected.filter((candidate) => family.candidateIds.includes(candidate.id));
    const candidateKeys = new Set(familyCandidates.map((candidate) => `${candidate.source}:${candidate.normalized}`));
    const relevant = allOccurrences.filter((occurrence) =>
      occurrence.wasCorrect && candidateKeys.has(`${occurrence.source}:${occurrence.normalized}`)
    );
    if (!relevant.length) continue;
    rejectedCount += familyCandidates.reduce((sum, candidate) => sum + candidate.incorrectOccurrenceCount, 0);
    const canonicalKey = canonicalVocabularyKey(scope.userId, scope.profileId, family.lemma);
    const forms = uniqueVocabularyForms([...family.forms, ...relevant.map((occurrence) => occurrence.text)]);
    const correctUseCount = relevant.filter((occurrence) => occurrence.source === "user").length;
    let word = existingWords.find((item) =>
      matchesLearningScope(item.fields, scope) &&
      (item.fields.canonical_key === canonicalKey || normalizeVocabularyToken(item.fields.lemma || item.fields.display_text) === family.lemma)
    );
    let createdWord = false;
    if (!word) {
      const fields: WordFields = {
        Name: family.lemma,
        user_id: scope.userId,
        language_profile_id: scope.profileId,
        lemma: family.lemma,
        canonical_key: canonicalKey,
        display_text: family.lemma,
        forms_json: JSON.stringify(forms),
        translation: family.translation,
        part_of_speech: family.partOfSpeech,
        familiarity_score: 1,
        total_uses: correctUseCount,
        last_used_at: now,
        first_used_at: now,
        review_due_at: reviewDue
      };
      try {
        word = await client.createRecord<WordFields>("words", fields);
        createdWord = true;
        existingWords.push(word);
      } catch (error) {
        if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
        const refreshed = await client.listAllRecords<WordFields>("words");
        word = refreshed.find((item) => item.fields.canonical_key === canonicalKey);
        if (!word) throw error;
      }
    }
    const resolvedWord = word;
    const usageKey = wordUsageKey(resolvedWord.id, conversationId);
    const existingUsage = usageSummaries.find((summary) => summary.fields.usage_key === usageKey);
    const previousObservedCount = Number(existingUsage?.fields.observed_count ?? 0);
    const otherUses = usageSummaries.filter((summary) => summary.fields.word_id === resolvedWord.id && summary.fields.usage_key !== usageKey)
      .reduce((sum, summary) => sum + Number(summary.fields.correct_use_count ?? 0), 0);
    const mergedForms = uniqueVocabularyForms([...parseVocabularyForms(resolvedWord.fields.forms_json), ...forms]);
    word = await client.updateRecord<WordFields>("words", resolvedWord.id, {
      forms_json: JSON.stringify(mergedForms),
      total_uses: otherUses + correctUseCount,
      last_used_at: correctUseCount > 0 ? now : resolvedWord.fields.last_used_at,
      review_due_at: reviewDue,
      ...(!resolvedWord.fields.translation && family.translation ? { translation: family.translation } : {}),
      ...(!resolvedWord.fields.part_of_speech && family.partOfSpeech ? { part_of_speech: family.partOfSpeech } : {})
    });
    const summaryFields: WordUsageSummaryFields = {
      Name: forms[0] ?? family.lemma,
      usage_key: usageKey,
      word_id: resolvedWord.id,
      conversation_id: conversationId,
      forms_json: JSON.stringify(forms),
      observed_count: relevant.length,
      correct_use_count: correctUseCount,
      correction_count: familyCandidates.reduce((sum, candidate) => sum + candidate.incorrectOccurrenceCount, 0),
      first_used_at: existingUsage?.fields.first_used_at || now,
      last_used_at: now
    };
    const persisted = await upsertWordUsageSummary(client, usageSummaries, existingUsage, summaryFields);
    if (!existingUsage) usageSummaries.push(persisted);
    savedCount += Math.max(0, relevant.length - previousObservedCount);
    if (createdWord) newWordCount += 1;
    else updatedWordCount += 1;
  }
  await addSavedWordsToDailyFeedback(context.conversation, newWordCount);
  return { savedCount, newWordCount, updatedWordCount, rejectedCount };
}

function wordUsageKey(wordId: string, conversationId: string) {
  return JSON.stringify([wordId, conversationId]);
}

async function upsertWordUsageSummary(
  client: ReturnType<typeof getTeableClient>,
  usageSummaries: TeableRecord<WordUsageSummaryFields>[],
  existing: TeableRecord<WordUsageSummaryFields> | undefined,
  fields: WordUsageSummaryFields
) {
  if (existing) {
    const updated = await client.updateRecord<WordUsageSummaryFields>("wordUsageSummaries", existing.id, fields);
    Object.assign(existing, updated);
    return updated;
  }
  try {
    return await client.createRecord<WordUsageSummaryFields>("wordUsageSummaries", fields);
  } catch (error) {
    if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
    const refreshed = await client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries");
    const concurrent = refreshed.find((summary) => summary.fields.usage_key === fields.usage_key);
    if (!concurrent) throw error;
    return client.updateRecord<WordUsageSummaryFields>("wordUsageSummaries", concurrent.id, fields);
  }
}

async function analyzeVocabulary(candidates: VocabularyCandidate[], language: string) {
  const fallback = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    lemma: fallbackVocabularyLemma(candidate.normalized, language),
    translation: "",
    partOfSpeech: ""
  }])) as Record<string, VocabularyLinguisticData>;
  try {
    const response = await createChatCompletion([
      {
        role: "system",
        content: "Analise vocabulário no idioma informado. Responda somente JSON válido: um array com objetos {id, lemma, translation, part_of_speech}. Preserve cada id exatamente, agrupe flexões usando o mesmo lemma canônico de dicionário, traduza brevemente para português brasileiro e informe a classe gramatical no idioma alvo."
      },
      { role: "user", content: `Idioma: ${language}\nItens: ${JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, text: candidate.text, context: candidate.context })))}` }
    ], { temperature: 0, maxTokens: 900, timeoutMs: 4_500 });
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
        translation: typeof item.translation === "string" ? item.translation.trim() : "",
        partOfSpeech: typeof item.part_of_speech === "string" ? item.part_of_speech.trim() : ""
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
    en: { went: "go", gone: "go", was: "be", were: "be", been: "be", did: "do", done: "do", had: "have", made: "make" },
    pt: {
      fui: "ir", foi: "ir", fomos: "ir", foram: "ir", vou: "ir", vai: "ir", vamos: "ir", vão: "ir",
      sou: "ser", somos: "ser", são: "ser", era: "ser", eram: "ser",
      tive: "ter", teve: "ter", tivemos: "ter", tiveram: "ter"
    },
    es: { fui: "ir", fue: "ir", fuimos: "ir", fueron: "ir", voy: "ir", va: "ir", vamos: "ir", van: "ir" },
    fr: { étais: "être", était: "être", étions: "être", étaient: "être" },
    it: { sono: "essere", era: "essere", erano: "essere", siamo: "essere" }
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
