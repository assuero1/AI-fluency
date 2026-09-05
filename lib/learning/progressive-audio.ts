import { applyAudioRate } from "./audio-policy";
import { msUntilAudioRouteRestored } from "./speech";
import { alignWords, hasUsableAlignment, tokenizeForCaptions, type AlignedToken, type WordTimestamp } from "./captions";
import { claimActiveVoice, createStallTracker, samplePlaybackStall, releaseActiveVoice, unlockAudioForPlayback } from "@/components/voice-shared";

export type SpeechPart = { audioUrl: string; words: WordTimestamp[] };
export type PlaybackStatus = "idle" | "loading" | "playing" | "buffering" | "paused" | "ended" | "error";
export type PlaybackState = { status: PlaybackStatus; index: number; aligned: AlignedToken[]; time: number };

/** Uma fonte comprimida por frase. Nunca espera/downloads/decodifica a mensagem inteira. */
export class ProgressiveAudio {
  private state: PlaybackState = { status: "idle", index: 0, aligned: [], time: 0 };
  private parts = new Map<number, Promise<SpeechPart>>();
  private nextAudio: HTMLAudioElement | null = null;
  private prefetchGeneration = 0;
  private generation = 0;
  private disposed = false;
  private gap: ReturnType<typeof setTimeout> | undefined;
  private owner = Symbol("progressive-audio");
  private sourceIndex = -1;
  private unlock: ReturnType<typeof unlockAudioForPlayback> | undefined;
  private startedAt = 0;
  private measured = false;
  private stall = createStallTracker();

  constructor(private options: {
    texts: string[];
    audio: HTMLAudioElement;
    request: (text: string, refresh?: boolean) => Promise<SpeechPart>;
    onState: (state: PlaybackState) => void;
    onError: (reason: string) => void;
    createAudio?: () => HTMLAudioElement;
  }) {
    const audio = options.audio;
    audio.preload = "auto";
    applyAudioRate(audio);
    audio.onended = () => {
      if (this.disposed || !["playing", "buffering"].includes(this.state.status)) return;
      // Só avança depois do ended real; pausas naturais nunca cortam a última sílaba.
      if (this.state.index + 1 >= options.texts.length) { this.emit({ status: "ended", time: audio.currentTime }); releaseActiveVoice(this.owner); return; }
      const generation = this.generation;
      this.emit({ status: "buffering" });
      this.gap = setTimeout(() => {
        if (this.generation === generation && !this.disposed) void this.play(this.state.index + 1, 0, false);
      }, 180);
    };
    audio.onpause = () => {
      if (!audio.ended && ["playing", "buffering"].includes(this.state.status)) this.pause();
    };
    audio.onwaiting = () => { if (this.state.status === "playing") this.emit({ status: "buffering" }); };
    audio.onplaying = () => {
      if (audio.muted || this.sourceIndex < 0) return;
      if (["loading", "buffering", "playing"].includes(this.state.status)) {
        this.emit({ status: "playing" });
        if (!this.measured && this.startedAt) {
          this.measured = true;
          // Medida local sem texto pessoal; acessível no painel Performance do navegador.
          try { performance.measure("voice.play-to-sound", { start: this.startedAt, end: performance.now() }); } catch { /* API opcional. */ }
        }
      }
    };
    audio.ontimeupdate = () => this.tick();
    audio.onloadedmetadata = () => this.updateAlignment();
    audio.onerror = () => {
      this.parts.delete(this.state.index);
      this.sourceIndex = -1;
      if (["loading", "playing", "buffering"].includes(this.state.status)) this.fail("audio element error");
    };
  }

