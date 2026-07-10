import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");

const fixtureDir = ".qa-fixtures";
const manifests = fs.existsSync(fixtureDir)
  ? fs.readdirSync(fixtureDir)
      .filter((name) => /^qa-\d+\.json$/.test(name))
      .map((name) => ({ name, mtimeMs: fs.statSync(path.join(fixtureDir, name)).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
  : [];
if (manifests.length !== 1) {
  throw new Error(`Expected exactly one QA fixture manifest, found ${manifests.length}. Use qa:recover with an explicit run id.`);
}

const runId = manifests[0].name.slice(0, -".json".length);
execFileSync(process.execPath, ["scripts/qa-recover-fixture.mjs", "--env", envPath, "--run", runId], { stdio: "inherit" });
