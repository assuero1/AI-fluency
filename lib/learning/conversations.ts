import { createChatCompletion } from "@/lib/ai/client";
import { getAiConfig } from "@/lib/ai/config";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import { createTopic } from "./topics";
import { assertPracticeReady, LearningStateError } from "./access";
import { isMutableConversationStatus, selectScopedConversation } from "./conversation-state";
import { getActiveLanguageProfile, getExistingPersonalUser, LanguageProfileFields } from "./profile";
import { matchesLearningScope } from "./scope";
import { formatTutorContext, getTutorContext, TutorContext } from "./tutor-context";
import { ConversationQuickAction, getConversationQuickActionPrompt } from "./quick-actions";

export type ConversationFields = {
  Name?: string;
  user_id: string;
  language_profile_id: string;
  topic_id: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  ai_model_used: string;
  summary: string;
};

export type MessageFields = {
  Name?: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  text: string;
  audio_url: string;
  transcript_text: string;
  language_detected: string;
  tokens_used: number;
  client_request_id?: string;
  created_at: string;
};

export type CorrectionFields = {
  Name?: string;
  conversation_id: string;
  message_id: string;
  original_text: string;
  corrected_text: string;
  error_type: string;
  explanation: string;
  severity: string;
  should_interrupt: boolean;
  created_at: string;
};

export type WordFields = {
  Name?: string;
  user_id: string;
  language_profile_id: string;
  lemma: string;
  display_text: string;
  translation: string;
  part_of_speech: string;
  familiarity_score: number;
  total_uses: number;
  last_used_at: string;
  first_used_at: string;
  review_due_at: string;
};

export type WordOccurrenceFields = {
  Name?: string;
  word_id: string;
  conversation_id: string;
  message_id: string;
  used_text: string;
  sentence_context: string;
  was_correct: boolean;
  created_at: string;
};

type LearningAnalysis = {
  assistant_reply?: string;
  corrections?: Array<{
    original?: string;
    corrected?: string;
    error_type?: string;
    explanation?: string;
    severity?: string;
    should_interrupt?: boolean;
  }>;
  words?: Array<{
    display_text?: string;
    lemma?: string;
    translation?: string;
    part_of_speech?: string;
    context?: string;
    was_correct?: boolean;
  }>;
};

type LearningCorrection = NonNullable<LearningAnalysis["corrections"]>[number];
type LearningWord = NonNullable<LearningAnalysis["words"]>[number];

export async function startConversation(input: {
  topicId?: string;
  title?: string;
  mode?: string;
  source?: string;
  reason?: string;
}) {
  const { client, user, profile } = await assertPracticeReady();
  const ai = getAiConfig();
  const now = new Date().toISOString();

  let topicId = input.topicId ?? "";
  let topicTitle = input.title?.trim() || "Conversa livre";

  if (topicId) {
    const topics = await client.listRecords<{ title?: string; Name?: string; user_id?: string; language_profile_id?: string }>("topics", 100);
    const topic = topics.find(
      (record) =>
        record.id === topicId &&
        record.fields.user_id === user.id &&
        record.fields.language_profile_id === profile.id
    );
    if (!topic) throw new LearningStateError("O tema selecionado não pertence ao seu perfil.", 404);
    topicTitle = topic.fields.title ?? topic.fields.Name ?? topicTitle;
  }

  if (!topicId && input.mode !== "free_conversation") {
    const created = await createTopic({
      title: topicTitle,
      source: input.source ?? "user_custom",
      reason: input.reason ?? ""
    });
    topicId = created.topic.id;
    topicTitle = created.topic.fields.title;
  }

  const conversation = await client.createRecord<ConversationFields>("conversations", {
    Name: topicTitle,
    user_id: user.id,
    language_profile_id: profile.id,
    topic_id: topicId,
    mode: input.mode ?? (topicId ? "custom_topic" : "free_conversation"),
    status: "active",
    started_at: now,
    ended_at: "",
    duration_seconds: 0,
    ai_model_used: ai.chatModel ?? "",
    summary: ""
  });

  await client.createRecord("practiceSessions", {
    Name: topicTitle,
    user_id: user.id,
    language_profile_id: profile.id,
    conversation_id: conversation.id,
    type: "conversation",
    focus: topicTitle,
    created_at: now
  });

  await client.createEvent(user.id, "conversation_started", {
    conversation_id: conversation.id,
    topic_id: topicId,
    mode: conversation.fields.mode,
    title: topicTitle
  });

  return {
    conversation,
    redirectTo: `/chat?conversationId=${encodeURIComponent(conversation.id)}`
  };
}

