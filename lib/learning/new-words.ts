import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { warmCachedSpeech } from "@/lib/kokoro/cache";
import { getTeableClient, TeableRecord, TeableRequestError } from "@/lib/supabase/client";
import { LearningStateError } from "./access";
import { WordFields, WordSenseFields } from "./conversations";
import { addLearnedWordsToDailyFeedback, toDateKey } from "./feedback";
import { getActiveLanguageProfile, getSessionUser } from "./profile";
import { canonicalVocabularyKey, normalizeVocabularyToken } from "./vocabulary-selection";
import { canonicalSenseKey, createWordSense, listSensesByWordIds, matchesCanonicalSenseKey, nextSenseOrderFromList, updateWordSense } from "./word-senses";
import { applyReviewToSense as applySenseReview, type FlashcardAttemptFields, type FlashcardFields, type PracticeSessionFields } from "./flashcards";
import { compareFlashcardAnswer, normalizeFlashcardAnswer } from "./flashcard-answer";
import { inferRecallRating } from "./flashcard-queue";
import {
  normalizeNewWordsSessionSize,
  SENTENCES_PER_WORD,
  type ActiveNewWordsPractice,
  type JudgedTranslation,
  type NewWordPreview,
  type NewWordsAttemptResult,
  type NewWordsSentence,
  type NewWordsSessionResult
} from "./new-words-contracts";
import { fallbackJudgment, mapVerdictToMatch, sanitizeJudgment, validateGeneratedSentences, validateProposedWords, type ExistingBankWord, type GeneratedSentence } from "./new-words-validation";

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

const SENTENCE_TOKENS = 90;

/** Gera frases em até 2 rodadas; a 2ª completa as palavras que ficaram com menos de SENTENCES_PER_WORD frases (zeradas ou parciais). */
export async function generateSentencesForWords(newWords: Array<{ id: string; lemma: string }>, knownLemmas: string[], language: string, level: string) {
  const buildCall = (targets: Array<{ id: string; lemma: string; faltam: number }>, pedeFaltantes: boolean) => createChatCompletion([
    { role: "system", content: `Crie frases curtas de treino de tradução em ${language}, adequadas ao nível informado. ${pedeFaltantes ? "Crie para cada palavra exatamente o número de frases indicado — nenhuma palavra pode ficar sem frases." : `Para CADA palavra da lista, crie exatamente ${SENTENCES_PER_WORD} frases — nenhuma palavra pode ficar sem frases.`} Regras: cada frase tem de 2 a 6 palavras; usa a palavra-alvo exatamente uma vez, como fornecida; usa SOMENTE palavras da lista de vocabulário conhecido do aluno, a própria palavra-alvo e palavras gramaticais muito comuns (artigos, preposições, pronomes, auxiliares); sentido claro e não ambíguo. Responda somente JSON válido: {"sentences":[{"text":"...","translation":"...","word":"lemma-da-palavra-alvo"}]}, com translation em português brasileiro.` },
    { role: "user", content: `Nível: ${level}\n${pedeFaltantes ? `Palavras-alvo (com quantas frases faltam): ${JSON.stringify(targets.map((word) => ({ lemma: word.lemma, faltam: word.faltam })))}` : `Palavras-alvo: ${JSON.stringify(targets.map((word) => word.lemma))}`}\nVocabulário conhecido: ${JSON.stringify(knownLemmas.slice(0, MAX_KNOWN_VOCABULARY_IN_PROMPT))}` }
  ], {
    temperature: 0.5,
    // Proporcional ao volume, com piso de 1600 (pedidos pequenos não podem
    // truncar menos do que truncavam antes) e teto de 6000.
    maxTokens: Math.min(6000, Math.max(1600, 400 + targets.length * SENTENCES_PER_WORD * SENTENCE_TOKENS)),
    timeoutMs: 25_000,
    responseFormat: "json",
    disableThinking: true
  });

  const combined = { sentencesByWord: new Map<string, GeneratedSentence[]>(), droppedWordIds: [] as string[], rejectionReasons: {} as Record<string, number> };
  const missingCount = (wordId: string) => SENTENCES_PER_WORD - (combined.sentencesByWord.get(wordId)?.length ?? 0);
  let pending = newWords;
  for (let round = 0; round < 2 && pending.length; round += 1) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await buildCall(pending.map((word) => ({ ...word, faltam: missingCount(word.id) })), round > 0);
      const parsed = parseJsonObject(ai.content) as { sentences?: unknown };
      const validated = validateGeneratedSentences(parsed.sentences, pending, knownLemmas);
      for (const [reason, count] of Object.entries(validated.rejectionReasons)) {
        combined.rejectionReasons[reason] = (combined.rejectionReasons[reason] ?? 0) + count;
      }
      // Merge com teto por palavra: soma o que a palavra já tinha com as frases
      // novas (descartando textos repetidos de rodadas anteriores) e corta no teto.
      for (const word of pending) {
        const existing = combined.sentencesByWord.get(word.id) ?? [];
        const knownTexts = new Set(existing.map((sentence) => sentence.text.trim().toLowerCase()));
        const fresh = (validated.sentencesByWord.get(word.id) ?? []).filter((sentence) => !knownTexts.has(sentence.text.trim().toLowerCase()));
        combined.sentencesByWord.set(word.id, [...existing, ...fresh].slice(0, SENTENCES_PER_WORD));
      }
    } catch { /* rodada falhou: segue para a próxima ou devolve o que tem */ }
    // Pendente = palavra com menos frases que o teto (zerada OU parcial).
    pending = newWords.filter((word) => missingCount(word.id) > 0);
  }
  // Dropped segue como palavras que ficaram com ZERO frases após todas as rodadas.
  combined.droppedWordIds = newWords.filter((word) => !combined.sentencesByWord.get(word.id)?.length).map((word) => word.id);
  return combined;
}

