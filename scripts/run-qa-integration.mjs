import { createFixture, readFixture, recoverFixture, startQaServer, stopQaServer } from "./qa-test-runtime.mjs";

const envPath = ".env.qa.local";
const runIds = [];
let server;
const assertions = [];
let failure;
const cleanupFailures = [];

try {
  const primaryRunId = createFixture(envPath);
  runIds.push(primaryRunId);
  const secondaryRunId = createFixture(envPath);
  runIds.push(secondaryRunId);
  const fixture = readFixture(primaryRunId);
  const secondaryFixture = readFixture(secondaryRunId);
  const userId = fixture.records.TEABLE_USERS_TABLE_ID[0];
  server = await startQaServer(3013, envPath, { userId });
  const completedConversationId = fixture.records.TEABLE_CONVERSATIONS_TABLE_ID[1];
  const foreignConversationId = secondaryFixture.records.TEABLE_CONVERSATIONS_TABLE_ID[0];

  const connections = await fetch(`${server.baseUrl}/api/settings/connections`);
  assert(connections.ok, "connections endpoint is available");
  assert(connections.headers.get("cache-control")?.includes("no-store"), "safe API responses use no-store");
  assert(connections.headers.get("x-ai-fluency-environment") === "qa", "QA marker is present");

  const profile = await fetch(`${server.baseUrl}/api/profile`);
  const profileBody = await profile.json();
  assert(profile.ok && profileBody.profile?.user?.id === userId, "the QA server resolves only its pinned fixture user");

  const completedMessage = await fetch(`${server.baseUrl}/api/conversations/${completedConversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "This must stay read-only.", clientRequestId: "qa-integration-completed-0001" })
  });
  assert(completedMessage.status === 409, "completed conversations reject messages");

  const invalidQuickAction = await fetch(`${server.baseUrl}/api/conversations/${fixture.records.TEABLE_CONVERSATIONS_TABLE_ID[0]}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete" })
  });
  assert(invalidQuickAction.status === 422, "unknown quick actions are rejected");

  const completedQuickAction = await fetch(`${server.baseUrl}/api/conversations/${completedConversationId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "explain" })
  });
  assert(completedQuickAction.status === 409, "completed conversations reject quick actions");

  const foreignMessage = await fetch(`${server.baseUrl}/api/conversations/${foreignConversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "This belongs to another fixture.", clientRequestId: "qa-integration-foreign-0001" })
  });
  assert(foreignMessage.status === 404, "records from another fixture user remain inaccessible");

  const renamedProfile = await fetch(`${server.baseUrl}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Renamed QA learner" })
  });
  assert(renamedProfile.ok, "fixture recovery remains keyed by user ID after a profile rename");

  const originalProfileId = fixture.records.TEABLE_LANGUAGE_PROFILES_TABLE_ID[0];
  const spanishProfile = await fetch(`${server.baseUrl}/api/language-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language_code: "es",
      language_name: "Espanhol",
      level: "Intermediário (B1)",
      learning_goal: "QA language isolation",
      correction_style: "Corrigir sempre"
    })
  });
  assert(spanishProfile.ok, "a second language can be created for the same learner");
  const spanishWords = await fetch(`${server.baseUrl}/api/words`);
  const spanishWordsBody = await spanishWords.json();
  assert(spanishWords.ok && spanishWordsBody.words?.length === 0, "the second language does not expose English vocabulary");

  const restoreEnglish = await fetch(`${server.baseUrl}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeLanguageId: originalProfileId })
  });
  assert(restoreEnglish.ok, "the original language can be restored");
  const restoredWords = await fetch(`${server.baseUrl}/api/words`);
  const restoredWordsBody = await restoredWords.json();
  assert(restoredWords.ok && restoredWordsBody.words?.some((word) => word.displayText === "fixture"), "restoring English restores its vocabulary exactly");

  const flashcardStart = await fetch(`${server.baseUrl}/api/practice/flashcards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ criterion: "least_used", count: 2 })
  });
  const flashcardStartBody = await flashcardStart.json();
  assert(flashcardStart.status === 201 && flashcardStartBody.sessionId && flashcardStartBody.cards?.length === 2, `flashcard session persists a frozen two-card deck (status ${flashcardStart.status}: ${flashcardStartBody.error ?? "unexpected response"}; ${JSON.stringify(flashcardStartBody.detail ?? {})})`);
  for (const [index, card] of flashcardStartBody.cards.entries()) {
    const attempt = await fetch(`${server.baseUrl}/api/practice/flashcards/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: flashcardStartBody.sessionId,
        clientAttemptId: `qa-flashcard-attempt-${index + 1}-0001`,
        cardId: card.id,
        presentationNumber: 1,
        userAnswer: card.expectedAnswer,
        rating: "good",
        forgot: false,
        usedSpeech: false,
        responseTimeMs: 1200,
        audioReplayCount: index === 0 ? 2 : 0,
        usedSlowAudio: index === 0,
        audioFailed: false
      })
    });
    assert(attempt.status === 201, `flashcard attempt ${index + 1} persists idempotently`);
  }
  const flashcardComplete = await fetch(`${server.baseUrl}/api/practice/flashcards/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: flashcardStartBody.sessionId, clientCompletionId: "qa-flashcard-complete-0001", answers: [] })
  });
  const flashcardCompleteBody = await flashcardComplete.json();
  assert(flashcardComplete.ok && flashcardCompleteBody.presentationCount === 2 && flashcardCompleteBody.uniqueCardCount === 2, "flashcard completion derives metrics from persisted attempts");
  const reviewedWords = await fetch(`${server.baseUrl}/api/words`);
  const reviewedWordsBody = await reviewedWords.json();
  assert(reviewedWords.ok && reviewedWordsBody.words?.every((word) => word.reviewIntervalDays === 3 && word.reviewStreak === 1 && word.reviewVersion === "srs-v1" && word.lastRating === "good"), "flashcard completion persists versioned adaptive review fields");

  const invalidAudio = await fetch(`${server.baseUrl}/api/voice/${"a".repeat(64)}`);
  assert(invalidAudio.status === 404, "unknown cached audio is rejected");
  assert(invalidAudio.headers.get("cache-control")?.includes("no-store"), "unknown audio is not privately cached");

  const populatedExport = await fetch(`${server.baseUrl}/api/export`);
  const populatedExportBody = await populatedExport.json();
  assert(populatedExport.ok, "a populated personal export is available");
  assert(populatedExportBody.schemaVersion === 2, "personal export declares its schema version");
  assert(populatedExportBody.language?.code === "en", "personal export declares the active language");
  assert(populatedExportBody.learningHistory?.flashcards?.length === 2 && populatedExportBody.learningHistory?.flashcardAttempts?.length === 2, "personal export includes flashcards and attempts");
  assert(populatedExportBody.learningHistory?.flashcardAttempts?.some((attempt) => attempt.fields?.audio_replay_count === 2 && attempt.fields?.used_slow_audio === true && attempt.fields?.answered_after_audio_replay === true), "personal export includes persisted audio telemetry");
  assert(populatedExport.headers.get("content-disposition")?.includes("ai-fluency-en-"), "export filename includes the active language");
  assert(!JSON.stringify(populatedExportBody).includes("API_KEY"), "personal export contains no provider key names");

  const deletionChallenge = await fetch(`${server.baseUrl}/api/data/delete-confirmation`, { method: "POST" });
  const deletionChallengeBody = await deletionChallenge.json();
  assert(deletionChallenge.ok && deletionChallengeBody.confirmationToken, "history deletion requires a server confirmation");
  const deletion = await fetch(`${server.baseUrl}/api/data`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmationToken: deletionChallengeBody.confirmationToken,
      phrase: deletionChallengeBody.confirmationPhrase
    })
  });
  const deletionBody = await deletion.json();
  assert(deletion.ok, "active-language learning history can be deleted in QA");
  assert(deletionBody.preserved?.includes("other_language_profiles"), "history deletion preserves other languages");

  const emptyExport = await fetch(`${server.baseUrl}/api/export`);
  const emptyExportBody = await emptyExport.json();
  assert(emptyExport.ok && emptyExportBody.activeLanguageProfile?.id, "empty export preserves the active language profile");
  assert(Object.values(emptyExportBody.learningHistory).every((records) => Array.isArray(records) && records.length === 0), "empty export contains no deleted learning records");

  console.log(JSON.stringify({ ok: true, runIds, assertions, cleanup: "pending" }));
} catch (error) {
  failure = error;
  console.error(JSON.stringify({
    ok: false,
    assertions,
    error: error instanceof Error ? error.message : String(error),
    cleanup: "pending"
  }));
} finally {
  for (const runId of [...runIds].reverse()) {
    try {
      recoverFixture(runId, envPath);
    } catch (error) {
      cleanupFailures.push({ runId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (runIds.length) console.log(JSON.stringify({ ok: cleanupFailures.length === 0, runIds, cleanup: cleanupFailures.length ? "failed" : "passed", cleanupFailures }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (server) await stopQaServer(server.child);
}

if (failure) throw failure;
if (cleanupFailures.length) throw new Error(`Integration cleanup failed for: ${cleanupFailures.map((item) => item.runId).join(", ")}`);

function assert(condition, label) {
  if (!condition) throw new Error(`Integration assertion failed: ${label}`);
  assertions.push(label);
}
