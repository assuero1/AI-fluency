import { spawn } from "node:child_process";
import fs from "node:fs";
import { createFixture, readFixture, recoverFixture } from "./qa-test-runtime.mjs";
import { readEnv } from "./qa-env.mjs";

const envPath = ".env.qa.local";
const statePath = ".qa-fixtures/e2e-run.json";

if (fs.existsSync(statePath)) {
  const stale = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (stale.runId) {
    try {
      recoverFixture(stale.runId, envPath);
    } catch {
      // The normal recovery command remains available if a stale fixture cannot be reached now.
    }
  }
  fs.rmSync(statePath, { force: true });
}

const runId = createFixture(envPath);
const fixture = readFixture(runId);
const userId = fixture.records.TEABLE_USERS_TABLE_ID[0];
if (!userId) throw new Error("The E2E fixture did not create a user record.");

fs.writeFileSync(statePath, JSON.stringify({ runId, userId }), { mode: 0o600 });

const child = spawn("npm", ["start", "--", "-p", "3015"], {
  env: {
    ...process.env,
    ...readEnv(envPath),
    AI_FLUENCY_USER_ID: userId,
    PORT: "3015"
  },
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}

child.on("exit", (code) => {
  if (code && fs.existsSync(statePath)) {
    try {
      recoverFixture(runId, envPath);
      fs.rmSync(statePath, { force: true });
    } catch {
      // Preserve the state file so the next run or a manual recovery can clean it.
    }
  }
  process.exitCode = code ?? 0;
});