// ---------- Criação da sessão ----------

// Preparing mais velho que isso é zumbi: a geração em background morreu sem
// conseguir marcar "failed" (crash do runtime, deploy no meio do after()). Sem
// o desbloqueio, a sessão prenderia o usuário com 409 para sempre.
const PREPARING_STALE_MS = 5 * 60_000;

/** Sessão "preparing" com mais de PREPARING_STALE_MS (created_at ou started_at). */
function isStalePreparing(session: TeableRecord<PracticeSessionFields>, now: number = Date.now()) {
  if (session.fields.status !== "preparing") return false;
  const createdAt = dateValue(session.fields.created_at || session.fields.started_at);
  return createdAt > 0 && now - createdAt > PREPARING_STALE_MS;
}

/** Best-effort: marca a sessão como failed e registra o evento de falha. */
async function failZombiePreparingSession(client: ReturnType<typeof getTeableClient>, userId: string, sessionId: string) {
  await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, { status: "failed", updated_at: new Date().toISOString() }).catch(() => undefined);
  await client.createEvent(userId, "new_words_session_creation_failed", { session_id: sessionId, reason: "stale_preparing" }).catch(() => undefined);
}

/**
 * Cria a sessão em "preparing" e devolve na hora: a geração do deck (IA, 15–40s)
 * roda em background via generateNewWordsDeck — é o que elimina o 502 de timeout
 * do proxy na criação síncrona.
 */
