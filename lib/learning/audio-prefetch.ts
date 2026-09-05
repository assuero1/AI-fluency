export type AudioPrefetchQueue = {
  start: () => void;
  jumpTo: (text: string) => void;
  dispose: () => void;
};

/**
 * Sintetiza os áudios das frases em background, em ritmo seguro para o rate
 * limit de síntese (~27/min com o espaçamento default de 2200ms), com
 * prioridade para a frase corrente via jumpTo. `request` é o requestSpeech
 * (já deduplica e cacheia), injetado para testabilidade.
 *
 * Burst inicial: os `burstCount` primeiros itens saem em ritmo rápido
 * (`burstSpacingMs`) para deixar as primeiras frases prontas quase junto com
 * a sessão; os seguintes voltam ao `spacingMs` (rate limit de síntese).
 */
export function createAudioPrefetchQueue(options: {
  texts: string[];
  request: (text: string) => Promise<unknown>;
  spacingMs?: number;
  burstCount?: number;
  burstSpacingMs?: number;
  concurrency?: number;
}): AudioPrefetchQueue {
  const spacing = Math.max(0, options.spacingMs ?? 2200);
  const burstCount = Math.max(0, options.burstCount ?? 4);
  const burstSpacing = Math.max(0, options.burstSpacingMs ?? 250);
  let pending = [...new Set(options.texts.filter(Boolean))];
  const concurrency = Math.max(1, options.concurrency ?? 2);
  let active = 0;
  let started = false;
  let nextStart = 0;
  let startTimes: number[] = [];
  let disposed = false;
  let pumped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = () => {
    if (disposed || !pending.length || active >= concurrency || timer) return;
    const now = Date.now();
    startTimes = startTimes.filter((time) => now - time < 60_000);
    const allowedAt = Math.max(nextStart, startTimes.length >= 30 ? startTimes[0] + 60_000 : 0);
    if (allowedAt > now) {
      timer = setTimeout(() => { timer = null; pump(); }, allowedAt - now);
      return;
    }
    const text = pending.shift()!;
    active++;
    pumped++;
    startTimes.push(now);
    nextStart = now + (pumped >= burstCount ? spacing : burstSpacing);
    void Promise.resolve().then(() => options.request(text)).catch(() => undefined).finally(() => {
      active--;
      pump();
    });
    pump();
  };

  return {
    start: () => { if (!started) { started = true; pump(); } },
    jumpTo: (text: string) => {
      if (disposed || !text || !pending.includes(text)) return;
      pending = [text, ...pending.filter((item) => item !== text)];
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      pending = [];
    }
  };
}
