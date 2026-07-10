# Robust Validation and Remediation Plan

## Objective

Bring AI Fluency into full alignment with `AI_FLUENCY_BUILD_PLAN.md` and establish a repeatable release gate for its personal, private MVP.

This plan separates three concerns that must not be mixed:

1. Fix product and data-integrity gaps found in the audit.
2. Prove the expected behavior with automated tests and controlled QA data.
3. Verify capabilities that only exist on the final HTTPS VPS and real mobile devices.

## Guiding Rules

- Do not use the personal production learning history as a test fixture.
- Use a dedicated Teable QA base, or tag every QA record with an explicit `QA-` prefix and clean it up after each run.
- Keep the deployment private. This MVP has one server-side personal user and no authentication boundary.
- No test may send a real API key to a browser, log it, or include it in snapshots.
- A phase is complete only when its acceptance criteria and its automated checks both pass.

## Phase 0: QA Foundation and Baseline

### Goal

Create an isolated, reproducible environment before changing learning logic.

### Work

1. Create a QA Teable base with the same schema as the production base.
2. Create `.env.qa.local` outside version control with QA-only Teable, AI, and Kokoro values.
3. Add an explicit `APP_ENV=qa` and a visible non-production server marker outside the normal learner UI, such as a response header.
4. Add a script that validates every required environment variable and every mapped Teable table before the app starts QA tests.
5. Add a QA fixture helper that creates one user, one English profile, dated feedback, words due for review, and both active and completed conversations.
6. Add a cleanup helper that deletes only records created by the current test run.

### Acceptance Criteria

- QA uses a separate Teable base or a safely isolated record namespace.
- Missing table mappings fail before tests create learning data.
- A test run can create and clean its own records without touching personal history.
- Secrets are not printed in terminal output, test reports, screenshots, or browser pages.

## Phase 1: Make Learning State Explicit

### Goal

Prevent invalid records and make a conversation lifecycle enforceable.

### Product Rules to Implement

1. A learner must have an active `LanguageProfile` before starting any conversation.
2. Teable and AI must be ready before a conversation, topic, or practice session is created.
3. A conversation has explicit states: `active`, `completed`, and optionally `abandoned`.
4. Only `active` conversations accept messages, topic changes, or completion.
5. A completed conversation is read-only forever.
6. The Chat tab opens the current active conversation; without one, it offers a clear action to create a new conversation instead of loading an arbitrary historical record.
7. Every record must be scoped to the active personal user and profile, even in the single-user MVP.

### Implementation Scope

- `lib/learning/conversations.ts`
- `lib/learning/profile.ts`
- `app/page.tsx`
- `app/chat/page.tsx`
- Conversation route handlers
- Shared validation/error response helpers

### Automated Tests

1. Starting a conversation without a profile returns `409` or `422` and creates no records.
2. Starting without Teable or AI readiness returns an actionable error and creates no records.
3. Sending a message to a completed conversation returns `409` and creates no message, correction, word, or event.
4. Visiting Chat with no active conversation does not mutate data until the user explicitly starts one.
5. Every lookup ignores records outside the current user/profile scope.

### Acceptance Criteria

- No empty `language_profile_id` is persisted.
- A completed conversation cannot be changed through UI or API.
- Failure before AI generation leaves no orphan conversation, topic, or practice session.

## Phase 2: Onboarding and Connection Gates

### Goal

Guarantee that every learner enters the app through a valid configuration and language profile.

### Work

1. Add a server-side route guard for `/` and `/chat`:
   - no profile -> `/onboarding`
   - profile but missing Teable or AI -> `/settings/connections`
   - ready -> requested route
2. Make onboarding idempotent: revisiting it loads the active profile rather than creating duplicates.
3. Decide and document the configuration model:
   - recommended: secrets remain environment-only;
   - connection screen edits only safe, non-secret settings stored server-side;
   - changing a secret requires deployment environment administration, not a browser form.
4. Replace the current misleading save action with either real, server-side persistence of allowed fields or a clear environment-managed status screen.
5. Add the missing settings APIs only for fields that are safe to modify at runtime. Never create an API that returns stored secrets.

### Automated and Manual Tests

1. New QA base -> `/` redirects to onboarding.
2. Completing onboarding with valid dependencies -> Home.
3. Completing onboarding with a missing dependency -> Connections.
4. Refreshing after onboarding preserves language, level, goal, correction style, and accessibility preferences.
5. Test each connection's ready, loading, error, and recovery states.

### Acceptance Criteria