export async function startNewWordsPractice(input: { count?: unknown }): Promise<{ sessionId: string; status: "preparing"; requestedWordCount: number }> {
  const count = normalizeNewWordsSessionSize(input.count);
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Configure um idioma antes de iniciar a sessão.", 409);
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  const openSessions = sessions.filter((session) => session.fields.type === SESSION_TYPE && (session.fields.status === "active" || session.fields.status === "preparing"));
  // Sessão active (ou preparing recente) bloqueia; preparing zumbi não prende:
  // é marcado failed e o start segue para criar a sessão nova.
  if (openSessions.some((session) => !isStalePreparing(session, Date.now()))) {
    throw new LearningStateError("Você já possui uma sessão de palavras novas em andamento. Continue-a antes de iniciar outra.", 409);
  }
  for (const zombie of openSessions) await failZombiePreparingSession(client, user.id, zombie.id);
  const now = new Date().toISOString();
  const session = await client.createRecord<PracticeSessionFields>("practiceSessions", {
    Name: `Palavras novas · ${now.slice(0, 10)}`,
    user_id: user.id,
    language_profile_id: profile.id,
    conversation_id: "",
    type: SESSION_TYPE,
    focus: JSON.stringify({ count }),
    status: "preparing",
    started_at: now,
    ended_at: "",
    duration_seconds: 0,
    requested_word_count: count,
    selected_word_count: 0,
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
  return { sessionId: session.id, status: "preparing", requestedWordCount: count };
}

/**
 * Gera o deck da sessão em "preparing" (IA propõe → words+senses → frases com
 * rodadas → reposição → cards → ativa) e esquenta o áudio. Executa em background
 * (after() da rota): qualquer erro marca a sessão como "failed" — estado que a
 * UI trata — e é engolido aqui com console.error.
 */
export async function generateNewWordsDeck(sessionId: string): Promise<void> {
  const client = getTeableClient();
  const operationStartedAt = Date.now();
  let userId = "";
  try {
    const user = await getSessionUser();
    userId = user.id;
    const profile = await getActiveLanguageProfile(user);
    if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
    const scopeFilters = [
      { field: "user_id", value: user.id },
      { field: "language_profile_id", value: profile.id }
    ];
    const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters);
    // Só prossegue se a sessão continua em "preparing": inexistente, de outro
    // usuário ou já fora de preparing (ex.: abandonada) = nada a fazer.
    const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && item.fields.status === "preparing");
    if (!session) return;
    const focus = parseJsonObject(session.fields.focus ?? "{}") as { count?: unknown };
    const count = normalizeNewWordsSessionSize(focus.count);

    const allWords = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
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

    // 2. Persiste as palavras + sentido primário (idempotente por canonical_key/sense_key)
    //    e gera as frases (validadas); encapsulado para a reposição reutilizar o mesmo caminho.
    const now = new Date().toISOString();
    const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
    const knownLemmas = knownWordsForPrompt.map((word) => word.lemma);
    const buildWordsWithSentences = async (proposalList: typeof proposals) => {
      const created: NewWordPreview[] = [];
      for (const proposal of proposalList) {
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
      const generation = await generateSentencesForWords(created.map((word) => ({ id: word.wordId, lemma: word.lemma })), knownLemmas, language, level);
      const usable = created.filter((word) => generation.sentencesByWord.get(word.wordId)?.length);
      const sentences = usable.flatMap((word) => (generation.sentencesByWord.get(word.wordId) ?? []).map((generated) => ({ word, generated })));
      return { usable, sentences, generation };
    };

    // 1ª leva de palavras + frases.
    const proposedLemmas = new Set(proposals.map((proposal) => normalizeVocabularyToken(proposal.lemma)));
    const firstBatch = await buildWordsWithSentences(proposals);
    let { usable, sentences } = firstBatch;
    const { generation } = firstBatch;
    // Reposição: completa o pedido com palavras novas enquanto houver déficit (máx. 2 rodadas).
    // Falha na reposição não derruba a sessão: ela abre com as palavras que já tem
    // (a UI avisa o déficit); erros da PRIMEIRA leva continuam propagando.
    for (let topUp = 0; topUp < 2 && usable.length < count; topUp += 1) {
      try {
        const deficit = count - usable.length;
        const extraProposals = await generateNewWordProposals(
          knownWordsForPrompt.filter((word) => !proposedLemmas.has(normalizeVocabularyToken(word.lemma))),
          bankWords, deficit, language, level
        );
        const fresh = extraProposals.filter((proposal) => !proposedLemmas.has(normalizeVocabularyToken(proposal.lemma)));
        if (!fresh.length) break;
        fresh.forEach((proposal) => proposedLemmas.add(normalizeVocabularyToken(proposal.lemma)));
        const extra = await buildWordsWithSentences(fresh);
        usable = [...usable, ...extra.usable];
        sentences = [...sentences, ...extra.sentences];
      } catch (error) {
        console.warn("new words: top-up failed", error);
        break;
      }
    }
    if (!usable.length) throw new LearningStateError("Não foi possível montar as frases agora. Tente novamente em instantes.", 502);

    // 3. Grava os cards da sessão (mesmo ciclo dos flashcards).
    const cards: NewWordsSentence[] = [];
    let position = 0;
    for (const { word, generated } of sentences) {
      const record = await client.createRecord<FlashcardFields>("flashcards", {
        user_id: user.id,
        practice_session_id: sessionId,
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
      cards.push({
        id: record.id,
        sessionId,
        targetWordId: word.wordId,
        targetSenseId: word.senseId,
        sentence: generated.text,
        translation: generated.translation,
        audioText: generated.text,
        position
      });
      position += 1;
    }

    // Exemplo da primeira frase vira exemplo do sentido primário.
    for (const word of usable) {
      const first = cards.find((sentence) => sentence.targetWordId === word.wordId);
      if (first) await updateWordSense(word.senseId, { example_sentence: first.sentence }).catch(() => undefined);
    }

    // 4. Relê antes de ativar: o usuário pode ter abandonado durante a geração
    //    (não há botão de sair na espera, mas o app pode ter fechado) — nesse
    //    caso a sessão permanece como está e o deck é descartado.
    const freshSession = (await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters))
      .find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE);
    if (!freshSession || freshSession.fields.status !== "preparing") return;

    await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, {
      status: "active",
      focus: JSON.stringify({ count, wordIds: usable.map((word) => word.wordId) }),
      selected_word_count: usable.length,
      unique_card_count: cards.length,
      updated_at: new Date().toISOString()
    });
    await client.createEvent(user.id, "new_words_session_started", {
      session_id: sessionId,
      requested_count: count,
      word_count: usable.length,
      sentence_count: cards.length,
      dropped_word_ids: generation.droppedWordIds,
      rejection_reasons: generation.rejectionReasons
    });

    // Warm das 2 primeiras frases AGUARDADO (a frase 1 toca instantânea); o resto
    // é fogo-e-esqueça — a geração já roda dentro do after(), então o serverless
    // mantém a execução. Best-effort: erro não propaga.
    const warmTexts = cards.map((card) => card.audioText);
    await warmCachedSpeech(warmTexts.slice(0, 2), profile.fields.language_code).catch(() => undefined);
    if (warmTexts.length > 2) {
      void warmCachedSpeech(warmTexts.slice(2), profile.fields.language_code).catch(() => undefined);
    }
  } catch (error) {
    // Best-effort: marca "failed" (é isso que sinaliza a UI) sem pisotear um
    // status que já mudou (ex.: abandonada durante a geração) e engole o erro.
    if (userId) {
      const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [{ field: "user_id", value: userId }]).catch(() => []);
      const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && item.fields.status === "preparing");
      if (session) {
        await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, { status: "failed", updated_at: new Date().toISOString() }).catch(() => undefined);
        await client.createEvent(userId, "new_words_session_creation_failed", { session_id: sessionId, duration_ms: Date.now() - operationStartedAt, error_type: safeErrorType(error) }).catch(() => undefined);
      }
    }
    console.error("new words: deck generation failed", error);
  }
}

