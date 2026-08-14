import fs from "node:fs";

export function readEnv(path) {
  if (!fs.existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

export function required(env, name, aliases = []) {
  for (const candidate of [name, ...aliases]) {
    const value = env[candidate]?.trim();
    if (value && !value.startsWith("replace-with") && !value.includes("your-")) return value;
  }
  throw new Error(`${name} is required.`);
}

export function assertQaEnvironment(env) {
  if (env.APP_ENV !== "qa") throw new Error("QA scripts require APP_ENV=qa.");
  if (env.QA_RUN_NAMESPACE !== "AI_FLUENCY_QA") {
    throw new Error("QA scripts require QA_RUN_NAMESPACE=AI_FLUENCY_QA.");
  }
}
