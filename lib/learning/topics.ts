import { createChatCompletion } from "@/lib/ai/client";
import { getHomeData, HomeSuggestion, TopicFields } from "./home";
import { assertPracticeReady } from "./access";

type AiTopicSuggestion = {
  title?: string;
  reason?: string;
  difficulty?: string;
  focus?: string;
};

export async function createTopic(input: {
  title: string;
  source?: string;
  reason?: string;
  difficulty?: string;
  relatedFeedbackId?: string;
  relatedWords?: string;
}) {
  const { client, user, profile } = await assertPracticeReady();
  const title = input.title.trim() || "Conversa livre";
  const now = new Date().toISOString();

  const topic = await client.createRecord<TopicFields>("topics", {
    Name: title,
    user_id: user.id,
    language_profile_id: profile.id,
    title,
    source: input.source ?? "user_custom",
    reason: input.reason ?? "",
    related_feedback_id: input.relatedFeedbackId ?? "",
    related_words: input.relatedWords ?? "",
    difficulty: normalizeDifficulty(input.difficulty ?? profile.fields.level) ?? "B1",
    created_at: now
  });

  await client.createEvent(user.id, "topic_created", {
    topic_id: topic.id,
    title,
    source: input.source ?? "user_custom"
  });

  return { user, profile, topic };
}

export async function suggestTopic() {
  const home = await getHomeData();
  const profile = home.profile;

  const prompt = [
    `Idioma alvo: ${profile?.languageName ?? "Inglês"}`,
    `Nível: ${profile?.level ?? "Intermediário (B1)"}`,
    `Objetivo: ${profile?.learningGoal ?? "Falar com naturalidade"}`,
    `Foco recente: ${home.profile?.calendarMemoryEnabled === false ? "Não use memória do calendário; priorize o objetivo atual." : home.feedback.recentFocus}`,
    `Palavra recente: ${home.words.mostRecent?.displayText ?? "Nenhuma palavra registrada ainda."}`,
    "Sugira 1 tema de conversa útil para a próxima sessão.",
    "Responda somente JSON válido com: title, reason, difficulty, focus."
  ].join("\n");

  const ai = await createChatCompletion(
    [
      {
        role: "system",
        content:
          "Você é um designer pedagógico de um app de aprendizado de línguas. Sugira temas curtos, práticos e acionáveis."
      },
      { role: "user", content: prompt }
    ],
    { temperature: 0.5, maxTokens: 320 }
  );

  const parsed = parseAiTopic(ai.content);
  const title = parsed.title ?? fallbackSuggestion(home.suggestions).title;
  const reason = parsed.reason ?? parsed.focus ?? "Sugerido pela IA com base no seu perfil e histórico recente.";

  const created = await createTopic({
    title,
    source: "ai_suggestion",
    reason,
    difficulty: normalizeDifficulty(parsed.difficulty ?? profile?.level) ?? "B1"
  });

  return {
    topic: created.topic,
    suggestion: {
      id: created.topic.id,
      title,
      meta: reason,
      badge: "Recomendado",
      tone: "primary",
      source: "ai_suggestion",
      reason
    } satisfies HomeSuggestion,
    ai: {
      provider: ai.provider,
      model: ai.model,
      tokensUsed: ai.tokensUsed
    }
  };
}

function parseAiTopic(content: string): AiTopicSuggestion {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as AiTopicSuggestion;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function fallbackSuggestion(suggestions: HomeSuggestion[]) {
  return suggestions[0] ?? { title: "Conversa livre", reason: "Prática aberta para aquecer." };
}

function normalizeDifficulty(value: string | undefined) {
  const match = value?.toUpperCase().match(/[ABC][12]/);
  return match?.[0];
}