// ---------- Retomada ----------

export async function getActiveNewWordsPractice(): Promise<ActiveNewWordsPractice | null> {
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ]);
  // A mais recente entre active/preparing/failed define o que a UI vê: preparing
  // vira polling, failed recente vira erro acionável, active segue como antes.
  const session = sessions
    .filter((item) => item.fields.type === SESSION_TYPE && (item.fields.status === "active" || item.fields.status === "preparing" || item.fields.status === "failed"))
    .sort((a, b) => dateValue(b.fields.started_at || b.fields.created_at) - dateValue(a.fields.started_at || a.fields.created_at))[0];
  if (!session) return null;
  if (session.fields.status === "preparing") {
    // Preparing zumbi (mais de 5 min): marca failed e devolve como falha — o
    // polling para com mensagem em vez de girar os 100s à toa.
    if (isStalePreparing(session, Date.now())) {
      await failZombiePreparingSession(client, user.id, session.id);
      return { preparing: false, failed: true, sessionId: session.id };
    }
    const focus = parseJsonObject(session.fields.focus ?? "{}") as { count?: unknown };
    return { preparing: true, sessionId: session.id, requestedWordCount: normalizeNewWordsSessionSize(focus.count) };
  }
  if (session.fields.status === "failed") {
    // Falha recente (10 min) é acionável na UI; depois disso é lixo inerte.
    const createdAt = dateValue(session.fields.created_at);
    if (!(createdAt > 0 && Date.now() - createdAt < 10 * 60_000)) return null;
    return { preparing: false, failed: true, sessionId: session.id };
  }
  const [sentences, attempts] = await Promise.all([
    listSentences(client, user.id, session.id),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "practice_session_id", session.id)
  ]);
  const answeredIds = new Set(attempts.filter((attempt) => !attempt.fields.undone_at).map((attempt) => attempt.fields.flashcard_id));
  const next = sentences.find((sentence) => !answeredIds.has(sentence.id));
  await client.createEvent(user.id, "new_words_session_resumed", { session_id: session.id, answered_count: answeredIds.size });
  return {
    preparing: false,
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

// ---------- Conclusão ----------

const completionLocks = new Map<string, Promise<NewWordsSessionResult>>();

export async function completeNewWordsPractice(sessionId: string, clientCompletionId: string): Promise<NewWordsSessionResult> {
  if (!sessionId.trim()) throw new LearningStateError("Informe a sessão.", 422);
  if (!isOperationId(clientCompletionId)) throw new LearningStateError("Identificador de conclusão inválido.", 422);
  const pending = completionLocks.get(sessionId);
  if (pending) return pending;
  const operation = completeNewWordsPracticeUnlocked(sessionId, clientCompletionId);
  completionLocks.set(sessionId, operation);
  try { return await operation; } finally { completionLocks.delete(sessionId); }
}

async function completeNewWordsPracticeUnlocked(sessionId: string, clientCompletionId: string): Promise<NewWordsSessionResult> {
  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const sessions = await client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE);
  if (!session) throw new LearningStateError("Sessão não encontrada.", 404);
  const focus = parseJsonObject(session.fields.focus ?? "{}") as Record<string, unknown> & {
    completed?: boolean; completionId?: string; result?: NewWordsSessionResult; expandedSenses?: number;
  };
  if (focus.completed || session.fields.status === "completed") {
    if (focus.completionId === clientCompletionId && focus.result) return focus.result;
    throw new LearningStateError("Esta sessão já foi contabilizada.", 409);
  }
  const [sentences, attempts] = await Promise.all([
    listSentences(client, user.id, sessionId),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "practice_session_id", sessionId)
  ]);
  const liveAttempts = attempts.filter((record) => !record.fields.undone_at);
  const answeredBySentence = new Map<string, typeof liveAttempts[number]>();
  for (const record of liveAttempts.sort((a, b) => dateValue(a.fields.created_at) - dateValue(b.fields.created_at))) {
    answeredBySentence.set(record.fields.flashcard_id, record);
  }
  const pending = sentences.filter((sentence) => !answeredBySentence.has(sentence.id));
  if (pending.length) throw new LearningStateError("Ainda existem frases pendentes nesta sessão.", 409);

  const judgmentOf = (record: typeof liveAttempts[number]) =>
    parseJsonObject(record.fields.judgment_json ?? "") as JudgedTranslation;
  const correctSentences = liveAttempts.filter((record) => record.fields.was_correct).length;
  const firstAttemptCorrect = correctSentences; // cada frase é apresentada uma única vez
  const newSensesAdded = liveAttempts.filter((record) => {
    const judgment = judgmentOf(record);
    return Boolean(judgment.newSenseTranslation) && (judgment.verdict === "correct" || judgment.verdict === "acceptable");
  }).length;
  const score = sentences.length ? Math.round((correctSentences / sentences.length) * 100) : 0;
  const durationSeconds = Math.max(0, Math.round((Date.now() - dateValue(session.fields.started_at || session.fields.created_at)) / 1000));
  const words = await sessionWordPreviews(client, user.id, profile.id, session);
  const result: NewWordsSessionResult = {
    score, wordCount: words.length, sentenceCount: sentences.length,
    correctSentences, firstAttemptCorrect, newSensesAdded, durationSeconds, words
  };

  const endedAt = new Date().toISOString();
  await client.updateRecord<PracticeSessionFields>("practiceSessions", session.id, {
    focus: JSON.stringify({ ...focus, completed: true, completionId: clientCompletionId, result, expandedSenses: newSensesAdded }),
    status: "completed",
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    presentation_count: sentences.length,
    correct_count: correctSentences,
    incorrect_count: sentences.length - correctSentences,
    score,
    updated_at: endedAt
  });
  await client.createEvent(user.id, "new_words_session_completed", {
    session_id: sessionId, score, sentence_count: sentences.length, correct: correctSentences, new_senses: newSensesAdded, duration_seconds: durationSeconds
  });
  // Palavras novas contam no feedback do dia (mesma métrica das conversas).
  try {
    await addLearnedWordsToDailyFeedback(user.id, profile.id, toDateKey(new Date().toISOString()), words.length);
  } catch (error) {
    console.warn("new words: daily feedback update failed", error);
  }
  return result;
}

