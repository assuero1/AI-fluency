import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRateLimitRules,
  checkRateLimit,
  matchApiRateLimitRule,
  resetRateLimitsForTests
} from "../../lib/api/rate-limit";

describe("api rate limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitsForTests();
  });

  it("allows requests under the limit and reports the remaining budget", () => {
    const first = checkRateLimit("user-a:voice-synthesize", 2);
    expect(first).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    const second = checkRateLimit("user-a:voice-synthesize", 2);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it("blocks over the limit with a Retry-After pointing at the next window", () => {
    vi.setSystemTime(60_000_000); // múltiplo de 60s: janela recém-aberta
    checkRateLimit("user-a:chat-message", 1);
    const blocked = checkRateLimit("user-a:chat-message", 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("keys buckets per user and rule, not globally", () => {
    checkRateLimit("user-a:voice-synthesize", 1);
    const otherUser = checkRateLimit("user-b:voice-synthesize", 1);
    expect(otherUser.allowed).toBe(true);
    const otherRule = checkRateLimit("user-a:translate", 1);
    expect(otherRule.allowed).toBe(true);
  });

  it("starts a fresh window after the minute turns over", () => {
    checkRateLimit("user-a:voice-synthesize", 1);
    const blocked = checkRateLimit("user-a:voice-synthesize", 1);
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    const next = checkRateLimit("user-a:voice-synthesize", 1);
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(0);
  });

  it("matches every audited expensive route with a rule", () => {
    const expected: Array<[string, string]> = [
      ["/api/voice/synthesize", "voice-synthesize"],
      ["/api/voice/captioned", "voice-synthesize"],
      ["/api/voice/9f2c1d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d", "voice-audio"],
      ["/api/conversations/abc/messages", "chat-message"],
      ["/api/conversations/abc/teacher", "teacher-question"],
      ["/api/translate", "translate"],
      ["/api/explain-selection", "explain-selection"],
      ["/api/topics/suggest", "topics-suggest"],
      ["/api/practice/flashcards", "flashcards-create"],
      ["/api/settings/test-ai", "settings-test"],
      ["/api/settings/test-kokoro", "settings-test"],
      ["/api/settings/test-supabase", "settings-test"]
    ];
    for (const [pathname, expectedName] of expected) {
      expect(matchApiRateLimitRule(pathname)?.name).toBe(expectedName);
    }
  });

  it("new-words-judge tem teto de 60/min e cobre judge/complete/abandon", () => {
    const rule = matchApiRateLimitRule("/api/practice/new-words/judge");
    expect(rule?.name).toBe("new-words-judge");
    expect(rule?.limitPerMinute).toBe(60);
    expect(matchApiRateLimitRule("/api/practice/new-words/complete")?.name).toBe("new-words-judge");
    expect(matchApiRateLimitRule("/api/practice/new-words")?.name).toBe("new-words-create");
  });

  it("leaves cheap and non-API paths alone", () => {
    expect(matchApiRateLimitRule("/api/profile")).toBeNull();
    expect(matchApiRateLimitRule("/api/words")).toBeNull();
    expect(matchApiRateLimitRule("/api/voice")).toBeNull(); // sem id: nem regra de áudio
    expect(matchApiRateLimitRule("/chat")).toBeNull();
  });

  it("orders rules so the audio GET does not shadow the synthesize POSTs", () => {
    // /api/voice/synthesize precisa casar ANTES da regra geral de áudio.
    const synthesize = apiRateLimitRules.findIndex((rule) => rule.name === "voice-synthesize");
    const audio = apiRateLimitRules.findIndex((rule) => rule.name === "voice-audio");
    expect(synthesize).toBeGreaterThanOrEqual(0);
    expect(audio).toBeGreaterThan(synthesize);
  });
});
