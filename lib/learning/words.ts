import { startConversation } from "./conversations";
import type { CorrectionFields, ConversationFields, WordFields, WordOccurrenceFields } from "./conversations";
import type { TopicFields } from "./home";
import { getActiveLanguageProfile, getOrCreatePersonalUser } from "./profile";
import { createTopic } from "./topics";
import { matchesLearningScope } from "./scope";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";

export const wordFilters = ["all", "recent", "review", "corrected"] as const;
export type WordFilter = (typeof wordFilters)[number];

type WordOccurrenceView = {
  id: string;
  usedText: string;
  sentenceContext: string;
  wasCorrect: boolean;
  createdAt: string;
  conversationTitle: string;
  topicTitle: string;
  corrections: Array<{
    id: string;
    originalText: string;
    correctedText: string;
    explanation: string;
    errorType: string;
  }>;
};

export type WordListItem = {
  id: string;
  displayText: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
  totalUses: number;
  familiarityScore: number;
  firstUsedAt: string;
  lastUsedAt: string;
  reviewDueAt: string;
  occurrenceCount: number;
  correctionCount: number;
  needsReview: boolean;
};

type WordScope = {
  userId: string;
  profileId?: string;
  languageCode: string;
  weeklyWordGoal: number;
};

export function normalizeWordFilter(value: string | undefined): WordFilter {
  return wordFilters.includes(value as WordFilter) ? (value as WordFilter) : "all";
}

export function normalizeWordSearchQuery(value: string) {
  return normalizeSearchText(value).slice(0, 80);
}

export function matchesWordSearch(
  word: Pick<WordListItem, "displayText" | "lemma" | "translation">,
  query: string
) {
  const normalizedQuery = normalizeWordSearchQuery(query);
  if (!normalizedQuery) return true;
  return normalizeSearchText(`${word.displayText} ${word.lemma} ${word.translation}`).includes(normalizedQuery);
}

export async function getWordsData(filter: WordFilter = "all", query = "") {
  const [scope, records] = await Promise.all([getWordScope(), getWordRecords()]);
  const scoped = records.words.filter(
    (word) => matchesScope(word, scope) && Boolean(word.fields.display_text?.trim() || word.fields.lemma?.trim())
  );
  const correctionMessageIds = new Set(
    records.corrections.filter((correction) => correctionBelongsToScope(correction, records.conversations, scope)).map((correction) => correction.fields.message_id)
  );
  const now = Date.now();
  const mapped = scoped.map((word) => toWordListItem(word, records.occurrences, correctionMessageIds, now));
  const normalizedQuery = normalizeWordSearchQuery(query);
  const visibleWords = mapped
    .filter((word) => matchesFilter(word, filter))
    .filter((word) => {
      return matchesWordSearch(word, normalizedQuery);
    })
    .sort((a, b) => dateValue(b.lastUsedAt || b.firstUsedAt) - dateValue(a.lastUsedAt || a.firstUsedAt));

  const weeklyNew = mapped.filter((word) => isWithinDays(word.firstUsedAt, 7)).length;
  const toReview = mapped.filter((word) => word.needsReview).length;

  return {
    filter,
    languageCode: scope.languageCode,
    query: query.trim().slice(0, 80),
    words: visibleWords,
    summary: {
      totalWords: mapped.length,
      totalUses: mapped.reduce((sum, word) => sum + word.totalUses, 0),
      weeklyNew,
      weeklyGoal: scope.weeklyWordGoal,
      toReview,
      correctedWords: mapped.filter((word) => word.correctionCount > 0).length
    }
  };
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export async function getWordDetail(wordId: string) {
  const [scope, records] = await Promise.all([getWordScope(), getWordRecords()]);
  const word = records.words.find(
    (record) =>
      record.id === wordId &&
      matchesScope(record, scope) &&
      Boolean(record.fields.display_text?.trim() || record.fields.lemma?.trim())
  );
  if (!word) return null;

  const correctionByMessage = new Map<string, TeableRecord<CorrectionFields>[]>();
  for (const correction of records.corrections) {
    const list = correctionByMessage.get(correction.fields.message_id) ?? [];
    list.push(correction);
    correctionByMessage.set(correction.fields.message_id, list);
  }

  const occurrences = records.occurrences
    .filter((occurrence) => occurrence.fields.word_id === word.id)
    .sort((a, b) => dateValue(b.fields.created_at) - dateValue(a.fields.created_at))
    .map<WordOccurrenceView>((occurrence) => {
      const conversation = records.conversations.find((item) => item.id === occurrence.fields.conversation_id);
      const topic = records.topics.find((item) => item.id === conversation?.fields.topic_id);
      const corrections = (correctionByMessage.get(occurrence.fields.message_id) ?? []).map((correction) => ({
        id: correction.id,
        originalText: correction.fields.original_text,
        correctedText: correction.fields.corrected_text,
        explanation: correction.fields.explanation,
        errorType: correction.fields.error_type
      }));

      return {
        id: occurrence.id,
        usedText: occurrence.fields.used_text || word.fields.display_text || word.fields.lemma,
        sentenceContext: occurrence.fields.sentence_context,
        wasCorrect: occurrence.fields.was_correct !== false,
        createdAt: occurrence.fields.created_at,
        conversationTitle: conversation?.fields.Name || "Conversa",
        topicTitle: topic?.fields.title || topic?.fields.Name || conversation?.fields.Name || "Conversa livre",
        corrections
      };
    });

  const correctionMessageIds = new Set(
    records.corrections.filter((correction) => correctionBelongsToScope(correction, records.conversations, scope)).map((correction) => correction.fields.message_id)
  );

  return {
    languageCode: scope.languageCode,
    word: toWordListItem(word, records.occurrences, correctionMessageIds, Date.now()),
    occurrences
  };
}

export async function startWordPractice(wordId: string) {
  const detail = await getWordDetail(wordId);
  if (!detail) throw new Error("Palavra não encontrada no seu vocabulário ativo.");

  return startVocabularyConversation([detail.word], "word");
}

export async function startWeakWordsPractice() {
  const data = await getWordsData("all");
  const candidates = [...data.words]
    .filter((word) => word.needsReview || word.correctionCount > 0)
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || b.correctionCount - a.correctionCount || a.totalUses - b.totalUses);
  const selected = (candidates.length ? candidates : data.words).slice(0, 4);

  if (selected.length === 0) {
    throw new Error("Ainda não há palavras suficientes para revisar. Faça uma conversa primeiro.");
  }

  return startVocabularyConversation(selected, "weak_words");
}

