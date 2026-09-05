import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "audio.spec.ts", workers: 1,
  outputDir: "../../test-results/audio-browser",
  use: { baseURL: "http://127.0.0.1:3018", viewport: { width: 390, height: 844 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: { command: "node scripts/start-audio-harness.mjs", cwd: "../..", url: "http://127.0.0.1:3018", timeout: 30_000, reuseExistingServer: false }
});
