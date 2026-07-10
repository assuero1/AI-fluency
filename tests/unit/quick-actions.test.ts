import { describe, expect, it } from "vitest";
import { getConversationQuickActionPrompt, normalizeConversationQuickAction } from "../../lib/learning/quick-actions";

describe("conversation quick actions", () => {
  it("accepts only supported interface actions", () => {
    expect(normalizeConversationQuickAction("explain")).toBe("explain");
    expect(normalizeConversationQuickAction("repeat")).toBe("repeat");
    expect(normalizeConversationQuickAction("harder")).toBe("harder");
    expect(normalizeConversationQuickAction("delete")).toBeNull();
  });

  it("keeps action instructions separate from learner messages", () => {
    expect(getConversationQuickActionPrompt("explain")).toContain("Explain your last response");
  });
});
