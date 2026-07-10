import { describe, expect, it } from "vitest";
import { isLearningHistoryEventInScope, type LearningHistoryEventScope } from "../../lib/learning/account";

const scope: LearningHistoryEventScope = {
  profileId: "profile-en",
  conversationIds: new Set(["conversation-en"]),
  topicIds: new Set(["topic-en"]),
  wordIds: new Set(["word-en"]),
  feedbackIds: new Set(["feedback-en"])
};

describe("learning history privacy", () => {
  it("selects events that belong to the active language history", () => {
    expect(isLearningHistoryEventInScope({ payload: JSON.stringify({ language_profile_id: "profile-en" }) }, scope)).toBe(true);
    expect(isLearningHistoryEventInScope({ payload: JSON.stringify({ conversation_id: "conversation-en" }) }, scope)).toBe(true);
    expect(isLearningHistoryEventInScope({ payload: JSON.stringify({ word_ids: ["word-en"] }) }, scope)).toBe(true);
  });

  it("preserves settings and events from other languages", () => {
    expect(isLearningHistoryEventInScope({ event_name: "preferences_updated", payload: JSON.stringify({ fields: ["audio_enabled"] }) }, scope)).toBe(false);
    expect(isLearningHistoryEventInScope({ payload: JSON.stringify({ language_profile_id: "profile-es", conversation_id: "conversation-es" }) }, scope)).toBe(false);
    expect(isLearningHistoryEventInScope({ payload: JSON.stringify({ language_profile_id: "profile-es", conversation_id: "conversation-en" }) }, scope)).toBe(false);
    expect(isLearningHistoryEventInScope({ payload: "invalid-json" }, scope)).toBe(false);
  });
});
