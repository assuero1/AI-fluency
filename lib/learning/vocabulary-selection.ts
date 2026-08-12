import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/teable/client";
import { LearningStateError } from "./access";
import { CorrectionFields, getConversation, MessageFields, WordFields, WordSenseFields, WordUsageSummaryFields } from "./conversations";
import { matchesLearningScope } from "./scope";
import { addSavedWordsToDailyFeedback } from "./feedback";
import { calculateAdaptiveReview, reviewToWordFields } from "./spaced-repetition";
import {
  aggregateSenseReviewToWordFields,
  canonicalSenseKey,
  createWordSense,
  listSensesByWordIds,
  matchesCanonicalSenseKey,
  nextSenseOrderFromList,
  synthesizeLegacySense
} from "./word-senses";
import type { UserFields } from "./profile";

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
  kind: "new_word" | "new_sense_of_existing";
  existingWordId?: string;     // preenchido quando kind === "new_sense_of_existing"
  existingTranslation?: string; // primeiro sentido existente, para o subtítulo do picker
};

export type ExistingVocabularyFamily = {
  id?: string;
  lemma: string;
  displayText: string;
  formsJson?: string;
  senses?: string[]; // traduções dos sentidos já cadastrados (primário primeiro)
};

type VocabularyOccurrence = Omit<VocabularyCandidate, "id" | "occurrenceCount" | "correctOccurrenceCount" | "incorrectOccurrenceCount" | "eligible"> & {
  wasCorrect: boolean;
  occurrenceOrdinal: number;
};

type VocabularyLinguisticData = { lemma: string; translation: string; partOfSpeech: string; isNewSense?: boolean };

// Sentidos já cadastrados das palavras conhecidas, enviados à análise para que
// ela distinga "mesmo significado" de "novo significado" no contexto.
type KnownVocabularyEntry = { lemma: string; senses: string[] };

// Resultado de groupCandidatesByLemma antes da classificação contra o
// vocabulário existente (kind/existingWordId entram só no picker).
type VocabularyCandidateFamily = Omit<VocabularyCandidateGroup, "kind" | "existingWordId" | "existingTranslation">;

const MAX_VOCABULARY_CANDIDATES = 80;
const VOCABULARY_ANALYSIS_CHUNK_SIZE = 20;
const VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE = 5;
const VOCABULARY_ANALYSIS_CACHE_TTL_MS = 10 * 60_000;
const MAX_VOCABULARY_ANALYSIS_CACHE_ENTRIES = 32;

const vocabularySaveLocks = new Map<string, Promise<Awaited<ReturnType<typeof persistSelectedVocabulary>>>>();

type VocabularyAnalysisCacheEntry = {
  expiresAt: number;
  analyses: Record<string, VocabularyLinguisticData>;
};

// Shares one linguistic analysis between the candidates GET and the save POST so
// the lemma saved is exactly the one the user picked. Entries are keyed by
// conversation id plus a stable hash of the analyzed candidate ids; a changed
// conversation produces new ids and therefore a fresh analysis.
const vocabularyAnalysisCache = new Map<string, VocabularyAnalysisCacheEntry>();

