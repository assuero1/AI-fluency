import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/supabase/client";
import { LearningStateError } from "./access";
import { WordFields, WordSenseFields } from "./conversations";
import { getActiveLanguageProfile, getSessionUser } from "./profile";
import { canonicalVocabularyKey } from "./vocabulary-selection";
import { canonicalSenseKey, createWordSense, nextSenseOrderFromList, updateWordSense } from "./word-senses";
import { type FlashcardAttemptFields, type FlashcardFields, type PracticeSessionFields } from "./flashcards";
import {
  normalizeNewWordsSessionSize,
  SENTENCES_PER_WORD,
  type NewWordPreview,
  type NewWordsSentence
} from "./new-words-contracts";
import { validateGeneratedSentences, validateProposedWords, type ExistingBankWord, type GeneratedSentence } from "./new-words-validation";

export type { FlashcardFields, PracticeSessionFields };

const SESSION_TYPE = "new_words";
const MAX_KNOWN_VOCABULARY_IN_PROMPT = 150;

// ---------- Seleção das palavras novas ----------

export async function generateNewWordProposals(
  knownWords: Array<{ lemma: string; translation: string }>,
  bankWords: ExistingBankWord[],
  count: number,
  language: string,
  level: string
) {
  const request = () => createChatCompletion([
    { role: "system", content: `Você é um professor de ${language}. Escolha ${count} palavras NOVAS, úteis e concretas, adequadas ao nível informado, que o aluno ainda não conhece (a lista abaixo é o vocabulário dele). Cada palavra deve ser um lemma no idioma alvo, com tradução em português brasileiro e classe gramatical. Prefira palavras do dia a dia que combinem com o vocabulário que o aluno já tem. Responda somente JSON válido: {"words":[{"lemma":"...","translation":"...","part_of_speech":"noun|verb|adjective|adverb|phrase"}]}.` },
    { role: "user", content: `Idioma: ${language}\nNível: ${level}\nVocabulário atual do aluno: ${JSON.stringify(knownWords)}` }
  ], { temperature: 0.6, maxTokens: 700, timeoutMs: 15_000, responseFormat: "json", disableThinking: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await request();
      const parsed = parseJsonObject(ai.content) as { words?: unknown };
      // A validação contra o banco é determinística: a IA pode propor palavra
      // que o aluno já tem; o filtro descarta e devolve só as inéditas.
      const words = validateProposedWords(parsed.words, bankWords, count);
      if (words.length) return words;
    } catch { /* tenta de novo e depois falha */ }
  }
  throw new LearningStateError("Não foi possível escolher palavras novas agora. Tente novamente em instantes.", 502);
}

// ---------- Geração das frases ----------

export async function generateNewWordSentences(newWords: Array<{ id: string; lemma: string }>, knownLemmas: string[], language: string, level: string) {
  const request = () => createChatCompletion([
    { role: "system", content: `Crie frases curtas de treino de tradução em ${language}, adequadas ao nível informado. Para cada palavra nova, crie exatamente ${SENTENCES_PER_WORD} frases. Regras: cada frase tem de 2 a 6 palavras; usa a palavra nova exatamente uma vez, como fornecida; usa SOMENTE palavras da lista de vocabulário conhecido do aluno, a própria palavra nova e palavras gramaticais muito comuns (artigos, preposições, pronomes, auxiliares); sentido claro e não ambíguo. Responda somente JSON válido: {"sentences":[{"text":"...","translation":"...","word":"lemma-da-palavra-nova"}]}, com translation em português brasileiro.` },
    { role: "user", content: `Nível: ${level}\nPalavras novas: ${JSON.stringify(newWords.map((word) => word.lemma))}\nVocabulário conhecido: ${JSON.stringify(knownLemmas.slice(0, MAX_KNOWN_VOCABULARY_IN_PROMPT))}` }
  ], { temperature: 0.5, maxTokens: 1600, timeoutMs: 20_000, responseFormat: "json", disableThinking: true });
  const emptyResult: ReturnType<typeof validateGeneratedSentences> = {
    sentencesByWord: new Map<string, GeneratedSentence[]>(),
    droppedWordIds: newWords.map((word) => word.id),
    rejectionReasons: {}
  };
  let last = emptyResult;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await request();
      const parsed = parseJsonObject(ai.content) as { sentences?: unknown };
      const validated = validateGeneratedSentences(parsed.sentences, newWords, knownLemmas);
      last = validated;
      if (validated.droppedWordIds.length < newWords.length) return validated;
    } catch { /* tenta de novo e depois devolve o último resultado */ }
  }
  return last;
}

