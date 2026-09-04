import { describe, expect, it } from "vitest";
import { languages } from "@/data/mock";
import { DEFAULT_KOKORO_VOICES, selectKokoroVoice } from "@/lib/kokoro/voices";
import { compareFlashcardAnswer, normalizeFlashcardAnswer } from "@/lib/learning/flashcard-answer";
import {
  countLexicalWords,
  lexicalTokens,
  replaceTargetWithBlank,
  targetOccurrenceCount
} from "@/lib/learning/sentence-validation";
import {
  isVocabularyStopword,
  normalizeVocabularyToken
} from "@/lib/learning/vocabulary-selection";

describe("Multilingual Support: Japanese, Mandarin and Hindi", () => {
  describe("languages list and onboarding metadata", () => {
    it("includes JA, ZH and HI in available languages", () => {
      const codes = languages.map((lang) => lang.code);
      expect(codes).toContain("JA");
      expect(codes).toContain("ZH");
      expect(codes).toContain("HI");
    });
  });

  describe("Kokoro voices configuration", () => {
    it("has default voices configured for ja, zh, hi", () => {
      expect(DEFAULT_KOKORO_VOICES).toHaveProperty("ja", "jf_alpha");
      expect(DEFAULT_KOKORO_VOICES).toHaveProperty("zh", "zf_xiaobei");
      expect(DEFAULT_KOKORO_VOICES).toHaveProperty("hi", "hf_alpha");
    });

    it("selects native voice by language code", () => {
      expect(selectKokoroVoice("ja", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("jf_alpha");
      expect(selectKokoroVoice("zh", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("zf_xiaobei");
      expect(selectKokoroVoice("hi", DEFAULT_KOKORO_VOICES, "af_heart")).toBe("hf_alpha");
    });
  });

  describe("Devanagari preservation and token normalization", () => {
    it("does not strip Devanagari vowel signs (matras) or ligatures", () => {
      // "नमस्ते" (namaste) must NOT be stripped to "नमसत"
      expect(normalizeVocabularyToken("नमस्ते")).toBe("नमस्ते");
      expect(normalizeVocabularyToken("हिंदी")).toBe("हिंदी");
      expect(normalizeVocabularyToken("पानी")).toBe("पानी");
      expect(normalizeVocabularyToken("किताब")).toBe("किताब");
    });

    it("still strips Latin diacritics as expected", () => {
      expect(normalizeVocabularyToken("café")).toBe("cafe");
      expect(normalizeVocabularyToken("mañana")).toBe("manana");
      expect(normalizeVocabularyToken("français")).toBe("francais");
    });

    it("preserves Japanese and Chinese characters intact", () => {
      expect(normalizeVocabularyToken("日本語")).toBe("日本語");
      expect(normalizeVocabularyToken("食べる")).toBe("食べる");
      expect(normalizeVocabularyToken("中文")).toBe("中文");
      expect(normalizeVocabularyToken("谢谢")).toBe("谢谢");
    });
  });

  describe("Stopwords filtering for JA, ZH and HI", () => {
    it("identifies grammatical particles as stopwords", () => {
      expect(isVocabularyStopword("は", "ja")).toBe(true);
      expect(isVocabularyStopword("の", "ja")).toBe(true);
      expect(isVocabularyStopword("的", "zh")).toBe(true);
      expect(isVocabularyStopword("了", "zh")).toBe(true);
      expect(isVocabularyStopword("का", "hi")).toBe(true);
      expect(isVocabularyStopword("में", "hi")).toBe(true);
    });

    it("does not flag substantive content words as stopwords", () => {
      expect(isVocabularyStopword("りんご", "ja")).toBe(false);
      expect(isVocabularyStopword("苹果", "zh")).toBe(false);
      expect(isVocabularyStopword("सेब", "hi")).toBe(false);
    });
  });

  describe("Sentence validation and CJK token matching", () => {
    it("counts occurrences in CJK sentences without spaces", () => {
      expect(targetOccurrenceCount("私はりんごを食べます", "りんご")).toBe(1);
      expect(targetOccurrenceCount("我喜欢吃苹果", "苹果")).toBe(1);
      expect(targetOccurrenceCount("今日はいい天気ですね", "りんご")).toBe(0);
    });

    it("counts occurrences in Hindi sentences", () => {
      expect(targetOccurrenceCount("मैं सेब खाता हूँ", "सेब")).toBe(1);
      expect(targetOccurrenceCount("मैं केला खाता हूँ", "सेब")).toBe(0);
    });

    it("replaces target with blank in CJK sentences without inserting extra spaces", () => {
      expect(replaceTargetWithBlank("私はりんごを食べます", "りんご")).toBe("私は___を食べます");
      expect(replaceTargetWithBlank("我喜欢吃苹果", "苹果")).toBe("我喜欢吃___");
    });

    it("segments CJK words using Intl.Segmenter", () => {
      const tokens = lexicalTokens("私は学生です");
      expect(tokens).toContain("私");
      expect(tokens).toContain("学生");
      expect(countLexicalWords("私は学生です")).toBeGreaterThan(1);
    });
  });

  describe("Flashcard answer comparison for non-Latin scripts", () => {
    it("accepts exact matches in Japanese, Chinese and Hindi", () => {
      expect(compareFlashcardAnswer("りんご", "りんご")).toBe("exact");
      expect(compareFlashcardAnswer("苹果", "苹果")).toBe("exact");
      expect(compareFlashcardAnswer("नमस्ते", "नमस्ते")).toBe("exact");
    });

    it("tolerates peripheral full-width and native punctuation", () => {
      expect(normalizeFlashcardAnswer("りんご。")).toBe("りんご");
      expect(normalizeFlashcardAnswer("苹果！")).toBe("苹果");
      expect(normalizeFlashcardAnswer("नमस्ते।")).toBe("नमस्ते");
    });

    it("does not destroy Hindi answers during comparison", () => {
      expect(compareFlashcardAnswer("किताब", "किताब")).toBe("exact");
      expect(compareFlashcardAnswer("पानी", "पानी")).toBe("exact");
    });
  });
});