export function normalizeVocabularyToken(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// Common function words per language, stored pre-normalized (lowercase, no
// diacritics). Portuguese is the learner's native language and is filtered for
// every target language to kill native-language contamination.
const VOCABULARY_STOPWORDS: Record<string, ReadonlySet<string>> = {
  en: new Set([
    "a", "an", "the", "and", "or", "but", "if", "then", "when", "while", "of", "at", "by", "for", "with", "about",
    "between", "into", "through", "during", "before", "after", "to", "from", "in", "out", "on", "off", "over", "under",
    "again", "once", "here", "there", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "same", "so", "than", "too", "very", "now", "i", "me", "my", "we", "our", "you",
    "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "this", "that", "these", "those",
    "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "would",
    "could", "should", "as", "what", "which", "who", "how", "because", "until", "up", "down"
  ]),
  es: new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas", "al", "de", "del", "en", "a", "ante", "con", "contra",
    "desde", "entre", "hacia", "hasta", "para", "por", "segun", "sin", "sobre", "tras", "y", "o", "ni", "que",
    "porque", "como", "cuando", "donde", "quien", "cual", "cuales", "este", "esta", "esto", "estos", "estas", "ese",
    "esa", "eso", "esos", "esas", "aquel", "aquella", "aquello", "aquellos", "aquellas", "yo", "tu", "ella", "usted",
    "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "lo", "le", "nos", "mi", "mis", "su", "sus", "es",
    "son", "soy", "eres", "somos", "sois", "estoy", "estan", "fue", "fui", "ser", "hay", "habia", "he", "has", "han",
    "hemos", "mas", "muy", "ya", "no", "si", "tambien", "tampoco", "pero", "sino", "aunque", "asi", "ahi", "aqui",
    "alla", "ahora", "hoy", "ayer", "siempre", "nunca", "todo", "toda", "todos", "todas", "algo", "nada", "alguien",
    "nadie", "otro", "otra", "otros", "otras", "mismo", "misma", "cada", "tanto", "tanta", "poco", "poca", "mucho", "mucha"
  ]),
  fr: new Set([
    "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "en", "dans", "sur", "sous", "chez", "pour",
    "par", "avec", "sans", "vers", "entre", "avant", "apres", "pendant", "depuis", "et", "ou", "mais", "donc", "ni",
    "car", "que", "qui", "quoi", "dont", "quand", "comme", "si", "ce", "cet", "cette", "ces", "mon", "ma", "mes",
    "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs", "je", "tu", "il",
    "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se", "lui", "y", "est", "sont", "suis", "es",
    "sommes", "etes", "etait", "etaient", "etre", "avoir", "ai", "as", "avons", "avez", "ont", "avait", "plus",
    "moins", "tres", "bien", "aussi", "trop", "peu", "beaucoup", "ne", "pas", "jamais", "toujours", "souvent",
    "ici", "maintenant", "meme", "tout", "tous", "toute", "toutes", "autre", "autres", "cela", "ca", "alors",
    "deja", "encore"
  ]),
  it: new Set([
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "del", "dello", "della", "dei", "degli", "delle",
    "a", "al", "alla", "ai", "agli", "alle", "da", "dal", "dalla", "in", "nel", "nella", "con", "su", "sul", "per",
    "tra", "fra", "e", "o", "ma", "anche", "se", "che", "chi", "cui", "quale", "questo", "questa", "questi",
    "queste", "quello", "quella", "quelli", "quelle", "io", "tu", "lui", "lei", "noi", "voi", "loro", "mi", "ti",
    "si", "ci", "vi", "ne", "mio", "mia", "tuo", "tua", "suo", "sua", "nostro", "nostra", "vostro", "vostra",
    "sono", "sei", "siamo", "siete", "era", "erano", "essere", "avere", "ho", "hai", "ha", "abbiamo", "avete",
    "hanno", "aveva", "piu", "meno", "molto", "poco", "troppo", "tanto", "tutto", "tutta", "tutti", "tutte", "non",
    "gia", "ancora", "sempre", "mai", "qui", "qua", "ora", "adesso", "oggi", "ieri", "domani", "come", "quando",
    "dove", "perche", "cosi", "cosa", "stesso", "stessa", "ogni", "qualche"
  ]),
  pt: new Set([
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
    "nas", "ao", "aos", "por", "pelo", "pela", "pelos", "pelas", "para", "pra", "com", "sem", "sob", "sobre", "entre", "ate", "apos", "antes",
    "depois", "desde", "contra", "e", "ou", "mas", "nem", "que", "porque", "pois", "como", "quando", "onde",
    "quem", "cujo", "cuja", "este", "esta", "isto", "estes", "estas", "esse", "essa", "isso", "esses", "essas",
    "aquele", "aquela", "aquilo", "eu", "tu", "ele", "ela", "eles", "elas", "voce", "voces", "me", "te", "se",
    "lhe", "meu", "minha", "teu", "tua", "seu", "sua", "nosso", "nossa", "ser", "sou", "es", "somos", "sao",
    "era", "eram", "estar", "estou", "estao", "estava", "ter", "tenho", "tem", "temos", "ha", "mais", "menos",
    "muito", "muita", "pouco", "pouca", "tanto", "tanta", "todo", "toda", "todos", "todas", "outro", "outra",
    "mesmo", "mesma", "ja", "ainda", "sempre", "nunca", "nao", "sim", "tambem", "aqui", "ai", "ali", "la",
    "agora", "hoje", "ontem", "amanha", "assim", "entao", "cada", "algum", "alguma", "nenhum", "nenhuma", "algo",
    "nada", "alguem", "ninguem", "tudo", "bem", "num", "numa", "nuns", "numas"
  ]),
  de: new Set([
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einem", "einen", "und", "oder", "aber",
    "denn", "sondern", "wenn", "als", "dass", "weil", "ob", "obwohl", "wie", "wo", "wer", "was", "wen", "wem",
    "welche", "welcher", "welches", "dieser", "diese", "dieses", "ich", "du", "er", "sie", "es", "wir", "ihr",
    "man", "mich", "dich", "sich", "uns", "euch", "mir", "dir", "ihm", "ihnen", "mein", "meine", "dein", "deine",
    "sein", "seine", "unser", "euer", "in", "im", "am", "an", "auf", "aus", "bei", "mit", "nach", "von", "zu",
    "zur", "zum", "durch", "fur", "gegen", "ohne", "um", "uber", "unter", "vor", "hinter", "neben", "zwischen",
    "seit", "bis", "ist", "sind", "bin", "bist", "seid", "war", "waren", "haben", "habe", "hast", "hat", "hatte",
    "werden", "wird", "wurde", "kann", "konnen", "muss", "mussen", "soll", "sollen", "will", "wollen", "darf",
    "mag", "nicht", "kein", "keine", "auch", "noch", "schon", "nur", "sehr", "mehr", "viel", "viele", "wenig",
    "alle", "alles", "jeder", "jede", "manche", "hier", "da", "dort", "jetzt", "heute", "gestern", "morgen",
    "immer", "nie", "oft", "dann", "so", "ja", "nein", "doch"
  ])
};