// ---------- Julgamento da tentativa ----------

type JudgeInput = {
  sessionId?: unknown; clientAttemptId?: unknown; sentenceId?: unknown; userTranslation?: unknown;
  responseTimeMs?: unknown; usedSpeech?: unknown; audioReplayCount?: unknown; usedSlowAudio?: unknown; audioFailed?: unknown;
};

export async function judgeNewWordsAttempt(input: JudgeInput): Promise<NewWordsAttemptResult> {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const clientAttemptId = typeof input.clientAttemptId === "string" ? input.clientAttemptId : "";
  const sentenceId = typeof input.sentenceId === "string" ? input.sentenceId : "";
  const userTranslation = typeof input.userTranslation === "string" ? input.userTranslation.trim().slice(0, 300) : "";
  if (!sessionId || !isOperationId(clientAttemptId)) throw new LearningStateError("Identificador da tentativa inválido.", 422);
  if (!userTranslation) throw new LearningStateError("Escreva a tradução antes de enviar.", 422);

  const client = getTeableClient();
  const user = await getSessionUser();
  const profile = await getActiveLanguageProfile(user);
  if (!profile) throw new LearningStateError("Perfil de idioma não encontrado.", 409);
  const scopeFilters = [
    { field: "user_id", value: user.id },
    { field: "language_profile_id", value: profile.id }
  ];
  const [sessions, attemptRecords] = await Promise.all([
    client.listRecordsWhereAll<PracticeSessionFields>("practiceSessions", scopeFilters),
    client.listRecordsWhere<FlashcardAttemptFields>("flashcardAttempts", "user_id", user.id)
  ]);
  const session = sessions.find((item) => item.id === sessionId && item.fields.type === SESSION_TYPE && item.fields.status === "active");
  if (!session) throw new LearningStateError("Sessão ativa não encontrada.", 404);

  const sessionAttempts = attemptRecords
    .filter((record) => record.fields.practice_session_id === sessionId && !record.fields.undone_at)
    .sort((a, b) => dateValue(a.fields.created_at || a.createdTime) - dateValue(b.fields.created_at || b.createdTime) || a.id.localeCompare(b.id));

  // Idempotência: mesma clientAttemptId devolve o julgamento persistido.
  const sentences = await listSentences(client, user.id, sessionId);
  const existing = sessionAttempts.find((record) => record.fields.client_attempt_id === clientAttemptId);
  if (existing) {
    const stored = parseJsonObject(existing.fields.judgment_json ?? "") as JudgedTranslation;
    const reference = sentences.find((sentence) => sentence.id === existing.fields.flashcard_id)?.translation ?? "";
    return {
      sentenceId: existing.fields.flashcard_id,
      clientAttemptId,
      judgment: stored && stored.verdict ? stored : fallbackJudgment(userTranslation, reference),
      rating: existing.fields.final_rating,
      senseCreated: false
    };
  }

  const answeredIds = new Set(sessionAttempts.map((record) => record.fields.flashcard_id));
  const next = sentences.find((sentence) => !answeredIds.has(sentence.id));
  if (!next || next.id !== sentenceId) throw new LearningStateError("A tentativa não corresponde à próxima frase da sessão.", 409);

  // Contexto pedagógico: palavra + sentidos cadastrados.
  const words = await client.listRecordsWhereAll<WordFields>("words", scopeFilters);
  const word = words.find((item) => item.id === next.targetWordId);
  if (!word) throw new LearningStateError("Palavra da frase não encontrada.", 404);
  const senses = (await listSensesByWordIds([word.id])).get(word.id) ?? [];

  // Match exato nem chama a IA: tradução idêntica à referência é "correct"
  // determinístico — pula a chamada (julgamento instantâneo) e não há novo
  // significado a explorar quando a tradução é a própria referência.
  let judgment: JudgedTranslation;
  if (compareFlashcardAnswer(userTranslation, next.translation) === "exact") {
    judgment = { verdict: "correct", feedback: "Isso mesmo!", correctedTranslation: next.translation };
  } else {
    // 1) IA professora; 2) fallback determinístico se a IA falhar.
    judgment = await requestTeacherJudgment(next, word, senses, userTranslation).catch(() => null) ?? fallbackJudgment(userTranslation, next.translation);
  }

  // Expansão de significados: tradução válida diferente das cadastradas.
  let senseCreated = false;
  if ((judgment.verdict === "correct" || judgment.verdict === "acceptable") && judgment.newSenseTranslation) {
    senseCreated = await expandWordSense(user.id, profile.id, word, senses, judgment.newSenseTranslation, next.sentence);
    if (senseCreated) {
      await client.createEvent(user.id, "new_words_sense_expanded", {
        session_id: sessionId, word_id: word.id, translation: judgment.newSenseTranslation, sentence: next.sentence
      });
    }
  }

  // Persiste a tentativa + aplica a revisão SRS no sentido primário.
  const matchResult = mapVerdictToMatch(judgment.verdict);
  const responseTimeMs = Math.max(0, Math.min(300_000, Math.round(Number(input.responseTimeMs) || 0)));
  const rating = inferRecallRating({ match: matchResult, forgot: false, responseTimeMs, cardType: "target_to_native" });
  const now = new Date().toISOString();
  const targetSense = senses.find((item) => item.id === next.targetSenseId);
  const record = await client.createRecord<FlashcardAttemptFields>("flashcardAttempts", {
    user_id: user.id,
    practice_session_id: sessionId,
    flashcard_id: next.id,
    word_id: word.id,
    sense_id: next.targetSenseId || "",
    presentation_number: 1,
    client_attempt_id: clientAttemptId,
    user_answer: userTranslation,
    normalized_answer: normalizeFlashcardAnswer(userTranslation),
    match_result: matchResult,
    suggested_rating: rating,
    final_rating: rating,
    was_correct: judgment.verdict === "correct" || judgment.verdict === "acceptable",
    response_time_ms: responseTimeMs,
    used_speech: input.usedSpeech === true,
    audio_replay_count: Math.max(0, Math.min(30, Math.round(Number(input.audioReplayCount) || 0))),
    used_slow_audio: input.usedSlowAudio === true,
    answered_after_audio_replay: Number(input.audioReplayCount) > 0,
    audio_failed: input.audioFailed === true,
    judgment_json: JSON.stringify(judgment),
    created_at: now
  });

  if (targetSense) {
    try {
      await applySenseReview(client, word, targetSense, [{ rating, responseTimeMs, cardType: "target_to_native" }], new Date(now), user.fields.timezone ?? "UTC");
      await client.updateRecord<FlashcardAttemptFields>("flashcardAttempts", record.id, { review_applied: true, resulting_review_state: "" });
    } catch (error) {
      await client.createEvent(user.id, "new_words_review_failed", { session_id: sessionId, sentence_id: next.id, message: error instanceof Error ? error.message : "unknown" }).catch(() => undefined);
    }
  }

  await client.updateRecord<PracticeSessionFields>("practiceSessions", sessionId, {
    presentation_count: sessionAttempts.length + 1,
    updated_at: now
  });
  await client.createEvent(user.id, "new_words_attempt_judged", {
    session_id: sessionId, sentence_id: next.id, verdict: judgment.verdict, rating, sense_created: senseCreated, response_time_ms: responseTimeMs
  });

  return { sentenceId: next.id, clientAttemptId, judgment, rating, senseCreated };
}

