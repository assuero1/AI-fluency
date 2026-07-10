import fs from "node:fs";
import path from "node:path";

const envPath = process.argv[2] ?? ".env.local";
if (!fs.existsSync(envPath)) throw new Error(`Environment file not found: ${envPath}`);
if (!fs.existsSync(".next/static")) throw new Error("Build output not found. Run npm run build first.");

const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([^#=\s]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]])
);
const secretKeys = ["TEABLE_API_KEY", "TEABLE_TOKEN", "AI_API_KEY", "KOKORO_API_KEY", "ENCRYPTION_SECRET"];
const clientBundle = readFiles(".next/static").map((file) => fs.readFileSync(file, "utf8")).join("\n");
const leaked = secretKeys.filter((key) => {
  const value = env[key]?.trim();
  return value && !value.startsWith("replace-with") && clientBundle.includes(value);
});

if (leaked.length) throw new Error(`Server secret values found in client bundle: ${leaked.join(", ")}.`);
console.log("Client bundle contains no configured server secret values.");

function readFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(child) : [child];
  });
}
