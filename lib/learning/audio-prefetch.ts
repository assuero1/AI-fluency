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
}): AudioPrefetchQueue {
  const spacing = Math.max(0, options.spacingMs ?? 2200);
  const burstCount = Math.max(0, options.burstCount ?? 4);
  const burstSpacing = Math.max(0, options.burstSpacingMs ?? 250);
  let pending = options.texts.filter(Boolean);
  let disposed = false;
  let pumped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = () => {
    if (disposed || !pending.length) return;
    const text = pending.shift()!;
    void options.request(text).catch(() => undefined);
    pumped += 1;
    if (pending.length) timer = setTimeout(pump, pumped >= burstCount ? spacing : burstSpacing);
  };

  return {
    start: pump,
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
