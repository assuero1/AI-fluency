import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fila de prefetch de áudio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("agenda as chamadas com espaçamento e na ordem", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000 });
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
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000 });
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
    const queue = createAudioPrefetchQueue({ texts: ["a", "b"], request, spacingMs: 1000 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
