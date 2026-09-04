import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialComboState, comboAfterAnswer, comboSoundForStreak } from "@/lib/client/combo-tracker";
import { classifyWordRarity } from "@/lib/learning/word-rarity";
import { detectHuntWordsInMessage, parseHuntWords } from "@/lib/learning/word-hunting";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Trio de Ouro: Mecânica 1 — Combos em Chamas", () => {
  it("escalona os sons de combo de 1 até 5+", () => {
    expect(comboSoundForStreak(1)).toBe("combo_1");
    expect(comboSoundForStreak(2)).toBe("combo_2");
    expect(comboSoundForStreak(3)).toBe("combo_3");
    expect(comboSoundForStreak(4)).toBe("combo_4");
    expect(comboSoundForStreak(5)).toBe("combo_5");
    expect(comboSoundForStreak(10)).toBe("combo_5");
  });

  it("ativa o estado onFire a partir de 5 acertos seguidos", () => {
    let state = initialComboState();
    expect(state.onFire).toBe(false);

    for (let i = 1; i <= 4; i++) {
      state = comboAfterAnswer(state, true);
      expect(state.onFire).toBe(false);
    }

    state = comboAfterAnswer(state, true);
    expect(state.streak).toBe(5);
    expect(state.onFire).toBe(true);

    state = comboAfterAnswer(state, false);
    expect(state.streak).toBe(0);
    expect(state.onFire).toBe(false);
    expect(state.maxStreak).toBe(5);
  });

  it("integra visual de chamas no FlashcardTrainer e no globals.css", () => {
    const trainer = read("components/FlashcardTrainer.tsx");
    expect(trainer).toContain("combo.onFire ? \" on-fire\" : \"\"");
    expect(trainer).toContain("combo-badge");

    const css = read("app/globals.css");
    expect(css).toContain(".active-recall-card.on-fire");
    expect(css).toContain(".combo-badge.on-fire");
  });
});

describe("Trio de Ouro: Mecânica 2 — Unboxing de Palavras", () => {
  it("classifica a raridade determinística de vocabulário", () => {
    expect(classifyWordRarity({ lemma: "water" }).rarity).toBe("essential");
    expect(classifyWordRarity({ lemma: "figure out" }).rarity).toBe("native_expression");
    expect(classifyWordRarity({ lemma: "ubiquitous" }).rarity).toBe("power_word");
  });

  it("integra UnboxingCard e fase de revelação no NewWordsTrainer", () => {
    const trainer = read("components/NewWordsTrainer.tsx");
    expect(trainer).toContain("<UnboxingCard");
    expect(trainer).toContain("revealPhase");
    expect(trainer).toContain("unboxing-grid");
    expect(trainer).toContain("cartas reveladas");
  });
});

describe("Trio de Ouro: Mecânica 3 — Word Hunting no Chat", () => {
  it("detecta palavras-alvo e suas formas flexionadas na mensagem", () => {
    const huntWords = [
      { wordId: "w1", lemma: "give up", translation: "desistir", forms: ["gave up", "giving up"] }
    ];
    const found = detectHuntWordsInMessage("I am not giving up now!", huntWords);
    expect(found.length).toBe(1);
    expect(found[0].wordId).toBe("w1");
    expect(parseHuntWords(huntWords)).toHaveLength(1);
  });

  it("integra o HUD de missão e toast de caça no ChatConversation", () => {
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("<HuntWordsMission");
    expect(chat).toContain("huntToast");
    expect(chat).toContain("golden-trigger");
    expect(chat).toContain("highlightHuntWords");
  });
});

describe("Trio de Ouro: Loop de Conexão Transversal", () => {
  it("oferece atalho de palavras novas após sessão perfeita de SRS", () => {
    const trainer = read("components/FlashcardTrainer.tsx");
    expect(trainer).toContain("result.score >= 80");
    expect(trainer).toContain("/palavras/novas");
  });

  it("oferece atalho com huntWordIds no NewWordsTrainer após adotar palavras", () => {
    const trainer = read("components/NewWordsTrainer.tsx");
    expect(trainer).toContain("/chat?huntWordIds=");
  });

  it("reforça consolidação de memória no ResumoPracticeCta (efeito Zeigarnik)", () => {
    const cta = read("components/ResumoPracticeCta.tsx");
    expect(cta).toContain("resumo-zeigarnik-card");
    expect(cta).toContain("precisa");
    expect(cta).toContain("de reforço");
    expect(cta).toContain("próximas 24h");
  });

  it("renderiza a Trilha do Dia com os 3 passos na HomeDashboard", () => {
    const home = read("components/HomeDashboard.tsx");
    expect(home).toContain("<DailyTrailCard");

    const trail = read("components/DailyTrailCard.tsx");
    expect(trail).toContain("Palavras Novas");
    expect(trail).toContain("Conversar com IA");
    expect(trail).toContain("Revisão Inteligente");

    const homeLib = read("lib/learning/home.ts");
    expect(homeLib).toContain("newWordsDone");
    expect(homeLib).toContain("conversationDone");
    expect(homeLib).toContain("reviewDone");
  });
});
