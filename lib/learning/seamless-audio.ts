/**
 * Monta uma única faixa de áudio contínua a partir de várias URLs: baixa e
 * decodifica tudo em paralelo e concatena num só AudioBuffer (Web Audio API).
 * Assim uma mensagem toca como um áudio único, sem gap audível na transição
 * entre as partes (segmentos ou frases).
 */

export type SeamlessTrack = {
  context: AudioContext;
  buffer: AudioBuffer;
  /** Posição inicial (segundos) de cada parte dentro do buffer concatenado. */
  partOffsets: number[];
};

export async function buildSeamlessTrack(urls: string[]): Promise<SeamlessTrack> {
  if (urls.length === 0) throw new Error("No audio parts.");
  const AudioContextCtor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio API unavailable.");

  const context = new AudioContextCtor();
  try {
    const buffers = await Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
      const raw = await response.arrayBuffer();
      // decodeAudioData converte tudo para o sampleRate do contexto,
      // então as partes podem ser concatenadas frame a frame.
      return context.decodeAudioData(raw);
    }));

    const partOffsets: number[] = [];
    let totalLength = 0;
    buffers.forEach((part) => {
      partOffsets.push(totalLength / context.sampleRate);
      totalLength += part.length;
    });

    const channels = Math.max(...buffers.map((part) => part.numberOfChannels));
    const merged = context.createBuffer(channels, totalLength, context.sampleRate);
    let writeOffset = 0;
    buffers.forEach((part) => {
      for (let channel = 0; channel < channels; channel += 1) {
        const source = part.getChannelData(Math.min(channel, part.numberOfChannels - 1));
        merged.getChannelData(channel).set(source, writeOffset);
      }
      writeOffset += part.length;
    });

    return { context, buffer: merged, partOffsets };
  } catch (error) {
    void context.close();
    throw error;
  }
}

/**
 * Toca um SeamlessTrack como um áudio único, com posição contínua, pausa com
 * retomada no ponto exato e seek arbitrário (para pular para uma palavra/frase).
 */
export class SeamlessPlayer {
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private stopped = true;

  constructor(private readonly track: SeamlessTrack) {}

  get duration() {
    return this.track.buffer.duration;
  }

  /** Posição atual de reprodução em segundos (congelada quando parado/pausado). */
  position() {
    if (this.stopped) return this.startOffset;
    const elapsed = this.track.context.currentTime - this.startedAt;
    return Math.min(this.startOffset + elapsed, this.duration);
  }

  /** Ajusta a posição quando parado/pausado (para o resume continuar dali). */
  setPosition(time: number) {
    if (this.stopped) this.startOffset = this.clampTime(time);
  }

  /** Toca a partir de `from` segundos; `onEnded` dispara só no fim natural. */
  async play(from: number, onEnded: () => void) {
    this.stopSource();
    await this.track.context.resume();
    const source = this.track.context.createBufferSource();
    source.buffer = this.track.buffer;
    source.connect(this.track.context.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.stopped = true;
      this.startOffset = this.duration;
      onEnded();
    };
    this.source = source;
    this.startOffset = this.clampTime(from);
    this.startedAt = this.track.context.currentTime;
    this.stopped = false;
    source.start(0, this.startOffset);
  }

  pause() {
    this.startOffset = this.position();
    this.stopSource();
  }

  stop() {
    this.startOffset = 0;
    this.stopSource();
  }

  dispose() {
    this.stopSource();
    void this.track.context.close();
  }

  private stopSource() {
    const source = this.source;
    this.source = null;
    this.stopped = true;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Fonte já parada — nada a fazer.
      }
    }
  }

  private clampTime(time: number) {
    return Math.max(0, Math.min(time, this.duration));
  }
}