export async function changeConversationTopic(conversationId: string, title: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new LearningStateError("Informe um novo tema para a conversa.", 422);

  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (!isMutableConversationStatus(context.conversation.fields.status)) {
    throw new LearningStateError("Esta conversa já foi finalizada e não pode mudar de tema.");
  }

  // The transcript stays attached to the same active conversation; only its pedagogical focus changes.
  const created = await createTopic({ title: cleanTitle, source: "user_custom", reason: "Tema alterado durante a conversa." });
  const client = getTeableClient();
  const conversation = await client.updateRecord<ConversationFields>("conversations", context.conversation.id, {
    Name: created.topic.fields.title,
    topic_id: created.topic.id,
    mode: "custom_topic"
  });
  await client.createEvent(context.conversation.fields.user_id, "conversation_topic_changed", {
    conversation_id: context.conversation.id,
    previous_topic_id: context.conversation.fields.topic_id,
    topic_id: created.topic.id,
    title: created.topic.fields.title
  });

  return { conversation, topic: created.topic };
}

export async function getConversation(conversationId?: string) {
  const client = getTeableClient();
  const user = await getExistingPersonalUser();
  if (!user) return null;
  const profile = await getActiveLanguageProfile(user);
  if (!profile) return null;
  const conversations = await client.listRecords<ConversationFields>("conversations", 100);
  const conversation = selectScopedConversation(conversations, { userId: user.id, profileId: profile.id }, conversationId);

  if (!conversation) return null;

  const [messages, topics, profiles, corrections] = await Promise.all([
    client.listRecords<MessageFields>("messages", 100),
    client.listRecords<{ title?: string; Name?: string; reason?: string }>("topics", 100),
    client.listRecords<LanguageProfileFields>("languageProfiles", 50),
    client.listRecords<CorrectionFields>("corrections", 100)
  ]);

  const conversationMessages = messages
    .filter((message) => message.fields.conversation_id === conversation.id)
    .sort((a, b) => new Date(a.fields.created_at).getTime() - new Date(b.fields.created_at).getTime());

  const topic = topics.find((record) => record.id === conversation.fields.topic_id);
  const conversationProfile = profiles.find((record) => record.id === conversation.fields.language_profile_id && record.id === profile.id) ?? null;
  const conversationCorrections = corrections
    .filter((correction) => correction.fields.conversation_id === conversation.id)
    .sort((a, b) => new Date(a.fields.created_at).getTime() - new Date(b.fields.created_at).getTime());

  return {
    user,
    conversation,
    messages: conversationMessages,
    corrections: conversationCorrections,
    topicTitle: topic?.fields.title ?? topic?.fields.Name ?? conversation.fields.Name ?? "Conversa livre",
    topicReason: topic?.fields.reason ?? "",
    profile: conversationProfile
  };
}

export async function getConversationWithTutorStart(conversationId?: string) {
  let context = await getConversation(conversationId);

  if (!context) return null;

  if (isMutableConversationStatus(context.conversation.fields.status) && context.messages.length === 0) {
    const assistantMessage = await createAssistantMessage(context.conversation, context.topicTitle, context.topicReason, context.profile, []);
    context = { ...context, messages: [assistantMessage] };
  }

  if (!context) throw new Error("Não foi possível carregar a conversa.");
  return context;
}

