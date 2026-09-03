import { expect, test } from "@playwright/test";

const email = process.env.QA_USER_EMAIL!;
const password = process.env.QA_USER_PASSWORD!;

// Auth specs must start logged out even though the default project
// authenticates via the storageState written by global-setup.ts.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(() => {
  if (!email || !password) throw new Error("QA_USER_EMAIL/QA_USER_PASSWORD are required (see .env.qa.local).");
});

test("usuário deslogado é redirecionado para /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("login com credenciais válidas leva à home", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
});

test("logout volta para /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/);
});