async function requestTeacherJudgment(
  sentence: NewWordsSentence,
  word: TeableRecord<WordFields>,
  senses: TeableRecord<WordSenseFields>[],
  userTranslation: string
): Promise<JudgedTranslation> {
  const knownSenses = senses.map((sense) => sense.fields.translation).filter(Boolean);
  const ai = await createChatCompletion([
    { role: "system", content: [
      "Você é um professor de idiomas gentil e objetivo corrigindo a tradução de uma frase feita por um aluno brasileiro.",
      `Frase no idioma alvo: "${sentence.sentence}".`,
      `Tradução de referência: "${sentence.translation}".`,
      `Palavra-alvo: "${word.fields.display_text || word.fields.lemma}" — significados cadastrados no banco: ${JSON.stringify(knownSenses)}.`,
      "Avalie a tradução do aluno comparando com o significado da palavra-alvo na frase.",
      "Regras:",
      '- verdict "correct": tradução fiel ao sentido da frase (mesmo com palavras diferentes).',
      '- verdict "acceptable": tradução correta na essência, com diferença de registro ou nuance.',
      '- verdict "minor_error": ideia certa, mas com erro pequeno (ortografia/concordância no português).',
      '- verdict "incorrect": sentido errado, incompleto ou não traduz a frase.',
      '- feedback: 1 a 3 frases curtas em português brasileiro, em tom de professor; se correto, elogie e reforce o significado da palavra-alvo.',
      '- corrected_translation: a melhor tradução em português (a de referência ou uma versão melhorada da do aluno).',
      '- new_sense_translation: quando a tradução do aluno estiver certa mas revelar um significado/nuance da palavra-alvo DIFERENTE dos significados cadastrados, informe esse novo significado em português (curto); caso contrário, null.',
      'Responda somente JSON válido: {"verdict":"correct|acceptable|minor_error|incorrect","feedback":"...","corrected_translation":"...","new_sense_translation":null}.'
    ].join("\n") },
    { role: "user", content: `Tradução do aluno: "${userTranslation}"` }
  ], { temperature: 0.2, maxTokens: 320, timeoutMs: 12_000, responseFormat: "json", disableThinking: true });
  const parsed = parseJsonObject(ai.content);
  const judgment = sanitizeJudgment(parsed, sentence.translation);
  if (!judgment) throw new Error("Resposta da IA malformada.");
  return judgment;
}