  private emit(patch: Partial<PlaybackState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  private fail(reason: string) {
    ++this.generation;
    clearTimeout(this.gap);
    this.emit({ status: "error" });
    this.options.audio.pause();
    releaseActiveVoice(this.owner);
    this.options.onError(reason);
  }

  private load(index: number, refresh = false) {
    if (refresh) this.parts.delete(index);
    const existing = this.parts.get(index);
    if (existing) return existing;
    const task = this.options.request(this.options.texts[index], refresh).catch((error) => {
      if (this.parts.get(index) === task) this.parts.delete(index);
      throw error;
    });
    this.parts.set(index, task);
    return task;
  }

  private async updateAlignment() {
    const index = this.sourceIndex;
    const task = this.parts.get(index);
    if (!task) return;
    try {
      const part = await task;
      if (index !== this.sourceIndex || this.disposed) return;
      const aligned = alignWords(tokenizeForCaptions(this.options.texts[index]), part.words);
      this.emit({ aligned: hasUsableAlignment(aligned, this.options.audio.duration) ? aligned : [] });
    } catch { /* Legenda nunca impede a reprodução. */ }
  }

  async preload() {
    const generation = this.generation;
    try {
      const part = await this.load(0);
      if (this.disposed || generation !== this.generation || this.state.status !== "idle") return;
      this.assign(0, part);
      this.prefetchNext(0);
    } catch { /* Falha especulativa é retentável pelo botão. */ }
  }

  private assign(index: number, part: SpeechPart) {
    if (this.sourceIndex === index) return;
    const audio = this.options.audio;
    this.sourceIndex = index;
    audio.src = part.audioUrl;
    audio.load();
    this.emit({ index, time: 0, aligned: [] });
    void this.updateAlignment();
  }

  private prefetchNext(index: number) {
    const next = index + 1;
    const prefetchGeneration = ++this.prefetchGeneration;
    this.nextAudio?.removeAttribute("src");
    this.nextAudio?.load();
    this.nextAudio = null;
    if (next >= this.options.texts.length) return;
    void this.load(next).then((part) => {
      if (this.disposed || this.state.index !== index || this.prefetchGeneration !== prefetchGeneration) return;
      const audio = this.options.createAudio?.() ?? new Audio();
      audio.preload = "auto";
      audio.src = part.audioUrl;
      audio.load();
      this.nextAudio = audio;
    }).catch(() => undefined);
  }

  async play(index = this.state.index, time = 0, gesture = true) {
    if (this.disposed || index < 0 || index >= this.options.texts.length) return;
    claimActiveVoice(this.owner, () => this.pause());
    const refresh = this.state.status === "error";
    const generation = ++this.generation;
    clearTimeout(this.gap);
    this.startedAt = performance.now();
    this.measured = false;
    this.stall = createStallTracker();
    this.emit({ status: "loading", index, time });
    const audio = this.options.audio;
    audio.pause();
    if (gesture) this.unlock = unlockAudioForPlayback(audio);
    try {
      const part = await this.load(index, refresh);
      if (this.disposed || generation !== this.generation) return;
      if (refresh) this.sourceIndex = -1;
      this.unlock?.cancel();
      this.assign(index, part);
      applyAudioRate(audio);
      this.prefetchNext(index);
      const wait = msUntilAudioRouteRestored();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (this.disposed || generation !== this.generation) return;
      audio.currentTime = time;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await audio.play(); break; }
        catch (error) {
          if (attempt || this.disposed || generation !== this.generation) throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (this.disposed || generation !== this.generation) return;
        }
      }
      if (this.disposed || generation !== this.generation) return;
      this.emit({ status: "playing" });
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  pause() {
    ++this.generation;
    clearTimeout(this.gap);
    this.unlock?.cancel();
    this.emit({ status: "paused", time: this.sourceIndex === this.state.index ? this.options.audio.currentTime : this.state.time });
    this.options.audio.pause();
  }

  toggle() {
    if (["playing", "buffering", "loading"].includes(this.state.status)) { this.pause(); return; }
    const ended = this.state.status === "ended";
    void this.play(ended ? 0 : this.state.index, this.state.status === "paused" ? this.state.time : 0);
  }

  seek(index: number, time = 0) {
    if (["playing", "buffering"].includes(this.state.status)) { void this.play(index, time); return; }
    this.pause();
    if (index === this.sourceIndex) this.options.audio.currentTime = time;
    else { this.sourceIndex = -1; this.options.audio.currentTime = 0; }
    this.emit({ index, time, aligned: index === this.sourceIndex ? this.state.aligned : [] });
  }

  tick() {
    samplePlaybackStall(this.options.audio, this.stall, this.state.status === "playing", () => this.fail("playback stalled with no progress"));
    if (this.state.time !== this.options.audio.currentTime) this.emit({ time: this.options.audio.currentTime });
  }

  dispose() {
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.gap);
    this.unlock?.cancel();
    const audio = this.options.audio;
    audio.onended = audio.onpause = audio.onwaiting = audio.onplaying = audio.ontimeupdate = audio.onerror = audio.onloadedmetadata = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    this.nextAudio?.removeAttribute("src");
    this.nextAudio?.load();
    releaseActiveVoice(this.owner);
  }
}
