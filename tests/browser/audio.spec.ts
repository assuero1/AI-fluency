import { test, expect } from "@playwright/test";

function wav(seconds = 0.7) {
  const samples = Math.round(16000 * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    const audios: HTMLAudioElement[] = [];
    Object.assign(window, { testAudios: audios });
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement && !audios.includes(this)) audios.push(this);
      return nativePlay.call(this);
    };
  });
  await page.route("**/api/voice/warmup", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/events", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/media/*.wav", (route) => {
    const body = wav();
    const range = route.request().headers()["range"]?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({
      status: range ? 206 : 200, body: body.subarray(start, end + 1), contentType: "audio/wav",
      headers: { "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${body.length}` } : {}) }
    });
  });
});

test("native audio plays all sentences, preserves rate and reuses synthesis across controls", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/voice/captioned", (route) => {
    const text = route.request().postDataJSON().text as string;
    requests.push(text);
    return route.fulfill({ json: { ok: true, audioUrl: `/media/${encodeURIComponent(text)}.wav`, words: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const message = page.getByRole("region", { name: "Mensagem", exact: true });
  await message.getByRole("button", { name: "Ouvir mensagem", exact: true }).click();
  await expect(message.getByRole("button", { name: "Ouvir novamente", exact: true })).toBeVisible({ timeout: 10_000 });
  expect(requests).toEqual(["Hello world.", "Learn at your pace.", "Last word."]);
  await expect(message.getByRole("combobox", { name: "Velocidade do áudio" })).toHaveValue("0.85");
  await message.getByRole("combobox").selectOption("0.75");
  await page.getByRole("region", { name: "Palavra", exact: true }).getByRole("button").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudios: HTMLAudioElement[] }).testAudios.filter((audio) => !audio.paused).map((audio) => [audio.playbackRate, audio.preservesPitch]))).toEqual([[0.75, true]]);
  expect(requests.filter((text) => text === "Hello world.")).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/audio-browser/player.png" });
});

test("first sound does not wait for a slow following sentence; pause cancels continuation", async ({ page }) => {
  let releaseSecond!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseSecond = resolve; });
  await page.route("**/api/voice/captioned", async (route) => {
    const text = route.request().postDataJSON().text as string;
    if (text === "Learn at your pace.") await blocked;
    await route.fulfill({ json: { ok: true, audioUrl: `/media/${encodeURIComponent(text)}.wav`, words: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Ouvir mensagem", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausar áudio", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausar áudio", exact: true }).click();
  releaseSecond();
  await expect(page.getByRole("button", { name: "Continuar áudio", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudios: HTMLAudioElement[] }).testAudios.every((audio) => audio.paused))).toBe(true);
});

test("error reveals transcript even when hidden", async ({ page }) => {
  await page.route("**/api/voice/captioned", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Unavailable" } }));
  await page.goto("/?hidden", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Ouvir mensagem", exact: true }).click();
  await expect(page.getByText("Áudio indisponível agora — leia a mensagem acima.")).toBeVisible();
  await expect(page.getByText("Last word.", { exact: true })).toBeVisible();
});

test("word highlighting follows media time and seeking at a slower rate reuses the audio", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/voice/captioned", (route) => {
    requests++;
    const text = route.request().postDataJSON().text as string;
    const words = text === "Hello world." ? [{ word: "Hello", start_time: 0, end_time: 0.3 }, { word: "world", start_time: 0.3, end_time: 0.65 }] : [];
    return route.fulfill({ json: { ok: true, audioUrl: `/media/${encodeURIComponent(text)}.wav`, words } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Ouvir mensagem", exact: true }).click();
  await page.getByRole("button", { name: "Pausar áudio", exact: true }).click();
  const world = page.getByRole("button", { name: "Ouvir a partir de world", exact: true });
  await world.click();
  await expect(world).toHaveClass(/active/);
  const before = requests;
  await page.getByRole("combobox").selectOption("0.75");
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudios: HTMLAudioElement[] }).testAudios.filter((audio) => audio.src.includes("Hello%20world")).map((audio) => ({ time: Math.round(audio.currentTime * 100) / 100, rate: audio.playbackRate })))).toEqual([{ time: 0.3, rate: 0.75 }]);
  expect(requests).toBe(before);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("combobox")).toHaveValue("0.75");
});