- The user cannot reach a real chat without an active profile and ready dependencies.
- The connection page accurately reflects which configuration is environment-managed.
- No browser response contains a full API key.

## Phase 3: Conversation and Personalization Integrity

### Goal

Make the tutor behavior genuinely use the learner memory captured by the app.

### Work

1. Add a `getTutorContext` service that returns, for the active profile:
   - language, level, goal, and correction style;
   - up to five due/recent words to review;
   - recurring error types and representative corrections from recent sessions;
   - recent topics and a bounded message history;
   - calendar focus only when calendar memory is enabled.
2. Include that context in both the initial tutor prompt and structured-turn prompt.
3. Enforce structured AI output with schema validation. Reject malformed fields, normalize allowed enums, and use a graceful tutor-only fallback without inventing corrections.
4. Remove hard-coded grammar and vocabulary fallbacks from normal production learning analysis. Use them only in explicit demo/test mode, if retained at all.
5. Add a topic-change flow:
   - `Mudar` opens a confirmation dialog;
   - cancel keeps the chat untouched;
   - confirm either changes the active topic with an event or ends the current session and starts a new one, according to a documented rule;
   - preserve the existing transcript.
6. Make message submission idempotent with a client request ID to avoid duplicate records on retry.

### Automated Tests

1. A QA profile with a due word and recurring tense error produces a prompt containing both.
2. Calendar memory disabled removes calendar feedback from prompt context.
3. Valid structured output creates exactly the expected messages, corrections, words, occurrences, and events.
4. Invalid AI JSON creates no false correction; chat still receives an understandable assistant reply.
5. Retrying the same message request does not duplicate data.
6. Topic change cancel, confirm, and API authorization/state checks work.

### Acceptance Criteria

- The tutor has the planned adaptive context on every new turn.
- Corrections are traceable to real AI output and user text.
- Changing topic cannot silently discard or corrupt a conversation.

## Phase 4: Daily Feedback, Vocabulary, Calendar, and Progress

### Goal

Validate the complete learning loop and remove misleading placeholder data.

### Work

1. Define daily-feedback aggregation: one record per user/profile/date, with a documented merge strategy when multiple conversations end on the same date.
2. Make completion idempotent so a second end request cannot regenerate feedback or overwrite scores unexpectedly.
3. Derive Home metrics exclusively from persisted records.
4. Replace the Home's hard-coded suggestions and scores with truthful empty states.
5. Show suggestion provenance clearly: calendar feedback, weak words, recurring error, user topic, or AI suggestion.
6. Verify word grouping by lemma, last use, total use, due date, occurrence context, and correction association.
7. Verify that calendar, progress, and word-review practice create the specified conversation modes and context.

### Automated Tests

1. Completing one conversation creates one feedback record and marks its calendar date.
2. Completing two conversations on one date follows the documented aggregation rule.
3. Repeating the completion request is harmless.
4. A blank account displays zero/empty states, never invented progress.
5. Each word filter returns the intended subset.
6. Weak-word, calendar-focus, and progress-focus actions create the intended topic and conversation mode.
7. Progress metrics match the persisted QA fixture values.

### Acceptance Criteria

- Home, Calendar, Words, Summary, and Progress agree with Teable records.
- No learner-facing metric claims activity that did not happen.
- Feedback and recommendation behavior is deterministic for the QA fixture.

## Phase 5: Voice, Native STT, and Resilience

### Goal

Verify that voice improves the chat but never blocks text learning.

### Work

1. Keep Kokoro synthesis asynchronous from message creation.
2. Validate cache behavior: deterministic IDs, cache hit, expiration, size pruning, and private file storage.
3. Restrict synthesis input to the expected text, voice, and format allowlists.
4. Treat native browser STT as progressive enhancement:
   - correct locale for every supported learning language;
   - microphone permission denial remains a non-blocking text-chat state;
   - unsupported browser provides a clear text fallback;
   - no audio is uploaded to the server for native STT.
5. Confirm audio/transcript preferences modify only the intended UI and do not erase the learning data needed for feedback.

### Automated Tests

1. Kokoro unavailable -> assistant text remains usable and the player reports a recoverable failure.
2. First synthesis -> cache miss; second equal synthesis -> cache hit and same audio ID.
3. Audio route rejects malformed IDs and serves valid content with private cache headers.
4. Audio-disabled profile has no voice controls but chat remains usable.
5. Browser-level tests cover the unsupported STT state; manual device tests cover permissions and recognition.

### Acceptance Criteria

- Text chat works with Kokoro off or failing.
- No audio cache is publicly mounted.
- Voice and STT respect the active language and preferences.

