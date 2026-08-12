import { assertQaEnvironment, readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";
import { createFixture, readFixture, recoverFixture, startQaServer, stopQaServer } from "./qa-test-runtime.mjs";

// Live QA verification of the Fase 3 done criterion (sense UI):
//   the word detail page lists every sense with its own SRS state; a manual
//   sense added via POST /api/words/:wordId/senses appears on the page and
//   becomes schedulable (word cache re-aggregated to a due date in the past);
//   a duplicate manual sense is rejected with 409.
// Runs a real round-trip (HTTP against a QA server + Teable REST reads), unlike
// the mocked unit/e2e coverage. QA only — asserts APP_ENV=qa up front.

const envPath = ".env.qa.local";
const env = readEnv(envPath);
assertQaEnvironment(env);
const tableId = (name) => required(env, name);

const now = () => new Date();
const iso = (date) => date.toISOString();
const past = iso(new Date(Date.now() - 48 * 60 * 60 * 1000));
const future = iso(new Date(Date.now() + 10 * 86_400_000));

// canonicalSenseKey for ASCII-only inputs (NFKC/NFD/diacritic stripping are
// identity on ASCII; mirrors lib/learning/word-senses.ts).
const normalize = (value) => value.normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const senseKey = (userId, profileId, lemma, translation) => JSON.stringify([userId, profileId, normalize(lemma), normalize(translation)]);

async function createRecord(tableEnvName, fields) {
  const result = await teableRequest(env, `/api/table/${tableId(tableEnvName)}/record?fieldKeyType=name`, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] })
  });
  const record = recordsFrom(result)[0] ?? result;
  if (!record?.id) throw new Error(`Record was not returned for ${tableEnvName}.`);
  return record;
}

async function getRecord(tableEnvName, id) {
  const result = await teableRequest(env, `/api/table/${tableId(tableEnvName)}/record/${id}?fieldKeyType=name`);
  return recordsFrom(result)[0] ?? result;
}

async function deleteRecord(tableEnvName, id) {
  await teableRequest(env, `/api/table/${tableId(tableEnvName)}/record/${id}?fieldKeyType=name`, { method: "DELETE" });
}

const assertions = [];
const cleanupFailures = [];
function assert(condition, message, evidence) {
  assertions.push({ ok: Boolean(condition), message, evidence });
  if (!condition) console.error(`  ✗ ${message}${evidence === undefined ? "" : ` — got: ${JSON.stringify(evidence)}`}`);
  else console.log(`  ✓ ${message}`);
}

let runId;
let server;
const senseIds = [];
let failure;

