import { assertQaEnvironment, readEnv, recordsFrom, required, tableDefinitions, teableRequest } from "./qa-env.mjs";

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");
const env = readEnv(envPath);
assertQaEnvironment(env);

const nonEmpty = [];
for (const [envName, tableName] of tableDefinitions) {
  const result = await teableRequest(env, `/api/table/${required(env, envName)}/record?take=1&fieldKeyType=name`);
  const hasPersistedData = recordsFrom(result).some((record) => Object.keys(record.fields ?? {}).length > 0);
  if (hasPersistedData) nonEmpty.push(tableName);
}

if (nonEmpty.length) throw new Error(`QA base is not empty: ${nonEmpty.join(", ")}.`);
console.log("QA base verified empty of persisted fixture data.");
