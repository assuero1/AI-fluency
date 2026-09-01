import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fila de prefetch de áudio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("agenda as chamadas com espaçamento e na ordem", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    // burstCount: 0 desliga o burst e mantém o espaçamento fixo original.
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000, burstCount: 0 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenNthCalledWith(1, "a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(2, "b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(3, "c");
  });

  it("jumpTo prioriza um texto pendente sem duplicar", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000, burstCount: 0 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    queue.jumpTo("c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(2, "c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(3, "b");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("dispose cancela o restante e erros não quebram a fila", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b"], request, spacingMs: 1000, burstCount: 0 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bursta as primeiras frases e espaça o restante", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c", "d", "e"], request, spacingMs: 2000, burstCount: 3, burstSpacingMs: 250 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
