import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const qaEnv = Object.fromEntries(
  fs.readFileSync(".env.qa.local", "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([^#=\s]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match![1], match![2]])
);
const processEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3015",
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 5"] } }],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    env: { ...processEnv, ...qaEnv },
    url: "http://localhost:3015/api/settings/connections",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