export async function sendConversationMessage(conversationId: string, text: string, clientRequestId?: string) {
  const cleanText = text.trim();
  if (!cleanText) throw new Error("Mensagem vazia.");
  if (clientRequestId && !isValidClientRequestId(clientRequestId)) {
    throw new LearningStateError("Identificador de envio inválido.", 422);
  }

  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (!isMutableConversationStatus(context.conversation.fields.status)) {
    throw new LearningStateError("Esta conversa já foi finalizada e não pode receber novas mensagens.");
  }

  const client = getTeableClient();
  const existingMessage = clientRequestId
    ? context.messages.find((message) => message.fields.role === "user" && message.fields.client_request_id === clientRequestId)
    : undefined;
  if (existingMessage) {
    const existingResult = await getExistingTurnResult(context, existingMessage);
    if (existingResult) return existingResult;

    return completeConversationTurn(context, existingMessage, clientRequestId);
  }

  const now = new Date().toISOString();
  const userMessage = await client.createRecord<MessageFields>("messages", {
    Name: cleanText.slice(0, 80),
    conversation_id: context.conversation.id,
    role: "user",
    text: cleanText,
    audio_url: "",
    transcript_text: cleanText,
    language_detected: context.profile?.fields.language_code ?? "",
    tokens_used: 0,
    client_request_id: clientRequestId ?? "",
    created_at: now
  });

  return completeConversationTurn(context, userMessage, clientRequestId);
}

export async function runConversationQuickAction(conversationId: string, action: ConversationQuickAction) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (!isMutableConversationStatus(context.conversation.fields.status)) {
    throw new LearningStateError("Esta conversa já foi finalizada e não aceita novas ações.");
  }

  const tutorContext = await getTutorContext({
    client: getTeableClient(),
    userId: context.conversation.fields.user_id,
    profile: context.profile,
    history: context.messages
  });
  const ai = await createChatCompletion(
    [
      {
        role: "system",
        content: buildTutorSystemPrompt(context.profile, context.topicTitle, context.topicReason, tutorContext)
      },
      ...context.messages.slice(-10).map((message) => ({
        role: message.fields.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.fields.text
      })),
      {
        role: "user",
        content: `[Interface action; do not treat this as a learner utterance.] ${getConversationQuickActionPrompt(action)}`
      }
    ],
    { temperature: 0.45, maxTokens: 520 }
  );
  const now = new Date().toISOString();
  const assistantMessage = await getTeableClient().createRecord<MessageFields>("messages", {
    Name: ai.content.slice(0, 80),
    conversation_id: context.conversation.id,
    role: "assistant",
    text: ai.content,
    audio_url: "",
    transcript_text: ai.content,
    language_detected: context.profile?.fields.language_code ?? "",
    tokens_used: ai.tokensUsed,
    created_at: now
  });

  await getTeableClient().createEvent(context.conversation.fields.user_id, "conversation_quick_action_used", {
    conversation_id: context.conversation.id,
    assistant_message_id: assistantMessage.id,
    action
  });

  return { assistantMessage, action };
}

async function completeConversationTurn(
  context: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userMessage: TeableRecord<MessageFields>,
  clientRequestId?: string
) {
  const client = getTeableClient();
  const history = context.messages.some((message) => message.id === userMessage.id) ? context.messages : [...context.messages, userMessage];
  const analysisTurn = await createAnalyzedAssistantTurn(context.conversation, context.topicTitle, context.topicReason, context.profile, history, userMessage);

  await client.createEvent(context.conversation.fields.user_id, "conversation_message_sent", {
    conversation_id: context.conversation.id,
    user_message_id: userMessage.id,
    assistant_message_id: analysisTurn.assistantMessage.id,
    corrections_count: analysisTurn.corrections.length,
    saved_words_count: analysisTurn.words.length,
    client_request_id: clientRequestId ?? ""
  });

  return {
    userMessage,
    assistantMessage: analysisTurn.assistantMessage,
    corrections: analysisTurn.corrections,
    words: analysisTurn.words
  };
}