const PORTUGUESE_STOPWORDS = VOCABULARY_STOPWORDS.pt;

export function isVocabularyStopword(value: string, language: string) {
  const word = normalizeVocabularyToken(value);
  if (!word) return false;
  if (PORTUGUESE_STOPWORDS.has(word)) return true;
  const code = language.toLowerCase().split(/[-_]/)[0];
  return VOCABULARY_STOPWORDS[code]?.has(word) ?? false;
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
  corrections: TeableRecord<CorrectionFields>[] = [],
  language = ""
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
      if (normalized.length < 2 || isVocabularyStopword(normalized, language)) continue;
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
  corrections: TeableRecord<CorrectionFields>[] = [],
  language = ""
) {
  const candidates = new Map<string, VocabularyCandidate>();
  for (const occurrence of extractVocabularyOccurrences(messages, corrections, language)) {
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
 * Apenas palavras produzidas pelo usuário entram no pipeline de análise e
 * salvamento: sugestões que só apareceram em mensagens da IA não medem
 * domínio do aluno e inflam a análise (mais chunks de LLM, mais gravações).
 */
export function extractUserVocabularyCandidates(
  messages: TeableRecord<MessageFields>[],
  corrections: TeableRecord<CorrectionFields>[] = [],
  language = ""
) {
  return extractVocabularyCandidates(messages, corrections, language).filter((candidate) => candidate.source === "user");
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
  language: string,
  conversationId?: string
) {
  const limited = rankVocabularyCandidates(candidates).slice(0, MAX_VOCABULARY_CANDIDATES);
  const knownVocabulary = existingWords
    .map((word) => ({ lemma: normalizeVocabularyToken(word.lemma || word.displayText), senses: word.senses ?? [] }))
    .filter((entry) => entry.lemma);
  const linguisticData = conversationId
    ? await analyzeConversationVocabulary(conversationId, limited, language, knownVocabulary)
    : await analyzeVocabulary(limited, language, knownVocabulary);
  const families = groupCandidatesByLemma(limited, linguisticData);
  const wordKeySets = existingWords.map((word) => ({
    word,
    keys: new Set([
      normalizeVocabularyToken(word.lemma || word.displayText),
      normalizeVocabularyToken(word.displayText),
      ...parseVocabularyForms(word.formsJson).map(normalizeVocabularyToken)
    ].filter(Boolean))
  }));
  const groups: VocabularyCandidateGroup[] = [];
  for (const family of families) {
    const match = wordKeySets.find(({ keys }) =>
      keys.has(family.lemma) || family.forms.some((form) => keys.has(normalizeVocabularyToken(form)))
    );
    if (!match) {
      groups.push({ ...family, kind: "new_word" });
      continue;
    }
    // Palavra conhecida: só permanece no picker quando a análise marcou um
    // significado distinto dos sentidos cadastrados.
    const isNewSense = family.candidateIds.some((id) => linguisticData[id]?.isNewSense);
    if (!isNewSense) continue;
    const senses = match.word.senses ?? [];
    const translationKey = normalizeVocabularyToken(family.translation);
    // Mesma tradução com redação diferente é falso positivo da IA: se a
    // tradução normalizada já existe como sentido, tratar como known_sense.
    if (translationKey && senses.some((sense) => normalizeVocabularyToken(sense) === translationKey)) continue;
    groups.push({
      ...family,
      kind: "new_sense_of_existing",
      ...(match.word.id ? { existingWordId: match.word.id } : {}),
      ...(senses[0] ? { existingTranslation: senses[0] } : {})
    });
  }
  return groups;
}

export async function getConversationVocabularyGroups(conversationId: string) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (context.conversation.fields.status !== "completed") {
    throw new LearningStateError("Finalize a conversa antes de escolher palavras.", 409);
  }
  const language = context.profile?.fields.language_code ?? "auto";
  const scope = {
    userId: context.conversation.fields.user_id,
    profileId: context.conversation.fields.language_profile_id
  };
  const scopedWords = await getTeableClient().listRecordsWhereAll<WordFields>("words", [
    { field: "user_id", value: scope.userId },
    { field: "language_profile_id", value: scope.profileId }
  ]);
  const sensesByWord = await listSensesByWordIds(scopedWords.map((word) => word.id));
  return groupNewVocabularyCandidates(
    extractUserVocabularyCandidates(context.messages, context.corrections, language),
    scopedWords.map((word) => ({
      id: word.id,
      lemma: word.fields.lemma,
      displayText: word.fields.display_text,
      formsJson: word.fields.forms_json,
      senses: knownSenseTranslations(word, sensesByWord.get(word.id))
    })),
    language,
    conversationId
  );
}

/**
 * Traduções dos sentidos conhecidos da palavra, primário primeiro. Palavras ainda
 * não migradas para word_senses caem no sentido legado sintetizado de
 * words.translation, para que a análise continue com contexto durante a transição.
 */
function knownSenseTranslations(word: TeableRecord<WordFields>, senses: TeableRecord<WordSenseFields>[] | undefined) {
  if (senses?.length) {
    return [...senses]
      .sort((left, right) =>
        Number(Boolean(right.fields.is_primary)) - Number(Boolean(left.fields.is_primary)) ||
        Number(left.fields.sense_order ?? 1) - Number(right.fields.sense_order ?? 1)
      )
      .map((sense) => (sense.fields.translation ?? "").trim())
      .filter(Boolean);
  }
  const legacy = synthesizeLegacySense(word).translation.trim();
  return legacy ? [legacy] : [];
}

function groupCandidatesByLemma(
  candidates: VocabularyCandidate[],
  linguisticData: Record<string, VocabularyLinguisticData>
) {
  const groups = new Map<string, VocabularyCandidateFamily>();
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
  const language = context.profile?.fields.language_code ?? "auto";
  const allOccurrences = extractVocabularyOccurrences(context.messages, context.corrections, language);
  const allowed = new Map(extractUserVocabularyCandidates(context.messages, context.corrections, language).map((item) => [item.id, item]));
  const selected = rankVocabularyCandidates(
    [...new Set(candidateIds)].map((id) => allowed.get(id)).filter((item): item is VocabularyCandidate => Boolean(item))
  ).slice(0, MAX_VOCABULARY_CANDIDATES);
  if (!selected.length) throw new LearningStateError("Selecione ao menos uma palavra.", 400);

  const client = getTeableClient();
  const scope = { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id };
  const scopeFilters = [
    { field: "user_id", value: scope.userId },
    { field: "language_profile_id", value: scope.profileId }
  ];
  const [existingWords, usageSummaries, userRecord] = await Promise.all([
    client.listRecordsWhereAll<WordFields>("words", scopeFilters),
    client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "conversation_id", conversationId),
    client.getRecord<UserFields>("users", scope.userId).catch(() => undefined)
  ]);
  const timeZone = userRecord?.fields.timezone ?? "UTC";
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const scopedWords = existingWords;
  const sensesByWord = await listSensesByWordIds(scopedWords.map((word) => word.id));
  const linguisticData = await analyzeConversationVocabulary(
    conversationId,
    selected,
    language,
    scopedWords
      .map((word) => ({
        lemma: normalizeVocabularyToken(word.fields.lemma || word.fields.display_text),
        senses: knownSenseTranslations(word, sensesByWord.get(word.id))
      }))
      .filter((entry) => entry.lemma)
  );
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
    const familyKeys = new Set([family.lemma, ...family.forms.map(normalizeVocabularyToken)]);
    let word = existingWords.find((item) =>
      matchesLearningScope(item.fields, scope) &&
      (matchesCanonicalVocabularyKey(item.fields.canonical_key, canonicalKey) ||
        familyKeys.has(normalizeVocabularyToken(item.fields.lemma || item.fields.display_text)) ||
        parseVocabularyForms(item.fields.forms_json).some((form) => familyKeys.has(normalizeVocabularyToken(form))))
    );
    let createdWord = false;
    if (!word) {
      // A word without a translation is worse than no word: the Palavras tab
      // would show a permanent placeholder. The candidate stays available in
      // future conversations, when the AI analysis may succeed.
      if (!family.translation) {
        console.error(
          `Skipping new vocabulary word without translation (conversation ${conversationId}): "${family.lemma}" (${familyCandidates.length} candidate(s)).`
        );
        continue;
      }
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
        const refreshed = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
        word = refreshed.find((item) => matchesCanonicalVocabularyKey(item.fields.canonical_key, canonicalKey));
        if (!word) throw error;
      }
    }
    const resolvedWord = word;
    const wordSenses = sensesByWord.get(resolvedWord.id) ?? [];
    const translationBeforeSave = (resolvedWord.fields.translation ?? "").trim();
    const usageKey = wordUsageKey(resolvedWord.id, conversationId);
    const existingUsage = usageSummaries.find((summary) => summary.fields.usage_key === usageKey);
    const previousObservedCount = Number(existingUsage?.fields.observed_count ?? 0);
    const wordSummaries = await client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "word_id", resolvedWord.id);
    const otherUses = wordSummaries
      .filter((summary) => summary.fields.usage_key !== usageKey)
      .reduce((sum, summary) => sum + Number(summary.fields.correct_use_count ?? 0), 0);
    const mergedForms = uniqueVocabularyForms([...parseVocabularyForms(resolvedWord.fields.forms_json), ...forms]);
    const dueTime = resolvedWord.fields.review_due_at ? new Date(resolvedWord.fields.review_due_at).getTime() : 0;
    const implicitReview = correctUseCount > 0 && resolvedWord.fields.review_state === "review" && dueTime > 0 && dueTime <= Date.now()
      ? calculateAdaptiveReview(resolvedWord.fields, [{ rating: "good" }], new Date(now), timeZone, resolvedWord.id)
      : null;
    const wordUpdate: Partial<WordFields> = {
      forms_json: JSON.stringify(mergedForms),
      total_uses: otherUses + correctUseCount,
      last_used_at: correctUseCount > 0 ? now : resolvedWord.fields.last_used_at,
      ...(!resolvedWord.fields.translation && family.translation ? { translation: family.translation } : {}),
      ...(!resolvedWord.fields.part_of_speech && family.partOfSpeech ? { part_of_speech: family.partOfSpeech } : {}),
      ...(implicitReview ? { ...reviewToWordFields(implicitReview), implicit_review_at: now } : {})
    };
    // Captura de sentidos: palavra nova ganha o sentido primário; palavra
    // existente com significado novo ganha um sentido não-primário, sem tocar
    // em words.translation (cache do primário).
    const filledTranslation = !translationBeforeSave && family.translation ? family.translation.trim() : "";
    const senseBase = {
      word_id: resolvedWord.id,
      part_of_speech: family.partOfSpeech,
      example_sentence: relevant[0]?.context ?? "",
      source: "chat" as const,
      review_due_at: reviewDue,
      review_state: "new" as const,
      created_at: now
    };
    let senseToCreate: WordSenseFields | null = null;
    if (createdWord) {
      senseToCreate = {
        ...senseBase,
        sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation),
        translation: family.translation,
        is_primary: true,
        sense_order: 1
      };
    } else if (!wordSenses.length && filledTranslation) {
      // Buraco do backfill: a palavra não tinha sentido nem tradução; a
      // tradução que acabou de preencher words.translation vira o primário.
      senseToCreate = {
        ...senseBase,
        sense_key: canonicalSenseKey(scope.userId, scope.profileId, family.lemma, filledTranslation),
        translation: filledTranslation,
        is_primary: true,
        sense_order: 1
      };
    } else if (family.translation && family.candidateIds.some((id) => linguisticData[id]?.isNewSense)) {
      const senseKey = canonicalSenseKey(scope.userId, scope.profileId, family.lemma, family.translation);
      // Dedupe por sense_key/tradução normalizada: falso positivo da IA vira
      // known_sense mesmo que a análise diga new_sense.
      const alreadyKnown = wordSenses.some((sense) =>
        matchesCanonicalSenseKey(sense.fields.sense_key, senseKey) ||
        normalizeVocabularyToken(sense.fields.translation ?? "") === normalizeVocabularyToken(family.translation)
      );
      if (!alreadyKnown) {
        senseToCreate = {
          ...senseBase,
          sense_key: senseKey,
          translation: family.translation,
          is_primary: false,
          sense_order: nextSenseOrderFromList(wordSenses)
        };
      }
    }
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
    word = await client.updateRecord<WordFields>("words", resolvedWord.id, wordUpdate);
    // Gravações independentes da família em paralelo: o sentido novo e o resumo
    // de uso não dependem um do outro.
    const [createdSense, persisted] = await Promise.all([
      senseToCreate ? createWordSense(senseToCreate) : Promise.resolve(null),
      upsertWordUsageSummary(client, usageSummaries, existingUsage, summaryFields)
    ]);
    if (createdSense) {
      const allSenses = [...wordSenses, createdSense];
      sensesByWord.set(resolvedWord.id, allSenses);
      // O cache da word reflete o agregado dos sentidos (a tradução do
      // primário não muda). Sem sentidos pré-existentes não há o que agregar.
      if (wordSenses.length) {
        await client.updateRecord<WordFields>("words", resolvedWord.id, aggregateSenseReviewToWordFields(allSenses));
      }
    }
    if (!existingUsage) usageSummaries.push(persisted);
    savedCount += Math.max(0, relevant.length - previousObservedCount);
    if (createdWord) newWordCount += 1;
    else updatedWordCount += 1;
  }
  try {
    await addSavedWordsToDailyFeedback(context.conversation, newWordCount);
  } catch (error) {
    console.warn("Words were saved but the daily feedback word count could not be updated.", error);
  }
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
    const refreshed = await client.listRecordsWhere<WordUsageSummaryFields>("wordUsageSummaries", "usage_key", fields.usage_key);
    const concurrent = refreshed.find((summary) => summary.fields.usage_key === fields.usage_key);
    if (!concurrent) throw error;
    return client.updateRecord<WordUsageSummaryFields>("wordUsageSummaries", concurrent.id, fields);
  }
}