try {
  runId = createFixture(envPath);
  const fixture = readFixture(runId);
  const userId = fixture.records.TEABLE_USERS_TABLE_ID[0];
  const profileId = fixture.records.TEABLE_LANGUAGE_PROFILES_TABLE_ID[0];
  const wordId = fixture.records.TEABLE_WORDS_TABLE_ID[0];
  console.log(`Fixture ${runId}: user ${userId}, word ${wordId}`);

  // Arrange: two senses on the fixture word — an overdue primary and a future
  // secondary, so the page shows distinct per-sense SRS states.
  const createdAt = iso(now());
  const senseA = await createRecord("TEABLE_WORD_SENSES_TABLE_ID", {
    word_id: wordId,
    sense_key: senseKey(userId, profileId, "fixture", "fixture primary sense"),
    translation: "fixture primary sense",
    part_of_speech: "noun",
    example_sentence: "The fixture word in context.",
    source: "backfill",
    is_primary: true,
    sense_order: 1,
    review_due_at: past,
    review_interval_days: 1,
    review_ease: 2.3,
    review_streak: 2,
    lapse_count: 1,
    learning_step: 1,
    review_state: "learning",
    review_version: "srs-v2",
    created_at: createdAt
  });
  senseIds.push(senseA.id);
  const senseB = await createRecord("TEABLE_WORD_SENSES_TABLE_ID", {
    word_id: wordId,
    sense_key: senseKey(userId, profileId, "fixture", "fixture secondary sense"),
    translation: "fixture secondary sense",
    part_of_speech: "noun",
    example_sentence: "",
    source: "chat",
    is_primary: false,
    sense_order: 2,
    review_due_at: future,
    review_interval_days: 7,
    review_ease: 2.3,
    review_streak: 4,
    lapse_count: 0,
    learning_step: 3,
    review_state: "review",
    review_version: "srs-v2",
    created_at: createdAt
  });
  senseIds.push(senseB.id);

  server = await startQaServer(3017, envPath, { userId });

  // Act 1: the polysemous word page lists every sense with its own SRS state.
  // React server HTML separates adjacent text nodes with <!-- --> comments;
  // strip them so multi-expression strings (e.g. "2 acertos seguidos") match.
  const pageResponse = await fetch(`${server.baseUrl}/palavras/${wordId}`);
  const pageHtml = (await pageResponse.text()).replace(/<!-- -->/g, "");
  assert(pageResponse.status === 200, "word detail page renders", pageResponse.status);
  assert(pageHtml.includes("Significados"), "page shows the Significados section");
  assert(pageHtml.includes("fixture primary sense"), "page lists the primary sense translation");
  assert(pageHtml.includes("fixture secondary sense"), "page lists the secondary sense translation");
  assert(pageHtml.includes("The fixture word in context."), "page shows the sense example sentence");
  assert(pageHtml.includes("2 acertos seguidos"), "page shows the primary sense streak (2)");
  assert(pageHtml.includes("4 acertos seguidos"), "page shows the secondary sense streak (4)");
  assert(pageHtml.includes("Adicionar significado"), "page offers the add-sense button");
  assert(pageHtml.indexOf("fixture primary sense") < pageHtml.indexOf("fixture secondary sense"), "senses render in sense_order (primary first)");

  // Act 2: add a manual sense via the real API.
  const addResponse = await fetch(`${server.baseUrl}/api/words/${wordId}/senses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ translation: "fixture manual sense", partOfSpeech: "noun", exampleSentence: "A manual fixture example." })
  });
  const addBody = await addResponse.json();
  assert(addResponse.status === 201, "manual sense created via real API", { status: addResponse.status, body: addBody });
  if (addResponse.status !== 201) throw new Error("Manual sense creation failed; aborting.");
  const createdSenseId = addBody.sense?.id;
  assert(typeof createdSenseId === "string" && createdSenseId.length > 0, "response carries the created sense id", addBody.sense);
  if (createdSenseId) senseIds.push(createdSenseId);
  assert(addBody.sense?.source === "manual", "created sense has source manual", addBody.sense?.source);
  assert(addBody.sense?.isPrimary === false, "created sense is not primary", addBody.sense?.isPrimary);
  assert(addBody.sense?.reviewState === "new", "created sense starts in review state new", addBody.sense?.reviewState);

  // Verify against the live QA Teable: the sense row and the re-aggregated word cache.
  const createdSense = await getRecord("TEABLE_WORD_SENSES_TABLE_ID", createdSenseId);
  assert(createdSense.fields?.translation === "fixture manual sense", "sense row persisted with the translation", createdSense.fields?.translation);
  assert(Number(createdSense.fields?.sense_order) === 3, "sense gets the next sense_order (3)", createdSense.fields?.sense_order);
  assert(createdSense.fields?.review_state === "new", "sense row starts as new", createdSense.fields?.review_state);
  const manualDueMs = Date.parse(createdSense.fields?.review_due_at ?? "");
  assert(Number.isFinite(manualDueMs) && manualDueMs <= Date.now(), "sense is scheduled immediately (due now)", createdSense.fields?.review_due_at);

  const afterWord = await getRecord("TEABLE_WORDS_TABLE_ID", wordId);
  const wordDueMs = Date.parse(afterWord.fields?.review_due_at ?? "");
  assert(Number.isFinite(wordDueMs) && wordDueMs <= Date.now(), "word cache re-aggregated: due now → schedulable in the queue", afterWord.fields?.review_due_at);
  assert(afterWord.fields?.review_state === "learning", "word cache keeps the worst sense state (learning)", afterWord.fields?.review_state);
  assert(afterWord.fields?.translation === "fixture primary sense", "word cache translation stays the primary sense's", afterWord.fields?.translation);

  // Act 3: the new sense appears on the page.
  const pageAfter = (await (await fetch(`${server.baseUrl}/palavras/${wordId}`)).text()).replace(/<!-- -->/g, "");
  assert(pageAfter.includes("fixture manual sense"), "page lists the manual sense after creation");
  assert(pageAfter.includes("A manual fixture example."), "page shows the manual sense example");
  assert(pageAfter.includes("3 significados"), "page counts three senses now");

  // Act 4: a duplicate manual sense is rejected with 409 (case/accent-insensitive).
  const duplicateResponse = await fetch(`${server.baseUrl}/api/words/${wordId}/senses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ translation: "  FIXTURE MANUAL SENSE " })
  });
  const duplicateBody = await duplicateResponse.json();
  assert(duplicateResponse.status === 409, "duplicate manual sense rejected with 409", { status: duplicateResponse.status, body: duplicateBody });
  assert(typeof duplicateBody.error === "string" && duplicateBody.error.includes("já existe"), "409 message is clear", duplicateBody.error);

  // Act 5: out-of-scope word ids get 404.
  const missingResponse = await fetch(`${server.baseUrl}/api/words/rec_does_not_exist/senses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ translation: "ghost sense" })
  });
  assert(missingResponse.status === 404, "unknown word rejected with 404", missingResponse.status);
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  if (server) await stopQaServer(server.child).catch((error) => cleanupFailures.push(error));
  for (const senseId of senseIds) {
    try {
      await deleteRecord("TEABLE_WORD_SENSES_TABLE_ID", senseId);
      console.log(`Deleted sense ${senseId}.`);
    } catch (error) {
      cleanupFailures.push(error);
      console.error(`Failed to delete sense ${senseId}:`, error);
    }
  }
  if (runId) {
    try {
      const output = recoverFixture(runId, envPath);
      process.stdout.write(output);
    } catch (error) {
      cleanupFailures.push(error);
      console.error(`Failed to recover fixture ${runId}:`, error);
    }
  }
}

const failed = assertions.filter((item) => !item.ok);
if (failed.length || failure || cleanupFailures.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, failure: failure?.message, cleanupFailures: cleanupFailures.length }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, assertions: assertions.length, fixture: runId, cleanup: "senses deleted + fixture recovered" }, null, 2));
}
