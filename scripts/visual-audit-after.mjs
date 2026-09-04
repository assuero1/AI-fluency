import { chromium } from "@playwright/test";
import fs from "node:fs";

// Circuito visual do plano de UI (F4): login como usuário QA e screenshot
// de todas as telas em viewport mobile 390x844. Uso:
//   node scripts/start-e2e-server.mjs   (em outro terminal)
//   node scripts/visual-audit-after.mjs [pasta-destino]
const outDir = process.argv[2] ?? ".playwright-mcp/audit-after";
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

fs.mkdirSync(outDir, { recursive: true });

// Login (estado deslogado) antes de autenticar
await page.goto(`${base}/login`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/login.png`, fullPage: true });
console.log("shot: login");

await page.getByPlaceholder("Email").fill(env.QA_USER_EMAIL);
await page.getByPlaceholder("Senha").fill(env.QA_USER_PASSWORD);
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${base}/`, { timeout: 20000 });

const shots = [
  ["home", "/"],
  ["palavras", "/palavras"],
  ["treino", "/palavras/treino"],
  ["novas", "/palavras/novas"],
  ["progresso", "/progresso"],
  ["resumo", "/resumo"],
  ["perfil", "/perfil"],
  ["conquistas", "/perfil/conquistas"],
  ["calendario", "/calendario"],
  ["connections", "/settings/connections"],
  ["onboarding-idioma", "/onboarding?mode=language"]
];

// Detalhe da palavra: pega o link da primeira palavra da lista
await page.goto(`${base}/palavras`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
const wordHref = await page.evaluate(() => document.querySelector('.word-row-link[href*="/palavras/"]')?.getAttribute("href") ?? null);
if (wordHref) shots.push(["word-detail", wordHref]);

// Dia do calendário: primeiro dia com feedback no mês corrente
const dayHref = await page.evaluate(() => {
  const link = Array.from(document.querySelectorAll(".calendar-grid-interactive a"))
    .find((a) => (a.getAttribute("aria-label") ?? "").includes("com feedback"));
  return link?.getAttribute("href") ?? null;
});
if (dayHref) shots.push(["calendario-dia", dayHref]);

for (const [name, path] of shots) {
  try {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 15000 });
  } catch {
    // networkidle pode estourar com polls; a página já está carregada
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log("shot:", name, "->", path);
}

await browser.close();
console.log("done:", outDir);