/**
 * Legacy rows store canonical_key values built with the previous normalization
 * (which kept diacritics). Both sides are normalized at lookup time so an old
 * "café" key still matches the new "cafe" key instead of duplicating the word.
 */
function matchesCanonicalVocabularyKey(storedKey: string | undefined, canonicalKey: string) {
  if (!storedKey) return false;
  if (storedKey === canonicalKey) return true;
  try {
    const parsed = JSON.parse(storedKey) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return false;
    const [userId, profileId, lemma] = parsed;
    if (typeof userId !== "string" || typeof profileId !== "string" || typeof lemma !== "string") return false;
    return canonicalVocabularyKey(userId, profileId, lemma) === canonicalKey;
  } catch {
    return false;
  }
}

/**
 * Puts learner-produced words first, then orders by frequency, so the
 * candidate cap keeps the words the learner actually used most.
 */
function rankVocabularyCandidates(candidates: VocabularyCandidate[]) {
  return [...candidates].sort((left, right) => {
    if (left.source !== right.source) return left.source === "user" ? -1 : 1;
    return right.occurrenceCount - left.occurrenceCount;
  });
}

async function analyzeConversationVocabulary(
  conversationId: string,
  candidates: VocabularyCandidate[],
  language: string,
  knownVocabulary: KnownVocabularyEntry[] = []
) {
  const cached = readVocabularyAnalysisCache(conversationId);
  const missing = candidates.filter((candidate) => !cached?.analyses[candidate.id]);
  const analyzed = missing.length ? await analyzeVocabulary(missing, language, knownVocabulary) : {};
  const analyses = { ...cached?.analyses, ...analyzed };
  if (Object.keys(analyses).length) writeVocabularyAnalysisCache(conversationId, analyses);
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, analyses[candidate.id] ?? {
    lemma: fallbackVocabularyLemma(candidate.normalized, language),
    translation: "",
    partOfSpeech: ""
  }])) as Record<string, VocabularyLinguisticData>;
}

