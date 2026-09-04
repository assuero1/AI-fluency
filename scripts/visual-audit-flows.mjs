import { chromium } from "@playwright/test";
import fs from "node:fs";

// Captura de estados em sessão: treino de cards (sessão custom) e conversa de chat.
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
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false }).then(() => console.log("shot:", name));

await page.goto(`${base}/login`);
await page.getByPlaceholder("Email").fill(env.QA_USER_EMAIL);
await page.getByPlaceholder("Senha").fill(env.QA_USER_PASSWORD);
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${base}/`, { timeout: 20000 });
await page.waitForTimeout(800);

// ---- Treino: retoma sessão pendente ou monta uma custom ----
await page.goto(`${base}/palavras/treino`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
const resume = page.getByRole("button", { name: "Continuar treino" });
const customToggle = page.getByRole("button", { name: "Sessão custom" });
if (await resume.count()) {
  await resume.click().catch(() => {});
  await page.waitForTimeout(1800);
} else if (await customToggle.count()) {
  await customToggle.click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Montar treino com/i }).click().catch(() => {});
  await page.waitForTimeout(3000);
}
await shot("treino-card-front");
const flip = page.getByRole("button", { name: /virar|revelar|mostrar|resposta|Não lembro/i }).first();
if (await flip.count()) { await flip.click().catch(() => {}); await page.waitForTimeout(900); }
await shot("treino-card-back");

// ---- Chat: conversa com tema digitado ----
await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
const themeStart = page.locator("section", { hasText: "Sugestões para sua prática" }).getByRole("button", { name: "Começar" }).first();
await themeStart.click().catch((e) => console.log("theme start failed:", e.message));
await page.waitForTimeout(1200);
await shot("chat-config-dialog");
await page.getByRole("button", { name: "Começar prática" }).first().click().catch((e) => console.log("start practice failed:", e.message));
await page.waitForTimeout(8000);
await shot("chat-conversation");
const input = page.locator("textarea, input[type=text]").last();
if (await input.count()) {
  await input.fill("Hello! I would like to order a coffee, please.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(10000);
  await shot("chat-conversation-reply");
}

await browser.close();
console.log("done");