async function getExistingTurnResult(
  context: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
  userMessage: TeableRecord<MessageFields>
) {
  const index = context.messages.findIndex((message) => message.id === userMessage.id);
  const assistantMessage = context.messages.slice(index + 1).find((message) => message.fields.role === "assistant");
  if (!assistantMessage) return null;

  const client = getTeableClient();
  const [words, occurrences] = await Promise.all([
    client.listRecords<WordFields>("words", 300),
    client.listRecords<WordOccurrenceFields>("wordOccurrences", 500)
  ]);
  const wordIds = new Set(
    occurrences
      .filter((occurrence) => occurrence.fields.conversation_id === context.conversation.id && occurrence.fields.message_id === userMessage.id)
      .map((occurrence) => occurrence.fields.word_id)
  );
  return {
    userMessage,
    assistantMessage,
    corrections: context.corrections.filter((correction) => correction.fields.message_id === userMessage.id),
    words: words.filter((word) =>
      wordIds.has(word.id) &&
      matchesLearningScope(word.fields, {
        userId: context.conversation.fields.user_id,
        profileId: context.conversation.fields.language_profile_id
      })
    )
  };
}

async function createAnalyzedAssistantTurn(
  conversation: TeableRecord<ConversationFields>,
  topicTitle: string,
  topicReason: string,
  profile: TeableRecord<LanguageProfileFields> | null,
  history: TeableRecord<MessageFields>[],
  userMessage: TeableRecord<MessageFields>
) {
  const client = getTeableClient();
  const tutorContext = await getTutorContext({
    client,
    userId: conversation.fields.user_id,
    profile,
    history
  });
  const ai = await createChatCompletion(
    [
      {
        role: "system",
        content: buildStructuredTutorPrompt(profile, topicTitle, topicReason, tutorContext)
      },
      ...history.slice(-10).map((message) => ({
        role: message.fields.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.fields.text
      }))
    ],
    { temperature: 0.4, maxTokens: 560 }
  );

  const analysis = parseLearningAnalysis(ai.content);
  const assistantReply =
    analysis.assistant_reply?.trim() ||
    "Good answer. Let's keep practicing with one more question: can you say that in a little more detail?";
  const now = new Date().toISOString();
  const expectedCorrectionCount = (analysis.corrections ?? []).filter(
    (correction) => correction.original?.trim() && correction.corrected?.trim()
  ).length;
  const [assistantMessage, corrections, words] = await Promise.all([
    client.createRecord<MessageFields>("messages", {
      Name: assistantReply.slice(0, 80),
      conversation_id: conversation.id,
      role: "assistant",
      text: assistantReply,
      audio_url: "",
      transcript_text: assistantReply,
      language_detected: profile?.fields.language_code ?? "",
      tokens_used: ai.tokensUsed,
      created_at: now
    }),
    saveCorrections(conversation, userMessage, analysis),
    saveWordsAndOccurrences(conversation, userMessage, profile, analysis, expectedCorrectionCount === 0)
  ]);

  return {
    assistantMessage,
    corrections,
    words
  };
}