## Phase 6: PWA, Offline, Security, and Privacy

### Goal

Provide an honest offline experience and preserve private learning data.

### Work

1. Change the service worker strategy:
   - pre-cache only static shell assets, offline page, icon, and required static bundles;
   - use network-first navigation;
   - on navigation failure, always return `/offline` for dynamic learner routes;
   - never cache server-rendered pages containing Home, Chat, Calendar, Words, Profile, or Progress data.
2. Version and clean caches on worker activation.
3. Add Content Security Policy regression tests.
4. Keep all API responses `no-store`, except the intentional private cached-audio GET route.
5. Verify exports do not include provider secrets or cached audio paths with private infrastructure details.
6. Keep the deployment behind VPN, Tailscale, or reverse-proxy authentication. Treat public exposure without real app authentication as a release blocker.

### Automated Tests

1. Service-worker tests assert no dynamic HTML response is cached.
2. Offline navigation after visiting Home returns the offline page, not cached metrics.
3. Cached audio GET carries `private` cache headers; all other API responses carry `no-store`.
4. Bundle scan finds no configured API-key values or server-only environment values in client assets.
5. Export and profile endpoints reveal only permitted masked configuration status.

### Acceptance Criteria

- Offline never presents stale learning data as current.
- PWA installation works from the final HTTPS origin.
- API keys remain server-only throughout build, browser, API, export, and logs.

## Phase 7: Automated Test Harness and CI

### Goal

Turn the validation matrix into a repeatable gate.

### Work

1. Add unit tests for pure learning, prompt, date, cache, and filtering functions.
2. Add route/service integration tests against the QA Teable environment or a faithful Teable API test double.
3. Add Playwright browser tests for:
   - onboarding gates;
   - Home topic start;
   - active/completed conversation behavior;
   - topic-change confirmation;
   - words, calendar, progress, and profile navigation;
   - connection error states;
   - mobile viewport and standard bottom navigation.
4. Add production-build smoke tests that start `next start` and exercise safe read endpoints.
5. Add scripts:
   - `test:unit`
   - `test:integration`
   - `test:e2e`
   - `test:qa:seed`
   - `test:qa:cleanup`
   - `test:release`
6. Require `lint`, `typecheck`, build, and all non-device tests before deployment.

### Acceptance Criteria

- Every audit finding has at least one regression test.
- Test reports identify fixture IDs and clean-up status without exposing secrets.
- A failed release check returns a non-zero exit code and blocks deployment.

## Phase 8: Final HTTPS VPS and Device Acceptance

### Goal

Prove the behaviors that cannot be simulated completely in localhost.

### Manual Test Matrix

| Area | Procedure | Expected result |
| --- | --- | --- |
| Private access | Open app outside the private network | Access is denied by the proxy/VPN layer |
| PWA install | Install through Android Chrome and iOS Safari | Standalone app opens from the chosen icon |
| Offline | Visit Home, disable network, navigate to Home and Chat | Offline screen appears; no stale metrics/chat is rendered |
| Native STT | Allow microphone, speak in each supported language | Text appears in composer using the expected locale |
| STT denial | Deny microphone | Clear non-blocking message; typing continues |
| Kokoro | Play tutor message, correction explanation, word pronunciation | Audio plays; text remains visible when audio fails |
| Full learning loop | Onboard -> topic -> chat -> correction -> end -> summary | Teable, Home, Calendar, Words, and Progress agree |
| Privacy | Inspect UI, network, export, cache directory | No full secret, public cache directory, or unprotected app access |

### Release Gate

The app can be marked fully complete only when all conditions are true:

- All phases 0 through 7 pass in QA.
- All high-severity audit findings are fixed and covered by regression tests.
- The HTTPS device matrix passes on at least one Android and one iOS device.
- The Teable QA fixture's complete learning loop is traceable and consistent.
- The VPS has a persistent private audio-cache volume and a private access boundary.
- The release report records versions, test date, device/browser, and any remaining accepted limitations.

## Recommended Execution Order

1. Phase 0 QA foundation.
2. Phase 1 learning state integrity.
3. Phase 2 onboarding and readiness gates.
4. Phase 6 PWA/offline correction, because it protects personal data.
5. Phase 3 tutor context and topic change.
6. Phase 4 learning-loop aggregation and truthful empty states.
7. Phase 5 voice and STT resilience.
8. Phase 7 test automation.
9. Phase 8 VPS and device acceptance.

This order fixes data corruption and privacy risks before expanding the test surface or declaring the product ready.