// ---------- Criação da sessão ----------

export async function createNewWordsPractice(input: { count?: unknown }) {
  const count = normalizeNewWordsSessionSize(input.count);
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Configure um idioma antes de iniciar a sessão.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const [allWords, sessions] = await Promise.all([
    client.listRecordsWhereAll<WordFields>("words", scopeFilters),
    client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters)
  ]);
  const active = sessions.find((session) => session.fields.type === SESSION_TYPE && (session.fields.status === "active" || session.fields.status === "preparing"));
  if (active) throw new LearningStateError("Você já possui uma sessão de palavras novas em andamento. Continue-a antes de iniciar outra.", 409);

  const language = profile.fields.language_name || profile.fields.language_code || "Inglês";
  const level = profile.fields.level || "intermediário";
  const bankWords: ExistingBankWord[] = allWords.map((word) => ({
    lemma: word.fields.lemma || "",
    displayText: word.fields.display_text || "",
    formsJson: word.fields.forms_json
  }));
  // Lemma + tradução ajudam a IA a escolher palavras que combinem com o repertório.
  const knownWordsForPrompt = allWords
    .map((word) => ({ lemma: word.fields.display_text || word.fields.lemma || "", translation: word.fields.translation || "" }))
    .filter((word) => word.lemma);

  // 1. IA propõe as palavras novas (validadas deterministicamente contra o banco).
  const proposals = await generateNewWordProposals(knownWordsForPrompt, bankWords, count, language, level);

  // 2. Persiste as palavras + sentido primário (idempotente por canonical_key/sense_key).
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  const created: NewWordPreview[] = [];
  for (const proposal of proposals) {
    const canonicalKey = canonicalVocabularyKey(user.id, profile.id, proposal.lemma);
    let word: TeableRecord<WordFields> | undefined = allWords.find((item) => item.fields.canonical_key === canonicalKey);
    if (!word) {
      try {
        word = await client.createRecord<WordFields>("words", {
          Name: proposal.lemma,
          user_id: user.id,
          language_profile_id: profile.id,
          lemma: proposal.lemma,
          canonical_key: canonicalKey,
          display_text: proposal.lemma,
          forms_json: "[]",
          translation: proposal.translation,
          part_of_speech: proposal.partOfSpeech,
          familiarity_score: 1,
          total_uses: 0,
          last_used_at: now,
          first_used_at: now,
          review_due_at: reviewDue
        });
        allWords.push(word);
      } catch (error) {
        if (!(error instanceof TeableRequestError) || ![400, 409, 422].includes(error.status)) throw error;
        const refreshed = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
        word = refreshed.find((item) => item.fields.canonical_key === canonicalKey);
        if (!word) throw error;
      }
    }
    const existingSenses = (await listSenses(client, word.id));
    let sense = existingSenses.find((item) => item.fields.sense_key === canonicalSenseKey(user.id, profile.id, proposal.lemma, proposal.translation));
    if (!sense) {
      sense = await createWordSense({
        Name: proposal.lemma,
        user_id: user.id,
        word_id: word.id,
        sense_key: canonicalSenseKey(user.id, profile.id, proposal.lemma, proposal.translation),
        translation: proposal.translation,
        part_of_speech: proposal.partOfSpeech || undefined,
        source: "session",
        is_primary: true,
        sense_order: nextSenseOrderFromList(existingSenses),
        total_uses: 0,
        review_due_at: reviewDue,
        review_state: "new",
        created_at: now
      });
    }
    created.push({ wordId: word.id, senseId: sense.id, lemma: proposal.lemma, translation: proposal.translation, partOfSpeech: proposal.partOfSpeech });
  }

  // 3. IA gera as frases (validadas); palavras sem frase nenhuma saem da sessão.
  const knownLemmas = knownWordsForPrompt.map((word) => word.lemma);
  const generation = await generateNewWordSentences(created.map((word) => ({ id: word.wordId, lemma: word.lemma })), knownLemmas, language, level);
  const usable = created.filter((word) => generation.sentencesByWord.get(word.wordId)?.length);
  if (!usable.length) throw new LearningStateError("Não foi possível montar as frases agora. Tente novamente em instantes.", 502);

  // 4. Sessão preparing → cards → active (mesmo ciclo dos flashcards).
  const session = await client.createRecord<PracticeSessionFields>("practiceSessions", {
    Name: `Palavras novas · ${now.slice(0, 10)}`,
    user_id: user.id,
    language_profile_id: profile.id,
    conversation_id: "",
    type: SESSION_TYPE,
    focus: JSON.stringify({ count, wordIds: usable.map((word) => word.wordId) }),
    status: "preparing",
    started_at: now,
    ended_at: "",
    duration_seconds: 0,
    requested_word_count: count,
    selected_word_count: usable.length,
    unique_card_count: 0,
    presentation_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    score: 0,
    language_code: profile.fields.language_code,
    configuration_json: "{}",
    created_at: now,
    updated_at: now
  });

  const sentences: NewWordsSentence[] = [];
  let position = 0;
  for (const word of usable) {
    for (const generated of generation.sentencesByWord.get(word.wordId) ?? []) {
      const record = await client.createRecord<FlashcardFields>("flashcards", {
        user_id: user.id,
        practice_session_id: session.id,
        target_word_id: word.wordId,
        target_sense_id: word.senseId,
        supporting_word_ids: "[]",
        card_type: "translation",
        prompt: generated.text,
        expected_answer: generated.translation,
        accepted_answers: "[]",
        translation: generated.translation,
        explanation: "",
        sentence: generated.text,
        audio_text: generated.text,
        difficulty: 1,
        initial_position: position,
        generation_source: "ai",
        created_at: now
      });
      sentences.push({
        id: record.id,
        sessionId: session.id,
        targetWordId: word.wordId,
        targetSenseId: word.senseId,
        sentence: generated.text,
        translation: generated.translation,
        audioText: generated.text,
        position
      });
      position += 1;
    }
  }

  // Exemplo da primeira frase vira exemplo do sentido primário.
  for (const word of usable) {
    const first = sentences.find((sentence) => sentence.targetWordId === word.wordId);
    if (first) await updateWordSense(word.senseId, { example_sentence: first.sentence }).catch(() => undefined);
  }

  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    status: "active",
    unique_card_count: sentences.length,
    updated_at: new Date().toISOString()
  });
  await client.createEvent(user.id, "new_words_session_started", {
    session_id: session.id,
    requested_count: count,
    word_count: usable.length,
    sentence_count: sentences.length,
    dropped_word_ids: generation.droppedWordIds,
    rejection_reasons: generation.rejectionReasons
  });

  return { sessionId: session.id, sentences, words: usable, languageCode: profile.fields.language_code, languageName: profile.fields.language_name };
}

