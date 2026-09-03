import { chromium } from "@playwright/test";
import fs from "node:fs";

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

await page.goto("http://localhost:3015/login");
await page.getByPlaceholder("Email").fill(env.QA_USER_EMAIL);
await page.getByPlaceholder("Senha").fill(env.QA_USER_PASSWORD);
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL("http://localhost:3015/", { timeout: 20000 });

fs.mkdirSync(".playwright-mcp/audit-after", { recursive: true });
const shots = [
  ["home", "/"],
  ["palavras", "/palavras"],
  ["chat", "/chat"],
  ["treino", "/palavras/treino"],
  ["novas", "/palavras/novas"],
  ["progresso", "/progresso"],
  ["resumo", "/resumo"],
  ["perfil", "/perfil"],
  ["calendario", "/calendario"],
  ["connections", "/settings/connections"]
];

for (const [name, path] of shots) {
  try {
    await page.goto(`http://localhost:3015${path}`, { waitUntil: "networkidle", timeout: 15000 });
  } catch {
    // networkidle pode estourar com polls; a página já está carregada
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `.playwright-mcp/audit-after/${name}.png`, fullPage: true });
  console.log("shot:", name, page.url());
}

await browser.close();
console.log("done");
