import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { chromium } from "@playwright/test";

export const AUTH_STATE_PATH = ".qa-fixtures/auth-state.json";

function readQaEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(".env.qa.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

// Logs in once via the UI and saves the session so authenticated specs
// (qa-flow) run as the QA user. Auth specs opt out with an empty storageState.
async function createAuthState(baseURL: string) {
  const env = readQaEnv();
  const email = env.QA_USER_EMAIL;
  const password = env.QA_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("QA_USER_EMAIL/QA_USER_PASSWORD missing in .env.qa.local. Run: node scripts/qa-create-auth-user.mjs");
  }
  // Specs read these from process.env (workers inherit it after globalSetup).
  process.env.QA_USER_EMAIL = email;
  process.env.QA_USER_PASSWORD = password;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(`${baseURL}/`);
    await page.context().storageState({ path: AUTH_STATE_PATH });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  const output = execFileSync(process.execPath, ["scripts/qa-fixture.mjs", "--env", ".env.qa.local"], { encoding: "utf8" });
  const runId = output.match(/QA fixture created: (qa-\d+)/)?.[1];
  if (!runId) throw new Error("Unable to create E2E QA fixture.");
  fs.mkdirSync(".qa-fixtures", { recursive: true });
  fs.writeFileSync(".qa-fixtures/e2e-run.json", JSON.stringify({ runId }), { mode: 0o600 });
  await createAuthState("http://localhost:3015");
}
