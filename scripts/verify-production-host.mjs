import fs from "node:fs";
import path from "node:path";

const failures = [];
const appUrl = parseHttpsUrl(process.env.APP_URL);
const cacheDir = process.env.AUDIO_CACHE_DIR?.trim();

if (process.env.APP_ENV !== "production") failures.push("APP_ENV must be production.");
if (!appUrl) failures.push("APP_URL must be a valid non-local HTTPS URL.");
if (process.env.AUDIO_CACHE_PERSISTENT !== "true") {
  failures.push("AUDIO_CACHE_PERSISTENT must be true after the persistent volume is mounted.");
}

if (!cacheDir || !path.isAbsolute(cacheDir)) {
  failures.push("AUDIO_CACHE_DIR must be an absolute path on the persistent volume.");
} else {
  const resolved = path.resolve(cacheDir);
  const forbiddenRoots = [path.resolve("public"), path.resolve(".next")];
  if (forbiddenRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    failures.push("AUDIO_CACHE_DIR cannot be inside a web-served or build directory.");
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) failures.push("AUDIO_CACHE_DIR is not a directory.");
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    if ((stat.mode & 0o002) !== 0) failures.push("AUDIO_CACHE_DIR must not be world-writable.");
  } catch {
    failures.push("AUDIO_CACHE_DIR must already exist and be readable and writable by the app process.");
  }
}

const publicSecretNames = Object.keys(process.env).filter(
  (name) => name.startsWith("NEXT_PUBLIC_") && /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)
);
if (publicSecretNames.length) failures.push("Secret-like NEXT_PUBLIC_ variables are forbidden.");

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checks: ["production environment", "HTTPS app URL", "persistent private audio cache", "no public secret variables"]
}));

function parseHttpsUrl(value) {
  try {
    const parsed = new URL(value ?? "");
    if (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}