function readVocabularyAnalysisCache(conversationId: string) {
  const prefix = `${conversationId}:`;
  let freshest: VocabularyAnalysisCacheEntry | undefined;
  for (const [key, entry] of vocabularyAnalysisCache) {
    if (!key.startsWith(prefix)) continue;
    if (entry.expiresAt <= Date.now()) {
      vocabularyAnalysisCache.delete(key);
      continue;
    }
    if (!freshest || entry.expiresAt > freshest.expiresAt) freshest = entry;
  }
  return freshest;
}

function writeVocabularyAnalysisCache(conversationId: string, analyses: Record<string, VocabularyLinguisticData>) {
  const key = `${conversationId}:${stableVocabularyAnalysisHash(Object.keys(analyses))}`;
  for (const [existingKey, entry] of vocabularyAnalysisCache) {
    if (entry.expiresAt <= Date.now() || (existingKey.startsWith(`${conversationId}:`) && existingKey !== key)) {
      vocabularyAnalysisCache.delete(existingKey);
    }
  }
  while (vocabularyAnalysisCache.size >= MAX_VOCABULARY_ANALYSIS_CACHE_ENTRIES) {
    const oldestKey = vocabularyAnalysisCache.keys().next().value;
    if (!oldestKey) break;
    vocabularyAnalysisCache.delete(oldestKey);
  }
  vocabularyAnalysisCache.set(key, { expiresAt: Date.now() + VOCABULARY_ANALYSIS_CACHE_TTL_MS, analyses });
}

