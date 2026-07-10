import { describe, expect, it } from "vitest";
import {
  getConversationSummaryAvailability,
  hasCompleteConversationSummaryFeedback,
  isMutableConversationStatus,
  resolveLearningGate,
  selectScopedConversation
} from "../../lib/learning/conversation-state";

describe("learning gate", () => {
  it("requires connections before creating learning data", () => {
    expect(resolveLearningGate({ hasProfile: false, teableReady: false, aiReady: false })).toBe("connections");
    expect(resolveLearningGate({ hasProfile: true, teableReady: true, aiReady: false })).toBe("connections");
  });

  it("requires onboarding after Teable is available", () => {
    expect(resolveLearningGate({ hasProfile: false, teableReady: true, aiReady: true })).toBe("onboarding");
    expect(resolveLearningGate({ hasProfile: true, teableReady: true, aiReady: true })).toBe("ready");
  });
});

describe("conversation lifecycle", () => {
  const conversations = [
    { id: "completed", fields: { user_id: "user-a", language_profile_id: "profile-a", status: "completed", started_at: "2026-07-01T10:00:00.000Z" } },
    { id: "other-user", fields: { user_id: "user-b", language_profile_id: "profile-b", status: "active", started_at: "2026-07-03T10:00:00.000Z" } },
    { id: "active-old", fields: { user_id: "user-a", language_profile_id: "profile-a", status: "active", started_at: "2026-07-02T10:00:00.000Z" } },
    { id: "active-new", fields: { user_id: "user-a", language_profile_id: "profile-a", status: "active", started_at: "2026-07-04T10:00:00.000Z" } }
  ];

  it("only treats active conversations as mutable", () => {
    expect(isMutableConversationStatus("active")).toBe(true);
    expect(isMutableConversationStatus("completed")).toBe(false);
    expect(isMutableConversationStatus("abandoned")).toBe(false);
  });

  it("only exposes a summary after completion and persisted feedback", () => {
    expect(getConversationSummaryAvailability("active", true)).toBe("not_completed");
    expect(getConversationSummaryAvailability("completed", false)).toBe("feedback_pending");
    expect(getConversationSummaryAvailability("completed", true)).toBe("ready");
  });

  it("rejects incomplete persisted feedback", () => {
    expect(
      hasCompleteConversationSummaryFeedback({
        correctionScore: 8,
        newWordsCount: 2,
        recommendedFocus: "Praticar passado simples",
        strengths: "Boa fluidez"
      })
    ).toBe(true);
    expect(
      hasCompleteConversationSummaryFeedback({
        correctionScore: 8,
        newWordsCount: 2,
        recommendedFocus: "",
        strengths: "Boa fluidez"
      })
    ).toBe(false);
  });

  it("selects the newest active conversation only inside the learner scope", () => {
    const selected = selectScopedConversation(conversations, { userId: "user-a", profileId: "profile-a" });
    expect(selected?.id).toBe("active-new");
  });

  it("does not expose a conversation from another learner scope", () => {
    const selected = selectScopedConversation(conversations, { userId: "user-a", profileId: "profile-a" }, "other-user");
    expect(selected).toBeNull();
  });
});
