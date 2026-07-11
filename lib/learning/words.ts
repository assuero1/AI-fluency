import { startConversation } from "./conversations";
import type { WordFields, WordUsageSummaryFields } from "./conversations";
import { getActiveLanguageProfile, getOrCreatePersonalUser } from "./profile";
import { createTopic } from "./topics";
import { matchesLearningScope } from "./scope";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";

export const wordFilters = ["all", "recent", "review", "corrected"] as const;
export type WordFilter = (typeof wordFilters)[number];

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
  reviewIntervalDays: number;
  reviewEase: number;
  reviewStreak: number;
  lapseCount: number;
  lastReviewedAt: string;
  lastRating: "forgot" | "hard" | "good" | "easy" | "";
  averageResponseTimeMs: number;
  reviewState: "new" | "learning" | "review" | "difficult" | "suspended";
  reviewVersion: string;
  occurrenceCount: number;
  correctionCount: number;
  needsReview: boolean;
  correctUses: number;
  conversationCount: number;
  strengthScore: number;
  strengthLevel: WordStrengthLevel;
};

export type WordStrengthLevel = "new" | "learning" | "consolidating" | "strong";

export const wordStrengthLabels: Record<WordStrengthLevel, string> = {
  new: "Nova",
  learning: "Em aprendizado",
  consolidating: "Em consolidação",
  strong: "Forte"
};

export function calculateWordStrength(input: {
  correctUses: number;
  conversationCount: number;
  lastUsedAt: string;
  reviewStreak: number;
  lapseCount: number;
  lastRating: WordListItem["lastRating"];
  correctionCount: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const daysSinceUse = Math.max(0, Math.floor((now - dateValue(input.lastUsedAt)) / 86_400_000));
  const recencyPoints = !dateValue(input.lastUsedAt) ? 0 : daysSinceUse <= 7 ? 15 : daysSinceUse <= 30 ? 10 : daysSinceUse <= 90 ? 4 : 0;
  const ratingPoints = input.lastRating === "easy" ? 5 : input.lastRating === "good" ? 3 : input.lastRating === "forgot" ? -6 : 0;
  const score = Math.max(0, Math.min(100,
    Math.min(40, input.correctUses * 8) +
    Math.min(25, input.conversationCount * 8) +
    recencyPoints +
    Math.min(15, input.reviewStreak * 3) +
    ratingPoints -
    Math.min(20, input.lapseCount * 5) -
    Math.min(15, input.correctionCount * 3)
  ));
  const level: WordStrengthLevel = score >= 65 && input.correctUses >= 5 && input.conversationCount >= 2 && input.lastRating !== "forgot"
    ? "strong"
    : score >= 35 && input.correctUses >= 3
      ? "consolidating"
      : input.correctUses > 0 || input.reviewStreak > 0
        ? "learning"
        : "new";
  return { score, level };
}

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
  const now = Date.now();
  const mapped = scoped.map((word) => toWordListItem(word, records.usageSummaries, now));
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
      correctedWords: mapped.filter((word) => word.correctionCount > 0).length,
      newWords: mapped.filter((word) => word.reviewState === "new").length,
      learningWords: mapped.filter((word) => word.reviewState === "learning").length,
      reviewWords: mapped.filter((word) => word.reviewState === "review").length,
      difficultWords: mapped.filter((word) => word.reviewState === "difficult").length,
      strongWords: mapped.filter((word) => word.strengthLevel === "strong").length
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

  return {
    languageCode: scope.languageCode,
    word: toWordListItem(word, records.usageSummaries, Date.now())
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
  const [words, usageSummaries] = await Promise.all([
    client.listAllRecords<WordFields>("words"),
    client.listAllRecords<WordUsageSummaryFields>("wordUsageSummaries")
  ]);
  return { words, usageSummaries };
}

function matchesScope(word: TeableRecord<WordFields>, scope: WordScope) {
  return matchesLearningScope(word.fields, scope);
}

function toWordListItem(
  word: TeableRecord<WordFields>,
  usageSummaries: TeableRecord<WordUsageSummaryFields>[],
  now: number
): WordListItem {
  const wordUsageSummaries = usageSummaries.filter((summary) => summary.fields.word_id === word.id);
  const correctionCount = wordUsageSummaries.reduce((sum, summary) => sum + Number(summary.fields.correction_count ?? 0), 0);
  const reviewDueAt = word.fields.review_due_at || "";
  const aggregatedUses = wordUsageSummaries.reduce((sum, summary) => sum + Number(summary.fields.correct_use_count ?? 0), 0);
  const correctUses = Math.max(aggregatedUses, Number(word.fields.total_uses ?? 0));
  const conversationCount = wordUsageSummaries.filter((summary) => Number(summary.fields.correct_use_count ?? 0) > 0).length;
  const occurrenceCount = wordUsageSummaries.reduce((sum, summary) => sum + Number(summary.fields.observed_count ?? 0), 0);
  const needsReview = (isPastOrToday(reviewDueAt, now) || correctionCount > 0) && occurrenceCount > 0;
  const strength = calculateWordStrength({
    correctUses,
    conversationCount,
    lastUsedAt: word.fields.last_used_at || word.fields.first_used_at || "",
    reviewStreak: Number(word.fields.review_streak ?? 0),
    lapseCount: Number(word.fields.lapse_count ?? 0),
    lastRating: word.fields.last_rating ?? "",
    correctionCount,
    now
  });

  return {
    id: word.id,
    displayText: word.fields.display_text || word.fields.lemma || "Palavra sem nome",
    lemma: word.fields.lemma || word.fields.display_text || "",
    translation: word.fields.translation || "Tradução a adicionar",
    partOfSpeech: word.fields.part_of_speech || "",
    totalUses: Number(word.fields.total_uses ?? aggregatedUses),
    familiarityScore: Number(word.fields.familiarity_score ?? 0),
    firstUsedAt: word.fields.first_used_at || "",
    lastUsedAt: word.fields.last_used_at || word.fields.first_used_at || "",
    reviewDueAt,
    reviewIntervalDays: Number(word.fields.review_interval_days ?? 0),
    reviewEase: Number(word.fields.review_ease ?? 0),
    reviewStreak: Number(word.fields.review_streak ?? 0),
    lapseCount: Number(word.fields.lapse_count ?? 0),
    lastReviewedAt: word.fields.last_reviewed_at || "",
    lastRating: word.fields.last_rating ?? "",
    averageResponseTimeMs: Number(word.fields.average_response_time_ms ?? 0),
    reviewState: word.fields.review_state ?? "new",
    reviewVersion: word.fields.review_version ?? "",
    occurrenceCount,
    correctionCount,
    needsReview,
    correctUses,
    conversationCount,
    strengthScore: strength.score,
    strengthLevel: strength.level
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
