import { chromium } from "@playwright/test";
import fs from "node:fs";

// Extensão do visual-audit-after.mjs: estados interativos e telas que faltam.
const outDir = ".playwright-mcp/ui-review-2026-09-03";
const base = "http://localhost:3016";

const env = Object.fromEntries(
  fs.readFileSync(".env.qa.local", "utf8").split(/\r?\n/)
    .map((line) => line.match(/^([^#=\s]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block"
});
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true }).then(() => console.log("shot:", name));

// 1. Reset password (deslogado)
await page.goto(`${base}/reset-password`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
await shot("reset-password");

// 2. Offline
await page.goto(`${base}/offline`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
await shot("offline");

// Login
await page.goto(`${base}/login`);
await page.getByPlaceholder("Email").fill(env.QA_USER_EMAIL);
await page.getByPlaceholder("Senha").fill(env.QA_USER_PASSWORD);
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${base}/`, { timeout: 20000 });

// 3. Detalhe da palavra
await page.goto(`${base}/palavras`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
const wordHref = await page.evaluate(() =>
  document.querySelector('a[href*="/palavras/"]')?.getAttribute("href") ?? null
);
if (wordHref) {
  await page.goto(`${base}${wordHref}`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  await shot("word-detail");
}

// 4. Treino em sessão: começar do zero e virar o primeiro card
await page.goto(`${base}/palavras/treino`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
await shot("treino-empty");
const startBtn = page.getByRole("button", { name: /começar|iniciar/i }).first();
if (await startBtn.count()) {
  await startBtn.click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot("treino-session");
  const revealBtn = page.getByRole("button", { name: /virar|revelar|mostrar/i }).first();
  if (await revealBtn.count()) {
    await revealBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    await shot("treino-revealed");
  }
}

// 5. Chat: setup dialog
await page.goto(`${base}/chat`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
await shot("chat-setup");
// iniciar conversa
const chatStart = page.getByRole("button", { name: /começar prática/i }).first();
if (await chatStart.count() && !(await chatStart.isDisabled().catch(() => true))) {
  await chatStart.click().catch(() => {});
  await page.waitForTimeout(4000);
  await shot("chat-conversation");
  // conversa com uma resposta do usuário, para ver bolhas
  const input = page.locator("textarea, input[type=text]").last();
  if (await input.count()) {
    await input.fill("Hello! How are you today?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);
    await shot("chat-conversation-reply");
  }
}

// 6. Onboarding primeira execução (modo perfil), se acessível
await page.goto(`${base}/onboarding`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
await shot("onboarding-default");

await browser.close();
console.log("done:", outDir);