// ---------- Retomada ----------

export async function getActiveNewWordsPractice() {
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  const session = sessions
    .filter((item) => item.fields.type === SESSION_TYPE && item.fields.status === "active")
    .sort((a, b) => dateValue(b.fields.started_at || b.fields.created_at) - dateValue(a.fields.started_at || a.fields.created_at))[0];
  if (!session) return null;
  const [sentences, attempts] = await Promise.all([
    listSentences(client, user.id, session.id),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "practice_session_id", session.id)
  ]);
  const answeredIds = new Set(attempts.filter((attempt) => !attempt.fields.undone_at).map((attempt) => attempt.fields.flashcard_id));
  const next = sentences.find((sentence) => !answeredIds.has(sentence.id));
  await client.createEvent(user.id, "new_words_session_resumed", { session_id: session.id, answered_count: answeredIds.size });
  return {
    sessionId: session.id,
    sentences,
    answeredCount: answeredIds.size,
    answeredSentenceIds: [...answeredIds],
    nextSentenceId: next?.id ?? "",
    languageCode: session.fields.language_code || profile.fields.language_code,
    languageName: profile.fields.language_name,
    words: await sessionWordPreviews(client, user.id, profile.id, session)
  };
}

export async function abandonNewWordsPractice(sessionId: string) {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão.", 422);
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && (item.fields.status === "active" || item.fields.status === "preparing"));
  if (!session) throw new LearningStateError("Sessão ativa não encontrada.", 404);
  const endedAt = new Date();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    status: "abandoned",
    ended_at: endedAt.toISOString(),
    duration_seconds: Math.max(0, Math.round((endedAt.getTime() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000)),
    updated_at: endedAt.toISOString()
  });
  await client.createEvent(user.id, "new_words_session_abandoned", { session_id: session.id });
  return { sessionId: session.id, status: "abandoned" as const };
}

