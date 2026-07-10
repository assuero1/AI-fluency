import fs from "node:fs";

function getOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = getOption("--from") ?? ".env.local";
const targetPath = getOption("--to") ?? ".env.qa.local";
const qaBaseId = getOption("--base-id");

if (!qaBaseId) throw new Error("--base-id is required.");
if (!fs.existsSync(sourcePath)) throw new Error(`Source environment not found: ${sourcePath}`);
if (fs.existsSync(targetPath)) throw new Error(`Refusing to overwrite existing QA environment: ${targetPath}`);

const tablePattern = /^TEABLE_(?:[A-Z_]+_TABLE_ID|HEALTH_TABLE_ID|BOOKS_TABLE_ID|NOTES_TABLE_ID)=/;
const lines = fs
  .readFileSync(sourcePath, "utf8")
  .split(/\r?\n/)
  .filter((line) =>
    !tablePattern.test(line) &&
    !/^APP_ENV=/.test(line) &&
    !/^APP_URL=/.test(line) &&
    !/^QA_RUN_NAMESPACE=/.test(line) &&
    !/^AI_FLUENCY_USER_ID=/.test(line)
  );

lines.push("APP_ENV=qa");
lines.push("APP_URL=http://localhost:3012");
lines.push("QA_RUN_NAMESPACE=AI_FLUENCY_QA");
lines.push("AI_FLUENCY_USER_ID=");
lines.push(`TEABLE_BASE_ID=${qaBaseId}`);

fs.writeFileSync(targetPath, `${lines.filter(Boolean).join("\n")}\n`, { mode: 0o600 });
console.log(`Created ${targetPath} for QA base ${qaBaseId}. Table IDs must be populated with setup-teable-schema.`);
