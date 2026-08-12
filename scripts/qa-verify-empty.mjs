import { assertQaEnvironment, readEnv } from "./qa-env.mjs";
import { dbList } from "./lib/supabase-admin.mjs";

const envIndex = process.argv.indexOf("--env");
const envPath = envIndex >= 0 ? process.argv[envIndex + 1] : ".env.qa.local";
if (!envPath) throw new Error("--env requires a path.");
const env = readEnv(envPath);
assertQaEnvironment(env);

// QA fixtures live in the same Supabase project as production data, so "empty"
// means "no QA fixture records left" — not "no records at all". Fixture users
// are named `QA User ${runId}` and every fixture emits a qa_fixture_created
// app event; both markers are deleted by qa-cleanup/qa-recover.
const nonEmpty = [];
const users = await dbList(env, "TEABLE_USERS_TABLE_ID");
if (users.some((record) => typeof record.fields?.Name === "string" && record.fields.Name.startsWith("QA User qa-"))) {
  nonEmpty.push("Users");
}
const events = await dbList(env, "TEABLE_APP_EVENTS_TABLE_ID");
if (events.some((record) => record.fields?.event_name === "qa_fixture_created")) {
  nonEmpty.push("AppEvents");
}

if (nonEmpty.length) throw new Error(`QA base is not empty: ${nonEmpty.join(", ")}.`);
console.log("QA base verified empty of persisted fixture data.");