async function startVocabularyConversation(words: WordListItem[], source: "word" | "weak_words") {
  const names = words.map((word) => word.displayText).join(", ");
  const title = source === "word" ? `Revisão de vocabulário: ${names}` : `Revisão de palavras fracas: ${names}`;
  const reason = [
    "Conduza uma conversa curta e natural no idioma alvo.",
    `Faça o usuário usar estas palavras em contexto: ${names}.`,
    "Se houver erro, corrija com clareza, explique em português e peça uma nova tentativa."
  ].join(" ");
  const created = await createTopic({
    title,
    source: source === "weak_words" ? "weak_words" : "user_custom",
    reason,
    relatedWords: words.map((word) => word.id).join(","),
    difficulty: "B1"
  });
  const result = await startConversation({
    topicId: created.topic.id,
    title,
    mode: "review_words",
    source: source === "weak_words" ? "weak_words" : "user_custom",
    reason
  });

  await getTeableClient().createEvent(created.user.id, "word_practice_started", {
    conversation_id: result.conversation.id,
    topic_id: created.topic.id,
    source,
    word_ids: words.map((word) => word.id),
    words: words.map((word) => word.displayText)
  });

  return result;
}

async function getWordScope(): Promise<WordScope> {
  const user = await getOrCreatePersonalUser();
  const profile = await getActiveLanguageProfile(user);
  return {
    userId: user.id,
    profileId: profile?.id,
    languageCode: profile?.fields.language_code ?? "en",
    weeklyWordGoal: Number(profile?.fields.weekly_word_goal ?? 500)
  };
}

async function getWordRecords() {
  const client = getTeableClient();
  const [words, occurrences, corrections, conversations, topics] = await Promise.all([
    client.listRecords<WordFields>("words", 300),
    client.listRecords<WordOccurrenceFields>("wordOccurrences", 200),
    client.listRecords<CorrectionFields>("corrections", 300),
    client.listRecords<ConversationFields>("conversations", 300),
    client.listRecords<TopicFields>("topics", 300)
  ]);
  return { words, occurrences, corrections, conversations, topics };
}

function matchesScope(word: TeableRecord<WordFields>, scope: WordScope) {
  return matchesLearningScope(word.fields, scope);
}

function correctionBelongsToScope(
  correction: TeableRecord<CorrectionFields>,
  conversations: TeableRecord<ConversationFields>[],
  scope: WordScope
) {
  const conversation = conversations.find((item) => item.id === correction.fields.conversation_id);
  if (!conversation) return false;
  return matchesLearningScope(conversation.fields, scope);
}

function toWordListItem(
  word: TeableRecord<WordFields>,
  occurrences: TeableRecord<WordOccurrenceFields>[],
  correctionMessageIds: Set<string>,
  now: number
): WordListItem {
  const wordOccurrences = occurrences.filter((occurrence) => occurrence.fields.word_id === word.id);
  const correctionCount = wordOccurrences.filter((occurrence) => correctionMessageIds.has(occurrence.fields.message_id)).length;
  const reviewDueAt = word.fields.review_due_at || "";
  const needsReview = (isPastOrToday(reviewDueAt, now) || correctionCount > 0) && wordOccurrences.length > 0;

  return {
    id: word.id,
    displayText: word.fields.display_text || word.fields.lemma || "Palavra sem nome",
    lemma: word.fields.lemma || word.fields.display_text || "",
    translation: word.fields.translation || "Tradução a adicionar",
    partOfSpeech: word.fields.part_of_speech || "",
    totalUses: Number(word.fields.total_uses ?? wordOccurrences.length ?? 0),
    familiarityScore: Number(word.fields.familiarity_score ?? 0),
    firstUsedAt: word.fields.first_used_at || "",
    lastUsedAt: word.fields.last_used_at || word.fields.first_used_at || "",
    reviewDueAt,
    occurrenceCount: wordOccurrences.length,
    correctionCount,
    needsReview
  };
}

function matchesFilter(word: WordListItem, filter: WordFilter) {
  if (filter === "recent") return isWithinDays(word.lastUsedAt, 7);
  if (filter === "review") return word.needsReview;
  if (filter === "corrected") return word.correctionCount > 0;
  return true;
}

function isWithinDays(value: string, days: number) {
  const time = dateValue(value);
  return time > 0 && Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function isPastOrToday(value: string, now: number) {
  const time = dateValue(value);
  return time > 0 && time <= now;
}

function dateValue(value: string | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