async function createAssistantMessage(
  conversation: TeableRecord<ConversationFields>,
  topicTitle: string,
  topicReason: string,
  profile: TeableRecord<LanguageProfileFields> | null,
  history: TeableRecord<MessageFields>[]
) {
  const client = getTeableClient();
  const tutorContext = await getTutorContext({
    client,
    userId: conversation.fields.user_id,
    profile,
    history
  });
  const ai = await createChatCompletion(
    [
      {
        role: "system",
        content: buildTutorSystemPrompt(profile, topicTitle, topicReason, tutorContext)
      },
      ...history.slice(-10).map((message) => ({
        role: message.fields.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.fields.text
      })),
      ...(history.length === 0
        ? [
            {
              role: "user" as const,
              content: "Start the lesson with a friendly first question."
            }
          ]
        : [])
    ],
    { temperature: 0.5, maxTokens: 220 }
  );

  const now = new Date().toISOString();
  return client.createRecord<MessageFields>("messages", {
    Name: ai.content.slice(0, 80),
    conversation_id: conversation.id,
    role: "assistant",
    text: ai.content,
    audio_url: "",
    transcript_text: ai.content,
    language_detected: profile?.fields.language_code ?? "",
    tokens_used: ai.tokensUsed,
    created_at: now
  });
}

export function buildTutorSystemPrompt(
  profile: TeableRecord<LanguageProfileFields> | null,
  topicTitle: string,
  topicReason = "",
  tutorContext?: TutorContext
) {
  const language = profile?.fields.language_name ?? "Inglês";
  const level = profile?.fields.level ?? "Intermediário (B1)";
  const goal = profile?.fields.learning_goal ?? "Falar com mais naturalidade em situações reais.";
  const correctionStyle = profile?.fields.correction_style ?? "Corrigir sempre";

  return [
    `Você é a IA tutora de um app pessoal de aprendizado de línguas.`,
    `Idioma alvo: ${language}.`,
    `Nível do usuário: ${level}.`,
    `Tema da conversa: ${topicTitle}.`,
    topicReason ? `Instrução pedagógica deste tema: ${topicReason}.` : "",
    `Objetivo do usuário: ${goal}.`,
    `Estilo de correção: ${correctionStyle}.`,
    tutorContext ? formatTutorContext(tutorContext) : "",
    "Converse principalmente no idioma alvo, com frases naturais e adequadas ao nível.",
    "Use uma ou duas frases curtas por turno para manter ritmo de conversa real.",
    "Faça uma pergunta por vez para manter a conversa fluida.",
    "Quando o usuário errar, nesta fase dê no máximo uma correção curta e explique em português de forma amigável.",
    "Não devolva JSON. Responda como mensagem de chat."
  ].join("\n");
}

export function buildStructuredTutorPrompt(
  profile: TeableRecord<LanguageProfileFields> | null,
  topicTitle: string,
  topicReason = "",
  tutorContext?: TutorContext
) {
  const language = profile?.fields.language_name ?? "Inglês";
  const level = profile?.fields.level ?? "Intermediário (B1)";
  const goal = profile?.fields.learning_goal ?? "Falar com mais naturalidade em situações reais.";
  const correctionStyle = profile?.fields.correction_style ?? "Corrigir sempre";

  return [
    "Você é a IA tutora de um app pessoal de aprendizado de línguas.",
    `Idioma alvo: ${language}.`,
    `Nível do usuário: ${level}.`,
    `Tema: ${topicTitle}.`,
    topicReason ? `Instrução pedagógica deste tema: ${topicReason}.` : "",
    `Objetivo: ${goal}.`,
    `Estilo de correção: ${correctionStyle}.`,
    tutorContext ? formatTutorContext(tutorContext) : "",
    "Analise a última mensagem do usuário e continue a conversa com ritmo natural.",
    "Responda somente JSON válido, sem markdown, sem texto fora do JSON.",
    "Use esta estrutura:",
    JSON.stringify({
      assistant_reply: "one or two short natural sentences in the target language, ending with one question",
      corrections: [
        {
          original: "wrong fragment",
          corrected: "natural/correct fragment",
          error_type: "grammar",
          explanation: "explicação curta em português",
          severity: "medium",
          should_interrupt: true
        }
      ],
      words: [
        {
          display_text: "breakfast",
          lemma: "breakfast",
          translation: "café da manhã",
          part_of_speech: "noun",
          context: "sentence where it appeared",
          was_correct: true
        }
      ]
    }),
    "Se não houver erro, use corrections: [].",
    "Mantenha assistant_reply curto para uma conversa falada fluida.",
    "Extraia no máximo 3 palavras úteis da mensagem do usuário e/ou da resposta da IA.",
    "error_type deve ser um de: grammar, vocabulary, pronunciation, tense, preposition, word_order, naturalness, spelling.",
    "severity deve ser um de: low, medium, high."
  ].join("\n");
}

