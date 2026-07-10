import { execFileSync } from "node:child_process";
import fs from "node:fs";

export default function globalTeardown() {
  const path = ".qa-fixtures/e2e-run.json";
  if (!fs.existsSync(path)) return;
  const { runId } = JSON.parse(fs.readFileSync(path, "utf8")) as { runId?: string };
  if (runId) execFileSync(process.execPath, ["scripts/qa-recover-fixture.mjs", "--env", ".env.qa.local", "--run", runId], { stdio: "inherit" });
  fs.rmSync(path, { force: true });
}