function stableVocabularyAnalysisHash(ids: string[]) {
  let hash = 5381;
  const value = [...ids].sort().join("|");
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

async function analyzeVocabulary(candidates: VocabularyCandidate[], language: string, knownVocabulary: KnownVocabularyEntry[] = []) {
  const merged = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    lemma: fallbackVocabularyLemma(candidate.normalized, language),
    translation: "",
    partOfSpeech: ""
  }])) as Record<string, VocabularyLinguisticData>;
  // Batching keeps each response small enough to avoid the truncated JSON that
  // used to push every candidate silently onto the fallback lemma. Chunks run
  // sequentially to stay clear of provider rate limits.
  for (let index = 0; index < candidates.length; index += VOCABULARY_ANALYSIS_CHUNK_SIZE) {
    const chunk = candidates.slice(index, index + VOCABULARY_ANALYSIS_CHUNK_SIZE);
    Object.assign(merged, await analyzeVocabularyChunk(chunk, language, knownVocabulary));
  }
  await translateMissingTranslations(merged, candidates, language);
  return merged;
}

async function analyzeVocabularyChunk(chunk: VocabularyCandidate[], language: string, knownVocabulary: KnownVocabularyEntry[] = []) {
  // Só os sentidos das palavras conhecidas presentes no chunk entram no
  // prompt, para mantê-lo pequeno mesmo com vocabulários grandes.
  const relevantKnown = knownVocabulary.filter((entry) =>
    chunk.some((candidate) =>
      candidate.normalized === entry.lemma || fallbackVocabularyLemma(candidate.normalized, language) === entry.lemma
    )
  );
  let content: string;
  try {
    const response = await createChatCompletion([
      {
        role: "system",
        content: "Analise vocabulário no idioma informado. Para cada item, se o lemma consta em 'Palavras conhecidas', compare o significado no contexto com os sentidos cadastrados: se for um significado diferente, responda sense_status=new_sense e traduza o NOVO significado; se for o mesmo, sense_status=known_sense. Responda somente JSON válido: array de {id, lemma, translation, part_of_speech, sense_status}. Preserve cada id exatamente, agrupe flexões usando o mesmo lemma canônico de dicionário, traduza brevemente para português brasileiro e informe a classe gramatical no idioma alvo."
      },
      {
        role: "user",
        content: `Idioma: ${language}\nPalavras conhecidas: ${JSON.stringify(relevantKnown)}\nItens: ${JSON.stringify(chunk.map((candidate) => ({ id: candidate.id, text: candidate.text, context: candidate.context })))}`
      }
    ], { temperature: 0, maxTokens: 2_000, timeoutMs: 15_000 });
    content = response.content;
  } catch (error) {
    console.error(`Vocabulary analysis failed for ${chunk.length} candidate(s) in ${language}; keeping fallback lemmas.`, error);
    return {} as Record<string, VocabularyLinguisticData>;
  }
  try {
    const match = content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]") as unknown;
    if (!Array.isArray(parsed)) throw new Error("Vocabulary analysis did not return a JSON array.");
    const result: Record<string, VocabularyLinguisticData> = {};
    const allowedIds = new Set(chunk.map((candidate) => candidate.id));
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || !allowedIds.has(item.id) || typeof item.lemma !== "string") continue;
      const lemma = normalizeVocabularyToken(item.lemma);
      if (!lemma) continue;
      // sense_status ausente/malformado → comportamento legado (sem isNewSense).
      const senseStatus = typeof item.sense_status === "string" ? item.sense_status.trim() : "";
      result[item.id] = {
        lemma,
        translation: typeof item.translation === "string" ? item.translation.trim() : "",
        partOfSpeech: typeof item.part_of_speech === "string" ? item.part_of_speech.trim() : "",
        ...(senseStatus === "new_sense" ? { isNewSense: true } : senseStatus === "known_sense" ? { isNewSense: false } : {})
      };
    }
    return result;
  } catch (error) {
    console.error(`Vocabulary analysis response could not be parsed for ${chunk.length} candidate(s) in ${language}; keeping fallback lemmas.`, error);
    return {} as Record<string, VocabularyLinguisticData>;
  }
}

