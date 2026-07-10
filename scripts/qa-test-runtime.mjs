import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { readEnv } from "./qa-env.mjs";

export function createFixture(envPath = ".env.qa.local") {
  const output = execFileSync(process.execPath, ["scripts/qa-fixture.mjs", "--env", envPath], { encoding: "utf8" });
  const match = output.match(/QA fixture created: (qa-\d+)/);
  if (!match) throw new Error("QA fixture run id was not returned.");
  return match[1];
}

export function recoverFixture(runId, envPath = ".env.qa.local") {
  return execFileSync(process.execPath, ["scripts/qa-recover-fixture.mjs", "--env", envPath, "--run", runId], { encoding: "utf8" });
}

export function readFixture(runId) {
  const manifestPath = path.join(".qa-fixtures", `${runId}.json`);
  if (!fs.existsSync(manifestPath)) throw new Error(`QA fixture manifest not found: ${manifestPath}`);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export async function startQaServer(port, envPath = ".env.qa.local", options = {}) {
  await assertPortIsAvailable(port);
  const env = {
    ...process.env,
    ...readEnv(envPath),
    PORT: String(port),
    AI_FLUENCY_USER_ID: options.userId ?? ""
  };
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    env,
    stdio: "ignore",
    detached: false
  });
  const baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`QA server exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/settings/connections`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // Keep polling until Next starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGINT");
  throw new Error("Timed out while starting the QA server.");
}

async function assertPortIsAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      reject(new Error(`QA port ${port} is already in use. Stop the previous QA server before retrying. (${reason})`));
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}

export async function stopQaServer(child) {
  if (process.env.QA_KEEP_SERVER === "1") return;
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
}
