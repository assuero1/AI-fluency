import { execFileSync } from "node:child_process";
import fs from "node:fs";

export default function globalSetup() {
  const output = execFileSync(process.execPath, ["scripts/qa-fixture.mjs", "--env", ".env.qa.local"], { encoding: "utf8" });
  const runId = output.match(/QA fixture created: (qa-\d+)/)?.[1];
  if (!runId) throw new Error("Unable to create E2E QA fixture.");
  fs.writeFileSync(".qa-fixtures/e2e-run.json", JSON.stringify({ runId }), { mode: 0o600 });
}