export function parseLearningAnalysis(content: string): LearningAnalysis {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return sanitizeLearningAnalysis(parsed, content);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return sanitizeLearningAnalysis(JSON.parse(match[0]) as unknown, content);
      } catch {
        return tutorOnlyFallback(content);
      }
    }
  }

  return tutorOnlyFallback(content);
}

export function sanitizeLearningAnalysis(value: unknown, rawContent = ""): LearningAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return tutorOnlyFallback(rawContent);
  const parsed = value as Record<string, unknown>;
  const assistantReply = typeof parsed.assistant_reply === "string" ? parsed.assistant_reply.trim() : "";
  const corrections = Array.isArray(parsed.corrections)
    ? parsed.corrections.map(sanitizeCorrection).filter((item): item is LearningCorrection => item !== undefined).slice(0, 3)
    : [];
  const words = Array.isArray(parsed.words)
    ? parsed.words.map(sanitizeWord).filter((item): item is LearningWord => item !== undefined).slice(0, 5)
    : [];
  return { assistant_reply: assistantReply || tutorOnlyFallback(rawContent).assistant_reply, corrections, words };
}

function sanitizeCorrection(value: unknown): LearningCorrection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const original = typeof item.original === "string" ? item.original.trim() : "";
  const corrected = typeof item.corrected === "string" ? item.corrected.trim() : "";
  const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
  if (!original || !corrected || original === corrected || !explanation) return undefined;
  return {
    original,
    corrected,
    explanation,
    error_type: normalizeErrorType(typeof item.error_type === "string" ? item.error_type : undefined),
    severity: normalizeSeverity(typeof item.severity === "string" ? item.severity : undefined),
    should_interrupt: typeof item.should_interrupt === "boolean" ? item.should_interrupt : true
  };
}

function sanitizeWord(value: unknown): LearningWord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const displayText = typeof item.display_text === "string" ? item.display_text.trim() : "";
  const lemma = typeof item.lemma === "string" ? item.lemma.trim() : displayText;
  if (!displayText || !lemma) return undefined;
  return {
    display_text: displayText,
    lemma,
    translation: typeof item.translation === "string" ? item.translation.trim() : "",
    part_of_speech: typeof item.part_of_speech === "string" ? item.part_of_speech.trim() : "",
    context: typeof item.context === "string" ? item.context.trim() : "",
    was_correct: typeof item.was_correct === "boolean" ? item.was_correct : true
  };
}

function tutorOnlyFallback(rawContent: string): LearningAnalysis {
  const trimmed = rawContent.trim();
  const isJsonLike = trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("```");
  return {
    assistant_reply: !isJsonLike && trimmed
      ? trimmed
      : "Great effort. Let's keep practicing: can you tell me a little more?",
    corrections: [],
    words: []
  };
}

async function saveCorrections(
  conversation: TeableRecord<ConversationFields>,
  userMessage: TeableRecord<MessageFields>,
  analysis: LearningAnalysis
) {
  const client = getTeableClient();
  const now = new Date().toISOString();
  const corrections = (analysis.corrections ?? [])
    .filter((correction) => correction.original?.trim() && correction.corrected?.trim())
    .slice(0, 3);

  return Promise.all(corrections.map(async (correction) => {
    const original = correction.original?.trim() ?? "";
    const corrected = correction.corrected?.trim() ?? "";
    return client.createRecord<CorrectionFields>("corrections", {
      Name: `${original} -> ${corrected}`.slice(0, 80),
      conversation_id: conversation.id,
      message_id: userMessage.id,
      original_text: original,
      corrected_text: corrected,
      error_type: normalizeErrorType(correction.error_type),
      explanation: correction.explanation?.trim() || "A forma corrigida soa mais natural no contexto.",
      severity: normalizeSeverity(correction.severity),
      should_interrupt: correction.should_interrupt ?? true,
      created_at: now
    });
  }));
}

