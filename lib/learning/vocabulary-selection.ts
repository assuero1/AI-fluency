import "server-only";

import { createChatCompletion } from "@/lib/ai/client";
import { getTeableClient, TeableRecord } from "@/lib/teable/client";
import { LearningStateError } from "./access";
import { getConversation, MessageFields, WordFields, WordOccurrenceFields } from "./conversations";
import { matchesLearningScope } from "./scope";
import { addSavedWordsToDailyFeedback } from "./feedback";

export type VocabularyCandidate = {
  id: string;
  text: string;
  normalized: string;
  source: "user" | "assistant";
  messageId: string;
  context: string;
};

export function extractVocabularyCandidates(messages: TeableRecord<MessageFields>[]) {
  const seen = new Set<string>();
  const candidates: VocabularyCandidate[] = [];
  for (const message of messages) {
    if (message.fields.role !== "user" && message.fields.role !== "assistant") continue;
    for (const match of message.fields.text.matchAll(/[\p{L}À-ÿ]+(?:['’][\p{L}À-ÿ]+)*/gu)) {
      const text = match[0];
      const normalized = text.normalize("NFC").toLocaleLowerCase();
      const key = `${message.fields.role}:${normalized}`;
      if (normalized.length < 2 || seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: `${message.id}:${normalized}`,
        text,
        normalized,
        source: message.fields.role,
        messageId: message.id,
        context: message.fields.text
      });
    }
  }
  return candidates;
}

export async function saveSelectedVocabulary(conversationId: string, candidateIds: string[]) {
  const context = await getConversation(conversationId);
  if (!context) throw new LearningStateError("Conversa não encontrada.", 404);
  if (context.conversation.fields.status !== "completed") {
    throw new LearningStateError("Finalize a conversa antes de salvar palavras.", 409);
  }
  const allowed = new Map(extractVocabularyCandidates(context.messages).map((item) => [item.id, item]));
  const selected = [...new Set(candidateIds)].map((id) => allowed.get(id)).filter((item): item is VocabularyCandidate => Boolean(item)).slice(0, 80);
  if (!selected.length) throw new LearningStateError("Selecione ao menos uma palavra.", 400);

  const client = getTeableClient();
  const [existingWords, occurrences, translations] = await Promise.all([
    client.listRecords<WordFields>("words", 500),
    client.listRecords<WordOccurrenceFields>("wordOccurrences", 800),
    translateVocabulary(selected.map((item) => item.text), context.profile?.fields.language_code ?? "auto")
  ]);
  const now = new Date().toISOString();
  const reviewDue = new Date(Date.now() + 7 * 86400000).toISOString();
  let savedCount = 0;

  for (const candidate of selected) {
    const duplicate = occurrences.some((item) =>
      item.fields.conversation_id === conversationId && item.fields.message_id === candidate.messageId &&
      item.fields.used_text.toLocaleLowerCase() === candidate.normalized
    );
    if (duplicate) continue;
    let word = existingWords.find((item) =>
      (item.fields.lemma || item.fields.display_text).toLocaleLowerCase() === candidate.normalized &&
      matchesLearningScope(item.fields, { userId: context.conversation.fields.user_id, profileId: context.conversation.fields.language_profile_id })
    );
    if (word) {
      word = await client.updateRecord<WordFields>("words", word.id, {
        total_uses: Number(word.fields.total_uses ?? 0) + 1,
        last_used_at: now,
        review_due_at: reviewDue
      });
    } else {
      word = await client.createRecord<WordFields>("words", {
        Name: candidate.text,
        user_id: context.conversation.fields.user_id,
        language_profile_id: context.conversation.fields.language_profile_id,
        lemma: candidate.normalized,
        display_text: candidate.text,
        translation: translations[candidate.normalized] ?? "",
        part_of_speech: "",
        familiarity_score: 1,
        total_uses: 1,
        last_used_at: now,
        first_used_at: now,
        review_due_at: reviewDue
      });
      existingWords.push(word);
    }
    await client.createRecord<WordOccurrenceFields>("wordOccurrences", {
      Name: candidate.text,
      word_id: word.id,
      conversation_id: conversationId,
      message_id: candidate.messageId,
      used_text: candidate.text,
      sentence_context: candidate.context,
      was_correct: true,
      created_at: now
    });
    savedCount += 1;
  }
  await addSavedWordsToDailyFeedback(context.conversation, savedCount);
  return { savedCount };
}

async function translateVocabulary(words: string[], language: string) {
  const unique = [...new Set(words.map((word) => word.toLocaleLowerCase()))];
  try {
    const response = await createChatCompletion([
      { role: "system", content: "Traduza palavras para português brasileiro. Responda somente JSON: um objeto cujas chaves são exatamente as palavras recebidas em minúsculas e os valores são traduções curtas." },
      { role: "user", content: `Idioma: ${language}\nPalavras: ${JSON.stringify(unique)}` }
    ], { temperature: 0, maxTokens: 900 });
    const match = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {} as Record<string, string>;
  }
}