/**
 * Second chance for candidates whose chunked analysis came back without a
 * translation (timeout, truncated JSON, etc.). Small batches with a simpler
 * prompt keep the failure blast radius per-word instead of per-chunk. Words
 * that stay untranslated after this pass are handled by the caller (new words
 * are not persisted without a translation).
 */
async function translateMissingTranslations(
  analyses: Record<string, VocabularyLinguisticData>,
  candidates: VocabularyCandidate[],
  language: string
) {
  const missing = candidates.filter((candidate) => !analyses[candidate.id]?.translation);
  // A down provider will not recover mid-loop, so stop after 2 consecutive
  // batch failures instead of spinning through every remaining batch.
  let consecutiveFailures = 0;
  for (let index = 0; index < missing.length; index += VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE) {
    const batch = missing.slice(index, index + VOCABULARY_TRANSLATION_FALLBACK_CHUNK_SIZE);
    let content: string;
    try {
      const response = await createChatCompletion([
        {
          role: "system",
          content: "Traduza cada item para português brasileiro. Responda somente JSON válido: um array com objetos {id, translation}. Preserve cada id exatamente."
        },
        { role: "user", content: `Idioma: ${language}\nItens: ${JSON.stringify(batch.map((candidate) => ({ id: candidate.id, text: candidate.text, context: candidate.context })))}` }
      ], { temperature: 0, maxTokens: 800, timeoutMs: 15_000 });
      content = response.content;
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`Translation fallback failed for ${batch.length} candidate(s) in ${language}.`, error);
      if (consecutiveFailures >= 2) {
        console.error(`Aborting remaining translation fallback batches in ${language} after consecutive failures.`);
        break;
      }
      continue;
    }
    const allowedIds = new Set(batch.map((candidate) => candidate.id));
    for (const [id, translation] of Object.entries(parseTranslationItems(content, allowedIds))) {
      const analysis = analyses[id];
      if (analysis && !analysis.translation) analysis.translation = translation;
    }
  }
}

