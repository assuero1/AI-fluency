import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * Contratos do conserto do áudio no auricular (iOS) e do áudio errado entre
 * cards: o TTS do chat/treino precisa sair no alto-falante depois do ditado, e
 * o botão de ouvir precisa tocar o conteúdo da tela atual.
 */
describe("audio route contracts", () => {
  it("releases the mic route when flashcard dictation ends, errors, or the screen unmounts", () => {
    const trainer = read("components/FlashcardTrainer.tsx");
    expect(trainer).toContain('import { releaseMicForPlayback } from "@/lib/learning/speech"');
    // onend + onerror do ditado e o cleanup de unmount.
    expect(trainer.match(/releaseMicForPlayback\(\)/g)).toHaveLength(3);
  });

  it("keeps the chat releasing the mic route on recognition teardown", () => {
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("finishRecognitionSession");
    expect(chat).toContain("releaseMicForPlayback()");
  });

  it("nudges the route through an element unlocked inside a user gesture", () => {
    const speech = read("lib/learning/speech.ts");
    expect(speech).toContain("export function prepareRouteNudgeElement");
    expect(speech).toContain("routeNudgeAudio ??= new Audio()");
    // Mute/volume 0 fazem o iOS pular a seleção de rota; o nudge toca o WAV
    // silencioso com volume real.
    expect(speech).toMatch(/nudgePlaybackRoute[\s\S]*audio\.muted = false;[\s\S]*audio\.volume = 1;/);
    const shared = read("components/voice-shared.ts");
    expect(shared).toContain("prepareRouteNudgeElement()");
  });

  it("waits long enough for the iOS route to restore before the next playback", () => {
    expect(read("lib/learning/speech.ts")).toContain("const AUDIO_ROUTE_RESTORE_MS = 800;");
  });

  it("discards the previous card audio when the VoiceButton text changes", () => {
    const button = read("components/VoiceButton.tsx");
    expect(button).toContain("const textRef = useRef(text);");
    expect(button).toContain("if (textRef.current !== requestedText) return null;");
    expect(button).toMatch(/textRef\.current = text;[\s\S]*releaseAudio\(\);[\s\S]*\}, \[releaseAudio, text\]\)/);
  });
});
