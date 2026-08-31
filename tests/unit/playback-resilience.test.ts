import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createStallTracker,
  samplePlaybackStall,
  unlockAudioForPlayback
} from "@/components/voice-shared";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

type FakeAudio = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  duration: number;
  currentTime: number;
  muted: boolean;
  play: () => Promise<void>;
};

function fakeAudio(overrides: Partial<FakeAudio> = {}): FakeAudio {
  return {
    paused: false,
    ended: false,
    readyState: 3,
    duration: 10,
    currentTime: 5,
    muted: false,
    play: () => Promise.resolve(),
    ...overrides
  };
}

function runFrames(audio: FakeAudio, frames: number, giveUp: () => void = vi.fn()) {
  const tracker = createStallTracker();
  for (let frame = 0; frame < frames; frame += 1) {
    samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
  }
  return tracker;
}

/** Watchdog: "tocando" com dados prontos e posição congelada ~1s precisa ser
 * chutado (re-seek + play), como faz o botão de avançar. */
describe("playback stall watchdog", () => {
  it("recovers a frozen playing element after ~1s without progress", () => {
    const play = vi.fn(() => Promise.resolve());
    const audio = fakeAudio({ play });
    const giveUp = vi.fn();
    const tracker = runFrames(audio, 70, giveUp);

    expect(play).toHaveBeenCalledTimes(1);
    // O re-seek minúsculo para trás é o que destrava o motor do WebKit.
    expect(audio.currentTime).toBeCloseTo(4.95, 5);
    expect(tracker.attempts).toBe(1);
    expect(giveUp).not.toHaveBeenCalled();
  });

  it("does not recover while the position keeps advancing", () => {
    const play = vi.fn(() => Promise.resolve());
    const audio = fakeAudio({ play });
    const giveUp = vi.fn();
    const tracker = createStallTracker();
    for (let frame = 0; frame < 120; frame += 1) {
      audio.currentTime = 5 + frame * 0.02;
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
    }
    expect(play).not.toHaveBeenCalled();
    expect(giveUp).not.toHaveBeenCalled();
  });

  it("does not recover while paused, ended, buffering, or at the end of the track", () => {
    const giveUp = vi.fn();
    const variants: FakeAudio[] = [
      fakeAudio({ paused: true }),
      fakeAudio({ ended: true }),
      fakeAudio({ readyState: 2 }),
      fakeAudio({ currentTime: 9.98 })
    ];
    for (const audio of variants) {
      const play = vi.fn(() => Promise.resolve());
      audio.play = play;
      runFrames(audio, 120, giveUp);
      expect(play).not.toHaveBeenCalled();
    }
  });

  it("ignores the watchdog when the UI is not showing playing", () => {
    const play = vi.fn(() => Promise.resolve());
    const audio = fakeAudio({ play });
    const tracker = createStallTracker();
    for (let frame = 0; frame < 120; frame += 1) {
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, false, vi.fn());
    }
    expect(play).not.toHaveBeenCalled();
    expect(tracker.frames).toBe(0);
  });

  it("gives up after 3 recovery attempts and stays calm afterwards", async () => {
    const play = vi.fn(() => Promise.reject(new Error("rejected")));
    const audio = fakeAudio({ play });
    const giveUp = vi.fn();
    const tracker = runFrames(audio, 4 * 61, giveUp);
    await Promise.resolve();

    expect(play).toHaveBeenCalledTimes(3);
    expect(giveUp).toHaveBeenCalledTimes(1);
    expect(tracker.gaveUp).toBe(true);
    // Depois de desistir, não tenta de novo até a posição voltar a andar
    // (mesmo tracker: episódio ainda aberto).
    const playCallsAfterGiveUp = play.mock.calls.length;
    for (let frame = 0; frame < 120; frame += 1) {
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
    }
    expect(play.mock.calls.length).toBe(playCallsAfterGiveUp);
  });

  it("starts a fresh episode once the position advances again", async () => {
    let rejectFirst = true;
    const play = vi.fn(() => {
      if (rejectFirst) {
        rejectFirst = false;
        return Promise.reject(new Error("rejected"));
      }
      return Promise.resolve();
    });
    const audio = fakeAudio({ play });
    const giveUp = vi.fn();
    const tracker = createStallTracker();
    // Episódio 1: congela, leva 1 recuperação rejeitada…
    for (let frame = 0; frame < 61; frame += 1) {
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
    }
    await Promise.resolve();
    expect(tracker.attempts).toBe(1);
    // …e a posição volta a andar: orçamento zerado.
    for (let frame = 0; frame < 10; frame += 1) {
      audio.currentTime += 0.05;
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
    }
    expect(tracker.attempts).toBe(0);
    // Episódio 2: congela de novo e recupera de novo, sem desistir.
    audio.currentTime = 8;
    for (let frame = 0; frame < 61; frame += 1) {
      samplePlaybackStall(audio as unknown as HTMLAudioElement, tracker, true, giveUp);
    }
    expect(play).toHaveBeenCalledTimes(2);
    expect(giveUp).not.toHaveBeenCalled();
  });
});