function parseTranslationItems(content: string, allowedIds: Set<string>) {
  const result: Record<string, string> = {};
  try {
    const match = content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match?.[0] ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return result;
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || !allowedIds.has(item.id)) continue;
      const translation = typeof item.translation === "string" ? item.translation.trim() : "";
      if (translation) result[item.id] = translation;
    }
  } catch (error) {
    console.error("Translation fallback response could not be parsed.", error);
  }
  return result;
}

const IRREGULAR_LEMMAS = normalizeIrregularLemmas({
  en: { went: "go", gone: "go", was: "be", were: "be", been: "be", did: "do", done: "do", had: "have", made: "make" },
  pt: {
    fui: "ir", foi: "ir", fomos: "ir", foram: "ir", vou: "ir", vai: "ir", vamos: "ir", vão: "ir",
    sou: "ser", somos: "ser", são: "ser", era: "ser", eram: "ser",
    tive: "ter", teve: "ter", tivemos: "ter", tiveram: "ter"
  },
  es: { fui: "ir", fue: "ir", fuimos: "ir", fueron: "ir", voy: "ir", va: "ir", vamos: "ir", van: "ir" },
  fr: { étais: "être", était: "être", étions: "être", étaient: "être" },
  it: { sono: "essere", era: "essere", erano: "essere", siamo: "essere" }
});

// Keys and lemmas are stored normalized so lookups stay diacritic-insensitive.
function normalizeIrregularLemmas(value: Record<string, Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(value).map(([code, forms]) => [
      code,
      Object.fromEntries(Object.entries(forms).map(([form, lemma]) => [normalizeVocabularyToken(form), normalizeVocabularyToken(lemma)]))
    ])
  );
}

export function fallbackVocabularyLemma(value: string, language: string) {
  const word = normalizeVocabularyToken(value);
  const code = language.toLowerCase().split(/[-_]/)[0];
  if (IRREGULAR_LEMMAS[code]?.[word]) return IRREGULAR_LEMMAS[code][word];
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