async function saveWordsAndOccurrences(
  conversation: TeableRecord<ConversationFields>,
  userMessage: TeableRecord<MessageFields>,
  profile: TeableRecord<LanguageProfileFields> | null,
  analysis: LearningAnalysis,
  wasCorrect: boolean
) {
  const client = getTeableClient();
  const existingWords = await client.listRecords<WordFields>("words", 200);
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const words = uniqueWords(analysis.words ?? []).slice(0, 3);

  const saved = await Promise.all(words.map(async (word) => {
    const lemma = normalizeLemma(word.lemma || word.display_text);
    if (!lemma) return null;

    const displayText = word.display_text?.trim() || lemma;
    const existing = existingWords.find(
      (record) =>
        normalizeLemma(record.fields.lemma || record.fields.display_text) === lemma &&
        matchesLearningScope(record.fields, {
          userId: conversation.fields.user_id,
          profileId: profile?.id ?? conversation.fields.language_profile_id
        })
    );

    const wordRecord = existing
      ? await client.updateRecord<WordFields>("words", existing.id, {
          display_text: existing.fields.display_text || displayText,
          translation: existing.fields.translation || word.translation?.trim() || "",
          part_of_speech: existing.fields.part_of_speech || word.part_of_speech?.trim() || "",
          total_uses: Number(existing.fields.total_uses ?? 0) + 1,
          last_used_at: now,
          review_due_at: reviewDue
        })
      : await client.createRecord<WordFields>("words", {
          Name: displayText,
          user_id: conversation.fields.user_id,
          language_profile_id: profile?.id ?? conversation.fields.language_profile_id,
          lemma,
          display_text: displayText,
          translation: word.translation?.trim() || "",
          part_of_speech: word.part_of_speech?.trim() || "",
          familiarity_score: 1,
          total_uses: 1,
          last_used_at: now,
          first_used_at: now,
          review_due_at: reviewDue
        });

    await client.createRecord<WordOccurrenceFields>("wordOccurrences", {
      Name: displayText,
      word_id: wordRecord.id,
      conversation_id: conversation.id,
      message_id: userMessage.id,
      used_text: displayText,
      sentence_context: word.context?.trim() || userMessage.fields.text,
      was_correct: word.was_correct ?? wasCorrect,
      created_at: now
    });

    return wordRecord;
  }));

  return saved.filter((word): word is TeableRecord<WordFields> => word !== null);
}

function uniqueWords(words: NonNullable<LearningAnalysis["words"]>) {
  const seen = new Set<string>();
  return words.filter((word) => {
    const lemma = normalizeLemma(word.lemma || word.display_text);
    if (!lemma || seen.has(lemma)) return false;
    seen.add(lemma);
    return true;
  });
}

function normalizeLemma(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, "") ?? "";
}

function normalizeErrorType(value: string | undefined) {
  const allowed = new Set(["grammar", "vocabulary", "pronunciation", "tense", "preposition", "word_order", "naturalness", "spelling"]);
  const normalized = value?.trim().toLowerCase();
  return normalized && allowed.has(normalized) ? normalized : "grammar";
}

function normalizeSeverity(value: string | undefined) {
  const allowed = new Set(["low", "medium", "high"]);
  const normalized = value?.trim().toLowerCase();
  return normalized && allowed.has(normalized) ? normalized : "medium";
}

function isValidClientRequestId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(value);
}
