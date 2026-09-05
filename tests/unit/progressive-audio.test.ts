import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressiveAudio, type PlaybackState, type SpeechPart } from "@/lib/learning/progressive-audio";
import { applyAudioRate } from "@/lib/learning/audio-policy";

class FakeAudio {
  src = ""; preload = ""; muted = false; paused = true; ended = false;
  readyState = 4; currentTime = 0; duration = 2; playbackRate = 1; defaultPlaybackRate = 1; preservesPitch = false;
  onended: (() => void) | null = null; onpause: (() => void) | null = null;
  onwaiting: (() => void) | null = null; onplaying: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null; onloadedmetadata: (() => void) | null = null; onerror: (() => void) | null = null;
  played: string[] = [];
  play = vi.fn(async () => { this.paused = false; this.ended = false; if (!this.muted) this.played.push(this.src); this.onplaying?.(); });
  pause = vi.fn(() => { const wasPaused = this.paused; this.paused = true; if (!wasPaused) this.onpause?.(); });
  load = vi.fn(() => { this.currentTime = 0; this.ended = false; });
  removeAttribute() { this.src = ""; }
  finish() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.onpause?.(); this.onended?.(); }
}
const part = (name: string): SpeechPart => ({ audioUrl: `/audio/${name}.mp3`, words: [] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let players: ProgressiveAudio[] = [];
function setup(request = vi.fn(async (text: string) => part(text))) {
  const audio = new FakeAudio();
  const states: PlaybackState[] = [];
  const onError = vi.fn();
  const buffers: FakeAudio[] = [];
  const controller = new ProgressiveAudio({
    texts: ["First.", "Second.", "Third."], audio: audio as unknown as HTMLAudioElement,
    request, onState: (state) => states.push(state), onError,
    createAudio: () => { const buffer = new FakeAudio(); buffers.push(buffer); return buffer as unknown as HTMLAudioElement; }
  });
  players.push(controller);
  return { controller, audio, request, states, onError, buffers, state: () => states.at(-1)! };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { players.forEach((player) => player.dispose()); players = []; vi.useRealTimers(); });

describe("progressive message playback", () => {
  it("starts first audio without waiting for the second or any word timestamps", async () => {
    const next = deferred<SpeechPart>();
    const p = setup(vi.fn((text: string) => text === "Second." ? next.promise : Promise.resolve(part(text))));
    await p.controller.play(0, 0, false);
    expect(p.audio.played).toEqual(["/audio/First..mp3"]);
    expect(p.state().status).toBe("playing");
    expect(p.request).toHaveBeenCalledTimes(2);
    expect(p.state().aligned).toEqual([]);
    next.resolve(part("Second."));
  });

  it("plays every part exactly once, only after actual ended and a natural pause", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    p.audio.currentTime = 1.98;
    p.controller.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(p.audio.played).toHaveLength(1);
    p.audio.finish();
    await vi.advanceTimersByTimeAsync(179);
    expect(p.audio.played).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.state().index).toBe(1);
    p.audio.finish();
    await vi.advanceTimersByTimeAsync(180);
    p.audio.finish();
    expect(p.audio.played).toEqual(["/audio/First..mp3", "/audio/Second..mp3", "/audio/Third..mp3"]);
    expect(p.state().status).toBe("ended");
    expect(p.request).toHaveBeenCalledTimes(3);
  });

  it("shares preload with play and buffers the next compressed source", async () => {
    const first = deferred<SpeechPart>();
    const p = setup(vi.fn((text: string) => text === "First." ? first.promise : Promise.resolve(part(text))));
    const warm = p.controller.preload();
    const play = p.controller.play(0, 0, false);
    first.resolve(part("First."));
    await Promise.all([warm, play]);
    expect(p.request.mock.calls.filter(([text]) => text === "First.")).toHaveLength(1);
    expect(p.buffers[0].src).toBe("/audio/Second..mp3");
    expect(p.buffers[0].load).toHaveBeenCalled();
  });

  it("cancels a play waiting for synthesis and does not steal sound back", async () => {
    const slow = deferred<SpeechPart>();
    const p = setup(vi.fn(() => slow.promise));
    const play = p.controller.play(0, 0, false);
    p.controller.pause();
    slow.resolve(part("First."));
    await play;
    expect(p.audio.played).toEqual([]);
    expect(p.state().status).toBe("paused");
  });

  it("does not advance during pause in the inter-sentence gap", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    p.audio.finish();
    p.controller.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(p.audio.played).toHaveLength(1);
  });

  it("keeps position and pitch when changing rate, without another request", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    expect(p.audio.playbackRate).toBe(0.85);
    p.audio.currentTime = 0.8;
    applyAudioRate(p.audio as unknown as HTMLAudioElement, 0.75);
    expect(p.audio.currentTime).toBe(0.8);
    expect(p.audio.preservesPitch).toBe(true);
    const calls = p.request.mock.calls.length;
    p.controller.pause();
    p.controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.audio.currentTime).toBe(0.8);
    expect(p.request).toHaveBeenCalledTimes(calls);
  });

  it("seeks to another sentence while paused without unexpectedly playing", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    p.controller.pause();
    p.controller.seek(2);
    expect(p.state().status).toBe("paused");
    expect(p.audio.played).toHaveLength(1);
    p.controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.audio.played.at(-1)).toBe("/audio/Third..mp3");
  });

  it("a different player cancels the pending owner", async () => {
    const slow = deferred<SpeechPart>();
    const a = setup(vi.fn(() => slow.promise));
    const pending = a.controller.play(0, 0, false);
    const b = setup();
    await b.controller.play(0, 0, false);
    slow.resolve(part("First.")); await pending;
    expect(a.audio.played).toEqual([]);
    expect(b.state().status).toBe("playing");
  });

  it("reconciles external pause, buffering, playback and error", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    p.audio.onwaiting?.(); expect(p.state().status).toBe("buffering");
    p.audio.onplaying?.(); expect(p.state().status).toBe("playing");
    p.audio.pause(); expect(p.state().status).toBe("paused");
    await p.controller.play(0, 0, false);
    p.audio.onerror?.(); expect(p.state().status).toBe("error");
    expect(p.onError).toHaveBeenCalledOnce();
  });

  it("invalidates failed URLs on retry and keeps failures readable", async () => {
    const p = setup();
    await p.controller.play(0, 0, false);
    p.audio.onerror?.();
    await p.controller.play(0, 0, false);
    expect(p.request).toHaveBeenCalledWith("First.", true);
    expect(p.state().status).toBe("playing");
  });

  it("disposal invalidates callbacks and removes audio sources", async () => {
    const slow = deferred<SpeechPart>();
    const p = setup(vi.fn(() => slow.promise));
    const pending = p.controller.play(0, 0, false);
    p.controller.dispose();
    slow.resolve(part("First.")); await pending;
    expect(p.audio.played).toEqual([]);
    expect(p.audio.src).toBe("");
    expect(p.audio.onended).toBeNull();
  });
});
