import { describe, expect, it } from "vitest";
import {
  getMessageGoalProgress,
  isPracticeChannel,
  normalizeStoredInteractionMode,
  normalizeStoredMessageTarget
} from "../../lib/learning/chat-contracts";

describe("chat contracts", () => {
  it("treats legacy records as conversation/practice without a goal", () => {
    expect(normalizeStoredInteractionMode(undefined)).toBe("conversation");
    expect(isPracticeChannel(undefined)).toBe(true);
    expect(normalizeStoredMessageTarget(undefined)).toBe(0);
  });

  it("counts only learner messages from the practice channel", () => {
    const messages = [
      { fields: { role: "assistant", channel: "practice" } },
      { fields: { role: "user", channel: "practice" } },
      { fields: { role: "user", channel: "teacher" } },
      { fields: { role: "assistant", channel: "teacher" } },
      { fields: { role: "user" } }
    ];
    expect(getMessageGoalProgress(messages, 3)).toEqual({
      enabled: true,
      sent: 2,
      target: 3,
      remaining: 1,
      reached: false,
      percent: 67
    });
  });

  it("keeps a completed goal at 100 percent when the learner continues", () => {
    const messages = Array.from({ length: 7 }, () => ({ fields: { role: "user", channel: "practice" } }));
    expect(getMessageGoalProgress(messages, 5)).toMatchObject({ sent: 7, remaining: 0, reached: true, percent: 100 });
  });
});
