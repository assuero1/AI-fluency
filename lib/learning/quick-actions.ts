export const conversationQuickActions = ["explain", "repeat", "harder"] as const;
export type ConversationQuickAction = (typeof conversationQuickActions)[number];

const prompts: Record<ConversationQuickAction, string> = {
  explain: "Explain your last response more clearly. Use Portuguese for the explanation and include one short example in the target language.",
  repeat: "Repeat your last response in a different, simpler way without changing the learning goal.",
  harder: "Continue the dialogue at a slightly more challenging level while staying natural and on topic. Contribute a richer idea or example; ask a question only if it genuinely helps the conversation."
};

export function normalizeConversationQuickAction(value: unknown): ConversationQuickAction | null {
  return conversationQuickActions.includes(value as ConversationQuickAction) ? (value as ConversationQuickAction) : null;
}

export function getConversationQuickActionPrompt(action: ConversationQuickAction) {
  return prompts[action];
}