async function expandWordSense(
  userId: string,
  profileId: string,
  word: TeableRecord<WordFields>,
  senses: TeableRecord<WordSenseFields>[],
  translation: string,
  exampleSentence: string
) {
  const lemma = word.fields.lemma || word.fields.display_text || "";
  const senseKey = canonicalSenseKey(userId, profileId, lemma, translation);
  const normalized = normalizeVocabularyToken(translation);
  const alreadyKnown = senses.some((sense) =>
    matchesCanonicalSenseKey(sense.fields.sense_key, senseKey) ||
    (sense.fields.translation?.trim() && normalizeVocabularyToken(sense.fields.translation) === normalized)
  );
  if (alreadyKnown) return false;
  try {
    await createWordSense({
      Name: lemma,
      user_id: userId,
      word_id: word.id,
      sense_key: senseKey,
      translation,
      part_of_speech: word.fields.part_of_speech || undefined,
      example_sentence: exampleSentence.slice(0, 300),
      source: "session",
      is_primary: false,
      sense_order: nextSenseOrderFromList(senses),
      total_uses: 1,
      review_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      review_state: "new",
      created_at: new Date().toISOString()
    });
    return true;
  } catch {
    return false; // Falha ao expandir não pode travar a sessão.
  }
}

function isOperationId(value: string) { return /^[a-zA-Z0-9_-]{8,100}$/.test(value); }

// ---------- helpers ----------

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) as Record<string, unknown> : {}; } catch { return {}; }
}

function dateValue(value: string | undefined) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }

// Igual ao safeErrorType privado de flashcards.ts: rotula o erro para eventos.
function safeErrorType(error: unknown) { return error instanceof LearningStateError ? `learning_state_${error.status}` : error instanceof Error ? error.name.slice(0, 80) : "unknown"; }

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
