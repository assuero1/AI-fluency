import { assertQaEnvironment, readEnv } from "./qa-env.mjs";
import { dbDelete, dbInsert, dbList } from "./lib/supabase-admin.mjs";
import { createFixture, readFixture, recoverFixture, startQaServer, stopQaServer } from "./qa-test-runtime.mjs";

// Live QA verification of the Fase 2 done criterion (multiple senses):
//   card for a specific sense uses the SENSE translation; after rating, the
//   word_senses row's SRS fields advance AND words.review_due_at equals the min
//   over the word's non-suspended senses.
// Runs a real round-trip (HTTP against a QA server + Supabase reads), unlike
// the mocked unit/e2e coverage. QA only — asserts APP_ENV=qa up front.

const envPath = ".env.qa.local";
const env = readEnv(envPath);
assertQaEnvironment(env);

const DAY_MS = 86_400_000;
const now = () => new Date();
const iso = (date) => date.toISOString();
const past = iso(new Date(Date.now() - 48 * 60 * 60 * 1000));
const senseBDue = iso(new Date(Date.now() + 10 * DAY_MS));

// canonicalSenseKey for ASCII-only inputs (NFKC/NFD/diacritic stripping are
// identity on ASCII; mirrors lib/learning/word-senses.ts).
const normalize = (value) => value.normalize("NFKC").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const senseKey = (userId, profileId, lemma, translation) => JSON.stringify([userId, profileId, normalize(lemma), normalize(translation)]);

async function createRecord(tableEnvName, fields) {
  const record = await dbInsert(env, tableEnvName, fields);
  if (!record?.id) throw new Error(`Record was not returned for ${tableEnvName}.`);
  return record;
}

async function getRecord(tableEnvName, id) {
  const record = (await dbList(env, tableEnvName)).find((row) => row.id === id);
  if (!record) throw new Error(`Record not found in ${tableEnvName}: ${id}`);
  return record;
}

