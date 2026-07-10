import { describe, expect, it } from "vitest";
import { formatPracticeStreak, getPracticeActivity } from "../../lib/learning/practice-activity";

describe("practice activity", () => {
  const now = new Date("2026-07-10T15:00:00.000Z");

  it("continues a streak from yesterday when today has not been practiced yet", () => {
    const activity = getPracticeActivity([
      "2026-07-09T12:00:00.000Z",
      "2026-07-08T12:00:00.000Z"
    ], { now, timeZone: "UTC" });

    expect(activity.streak).toBe(2);
    expect(activity.practicedToday).toBe(false);
  });

  it("counts one day only once and respects the learner timezone", () => {
    const activity = getPracticeActivity([
      "2026-07-10T01:30:00.000Z",
      "2026-07-10T02:30:00.000Z"
    ], { now: new Date("2026-07-10T13:00:00.000Z"), timeZone: "America/Sao_Paulo" });

    expect(activity.streak).toBe(1);
    expect(activity.practicedToday).toBe(false);
  });

  it("formats the learner-facing streak label", () => {
    expect(formatPracticeStreak(1)).toBe("1 dia");
    expect(formatPracticeStreak(4)).toBe("4 dias");
  });
});