// ---------- helpers ----------

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) as Record<string, unknown> : {}; } catch { return {}; }
}

function dateValue(value: string | undefined) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }

function listSenses(client: ReturnType<typeof getTeableClient>, wordId: string) {
  return client.listRecordsWhere<WordSenseFields>("wordSenses", "word_id", wordId);
}

function listSentences(client: ReturnType<typeof getTeableClient>, userId: string, sessionId: string): Promise<NewWordsSentence[]> {
  return client.listRecordsWhere<FlashcardFields>("flashcards", "practice_session_id", sessionId).then((records) =>
    records
      .filter((record) => record.fields.user_id === userId && record.fields.card_type === "translation")
      .sort((a, b) => a.fields.initial_position - b.fields.initial_position)
      .map((record) => ({
        id: record.id,
        sessionId,
        targetWordId: record.fields.target_word_id,
        targetSenseId: record.fields.target_sense_id || "",
        sentence: record.fields.sentence || record.fields.prompt,
        translation: record.fields.translation || record.fields.expected_answer,
        audioText: record.fields.audio_text || record.fields.sentence || record.fields.prompt,
        position: record.fields.initial_position
      }))
  );
}

async function sessionWordPreviews(client: ReturnType<typeof getTeableClient>, userId: string, profileId: string, session: TeableRecord<PracticeSessionFields>): Promise<NewWordPreview[]> {
  const focus = parseJsonObject(session.fields.focus ?? "{}") as { wordIds?: unknown };
  const wordIds = Array.isArray(focus.wordIds) ? focus.wordIds.filter((id): id is string => typeof id === "string") : [];
  if (!wordIds.length) return [];
  const words = await client.listRecordsWhereAll<WordFields>("words", [
    { field: "user_id", value: userId },
    { field: "language_profile_id", value: profileId }
  ]);
  const previews: NewWordPreview[] = [];
  for (const wordId of wordIds) {
    const word = words.find((item) => item.id === wordId);
    if (!word) continue;
    const senses = await listSenses(client, wordId);
    const primary = senses.find((item) => item.fields.is_primary) ?? senses[0];
    previews.push({
      wordId,
      senseId: primary?.id ?? "",
      lemma: word.fields.display_text || word.fields.lemma,
      translation: primary?.fields.translation || word.fields.translation || "",
      partOfSpeech: word.fields.part_of_speech || ""
    });
  }
  return previews;
}
