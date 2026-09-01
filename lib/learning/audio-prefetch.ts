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
 */
export function createAudioPrefetchQueue(options: {
  texts: string[];
  request: (text: string) => Promise<unknown>;
  spacingMs?: number;
}): AudioPrefetchQueue {
  const spacing = Math.max(0, options.spacingMs ?? 2200);
  let pending = options.texts.filter(Boolean);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = () => {
    if (disposed || !pending.length) return;
    const text = pending.shift()!;
    void options.request(text).catch(() => undefined);
    if (pending.length) timer = setTimeout(pump, spacing);
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