/** O destravamento do gesto não pode pausar um play legítimo emitido depois
 * dele — era isso que deixava a bolha "tocando" sem som. */
describe("gesture unlock cancellation", () => {
  it("pauses its own muted attempt when nobody cancels (comportamento original)", async () => {
    let settle!: () => void;
    const play = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    const audio = {
      src: "",
      currentTime: 0,
      muted: false,
      play,
      pause: vi.fn()
    };
    unlockAudioForPlayback(audio as unknown as HTMLAudioElement);
    settle();
    await Promise.resolve();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.muted).toBe(false);
  });

  it("does not pause a real play issued after the unlock was cancelled", async () => {
    let settle!: () => void;
    const play = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    const audio = {
      src: "blob:track",
      currentTime: 3.2,
      muted: false,
      play,
      pause: vi.fn()
    };
    const handle = unlockAudioForPlayback(audio as unknown as HTMLAudioElement);
    handle.cancel();
    settle();
    await Promise.resolve();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.muted).toBe(false);
    // A posição do play real não pode ser desfeita pelo destravamento.
    expect(audio.currentTime).toBe(3.2);
  });

  it("unmutes immediately on cancel even before the attempt settles", () => {
    const play = vi.fn(() => new Promise<void>(() => undefined));
    const audio = {
      src: "blob:track",
      currentTime: 1,
      muted: false,
      play,
      pause: vi.fn()
    };
    const handle = unlockAudioForPlayback(audio as unknown as HTMLAudioElement);
    expect(audio.muted).toBe(true);
    handle.cancel();
    expect(audio.muted).toBe(false);
  });
});

/** Contratos de fiação nos dois players do chat (o modo palavra cai para o
 * legado quando a voz não tem timestamps — ambos precisam dos mesmos consertos). */
describe("player resilience wiring", () => {
  const players = ["components/MessageWordPlayer.tsx", "components/MessageAudioPlayer.tsx"];

  it("reconciles the status when the element pauses outside the buttons", () => {
    for (const file of players) {
      const source = read(file);
      expect(source).toMatch(/ensureAudioElement[\s\S]*?audio\.onpause = \(\) => \{[\s\S]*?statusRef\.current !== "playing"[\s\S]*?setStatusTracked\(/);
    }
  });

  it("reports an element error instead of staying loading or playing forever", () => {
    for (const file of players) {
      const source = read(file);
      expect(source).toMatch(/audio\.onerror = \(\) => \{[\s\S]*?reportVoiceFailure\(/);
    }
  });

  it("cancels the unlock before issuing the real play and unmutes it", () => {
    const word = read("components/MessageWordPlayer.tsx");
    expect(word).toContain("unlockHandleRef.current = unlockAudioForPlayback");
    expect(word).toMatch(/playAt = useCallback\(async[\s\S]*?unlockHandleRef\.current\?\.cancel\(\);[\s\S]*?audio\.muted = false;/);
    const legacy = read("components/MessageAudioPlayer.tsx");
    expect(legacy).toContain("unlockHandleRef.current = unlockAudioForPlayback");
    expect(legacy).toMatch(/startPlayerAt = useCallback\(async[\s\S]*?unlockHandleRef\.current\?\.cancel\(\);[\s\S]*?audio\.muted = false;/);
  });

  it("runs the stall watchdog inside the highlight loop", () => {
    for (const file of players) {
      const source = read(file);
      expect(source).toContain("createStallTracker()");
      expect(source).toMatch(/samplePlaybackStall\(audio, stallTrackerRef\.current, statusRef\.current === "playing", giveUpStalledPlayback\)/);
      expect(source).toMatch(/giveUpStalledPlayback = useCallback\(\(\) => \{[\s\S]*?reportVoiceFailure\(/);
    }
  });
});
