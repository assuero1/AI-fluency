export const ACTIVE_CONVERSATION_STATUS = "active";
export const COMPLETED_CONVERSATION_STATUS = "completed";
export const ABANDONED_CONVERSATION_STATUS = "abandoned";

export type LearningGate = "ready" | "onboarding" | "connections";

export function resolveLearningGate(input: { hasProfile: boolean; teableReady: boolean; aiReady: boolean }): LearningGate {
  if (!input.teableReady) return "connections";
  if (!input.hasProfile) return "onboarding";
  return input.aiReady ? "ready" : "connections";
}

export function isMutableConversationStatus(status: string | undefined) {
  return status === ACTIVE_CONVERSATION_STATUS;
}

export type ConversationSummaryAvailability = "ready" | "not_completed" | "feedback_pending";

export function getConversationSummaryAvailability(
  status: string | undefined,
  hasCompleteDailyFeedback: boolean
): ConversationSummaryAvailability {
  if (status !== COMPLETED_CONVERSATION_STATUS) return "not_completed";
  return hasCompleteDailyFeedback ? "ready" : "feedback_pending";
}

export function hasCompleteConversationSummaryFeedback(input: {
  correctionScore?: number;
  newWordsCount?: number;
  recommendedFocus?: string;
  strengths?: string;
}) {
  return (
    Number.isFinite(input.correctionScore) &&
    Number.isFinite(input.newWordsCount) &&
    Boolean(input.strengths?.trim()) &&
    Boolean(input.recommendedFocus?.trim())
  );
}

export type ConversationScopeRecord<TFields extends { user_id: string; language_profile_id: string; status: string; started_at: string }> = {
  id: string;
  fields: TFields;
};

export function selectScopedConversation<TFields extends { user_id: string; language_profile_id: string; status: string; started_at: string }>(
  conversations: ConversationScopeRecord<TFields>[],
  scope: { userId: string; profileId: string },
  conversationId?: string
) {
  const scoped = conversations.filter(
    (conversation) =>
      conversation.fields.user_id === scope.userId && conversation.fields.language_profile_id === scope.profileId
  );

  if (conversationId) return scoped.find((conversation) => conversation.id === conversationId) ?? null;

  return (
    scoped
      .filter((conversation) => isMutableConversationStatus(conversation.fields.status))
      .sort((left, right) => Date.parse(right.fields.started_at) - Date.parse(left.fields.started_at))[0] ?? null
  );
}