async function deleteRecord(tableEnvName, id) {
  await dbDelete(env, tableEnvName, id);
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

  // Arrange: two senses on the fixture word. sense-a is the most-due (past) and
  // primary; sense-b is due in 10 days. Deterministic SRS inputs for sense-a:
  // learning step 1, streak 1 → a "good" rating advances to step 2, due +3 days.
  const word = await getRecord("TEABLE_WORDS_TABLE_ID", wordId);
  const createdAt = iso(now());
  const senseA = await createRecord("TEABLE_WORD_SENSES_TABLE_ID", {
    word_id: wordId,
    sense_key: senseKey(userId, profileId, "fixture", "fixture primary sense"),
    translation: "fixture primary sense",
    part_of_speech: "noun",
    example_sentence: "",
    source: "manual",
    is_primary: true,
    sense_order: 1,
    review_due_at: past,
    review_interval_days: 1,
    review_ease: 2.3,
    review_streak: 1,
    lapse_count: 0,
    learning_step: 1,
    last_reviewed_at: past,
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
    source: "manual",
    is_primary: false,
    sense_order: 2,
    review_due_at: senseBDue,
    review_interval_days: 7,
    review_ease: 2.3,
    review_streak: 4,
    lapse_count: 0,
    learning_step: 3,
    last_reviewed_at: past,
    review_state: "review",
    review_version: "srs-v2",
    created_at: createdAt
  });
  senseIds.push(senseB.id);

  server = await startQaServer(3016, envPath, { userId });

  // Act 1: create a custom flashcard session for the word — no mocks, real API.
  const createResponse = await fetch(`${server.baseUrl}/api/practice/flashcards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wordIds: [wordId] })
  });
  const createBody = await createResponse.json();
  assert(createResponse.status === 201, "flashcard session created via real API", { status: createResponse.status, body: createBody });
  if (createResponse.status !== 201) throw new Error("Session creation failed; aborting.");
  const card = createBody.cards?.[0];
  console.log(`Card: ${JSON.stringify(card)}`);
  assert(createBody.cards?.length === 1, "exactly one card was frozen for the word", createBody.cards?.length);
  assert(card?.targetSenseId === senseA.id, "card targets the most-due sense (target_sense_id)", card?.targetSenseId);
  assert(card?.translation === "fixture primary sense", "card uses the SENSE translation, not another meaning", card?.translation);

  // Act 2: rate the card "good" via the real attempt API.
  const attemptStartedAt = now();
  const attemptResponse = await fetch(`${server.baseUrl}/api/practice/flashcards/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: createBody.sessionId,
      clientAttemptId: "live-sense-srs-0001",
      cardId: card.id,
      presentationNumber: 1,
      userAnswer: card.expectedAnswer,
      rating: "good",
      responseTimeMs: 2_000
    })
  });
  const attemptBody = await attemptResponse.json();
  assert(attemptResponse.status === 201, "attempt accepted via real API", { status: attemptResponse.status, body: attemptBody });

  // Verify against the live QA Supabase project.
  const [afterSenseA, afterSenseB, afterWord] = await Promise.all([
    getRecord("TEABLE_WORD_SENSES_TABLE_ID", senseA.id),
    getRecord("TEABLE_WORD_SENSES_TABLE_ID", senseB.id),
    getRecord("TEABLE_WORDS_TABLE_ID", wordId)
  ]);
  const summary = {
    before: {
      word: { translation: word.fields.translation, review_due_at: word.fields.review_due_at },
      senseA: { review_due_at: past, review_state: "learning", learning_step: 1, review_streak: 1 },
      senseB: { review_due_at: senseBDue, review_state: "review" }
    },
    after: {
      word: afterWord.fields,
      senseA: afterSenseA.fields,
      senseB: afterSenseB.fields
    }
  };
  console.log(`Live field values: ${JSON.stringify(summary, null, 2)}`);

  const senseADueMs = Date.parse(afterSenseA.fields.review_due_at ?? "");
  const daysAhead = (senseADueMs - attemptStartedAt.getTime()) / DAY_MS;
  assert(afterSenseA.fields.last_rating === "good", "sense: last_rating advanced to good", afterSenseA.fields.last_rating);
  assert(afterSenseA.fields.review_version === "srs-v2", "sense: review written by srs-v2", afterSenseA.fields.review_version);
  assert(afterSenseA.fields.review_state === "learning", "sense: still in learning after first good (step 1→2)", afterSenseA.fields.review_state);
  assert(Number(afterSenseA.fields.learning_step) === 2, "sense: learning_step advanced 1 → 2", afterSenseA.fields.learning_step);
  assert(Number(afterSenseA.fields.review_streak) === 2, "sense: streak advanced 1 → 2", afterSenseA.fields.review_streak);
  assert(senseADueMs > Date.parse(past), "sense: review_due_at moved forward", afterSenseA.fields.review_due_at);
  assert(daysAhead > 2 && daysAhead < 3.6, "sense: due ≈ +3 days at 09:00 learner tz (learning step 2)", { due: afterSenseA.fields.review_due_at, daysAhead });

  // Postgres normalizes timestamptz on write, so compare instants, not strings.
  assert(Date.parse(afterSenseB.fields.review_due_at ?? "") === Date.parse(senseBDue), "sense-b (not exercised) is untouched", afterSenseB.fields.review_due_at);
  assert(afterSenseB.fields.review_state === "review", "sense-b keeps its review state", afterSenseB.fields.review_state);

  const activeDues = [afterSenseA, afterSenseB]
    .filter((sense) => sense.fields.review_state !== "suspended")
    .map((sense) => sense.fields.review_due_at)
    .filter((due) => due && Number.isFinite(Date.parse(due)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  assert(afterWord.fields.review_due_at === activeDues[0], "word: review_due_at = min over non-suspended senses", { word: afterWord.fields.review_due_at, minSenseDue: activeDues[0] });
  assert(afterWord.fields.review_due_at === afterSenseA.fields.review_due_at, "word: min due is the exercised sense's new due", afterWord.fields.review_due_at);
  assert(afterWord.fields.review_state === "learning", "word: review_state = worst sense state (learning > review)", afterWord.fields.review_state);
  assert(afterWord.fields.translation === "fixture primary sense", "word: translation re-aggregated from the primary sense", afterWord.fields.translation);
  assert(afterWord.fields.last_rating === "good", "word: last_rating re-aggregated", afterWord.fields.last_rating);

  const attempts = await dbList(env, "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID");
  const live = attempts.find((record) => record.fields?.practice_session_id === createBody.sessionId);
  assert(live?.fields?.sense_id === senseA.id, "attempt row carries sense_id", live?.fields?.sense_id);
  assert(live?.fields?.review_applied === true, "attempt marked review_applied", live?.fields?.review_applied);
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
