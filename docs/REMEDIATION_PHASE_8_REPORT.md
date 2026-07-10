# Remediation Phase 8 Report

## Current Outcome

Phase 8 is implemented as an enforceable release procedure, but final acceptance remains pending. The repository can now validate the production host, HTTPS origin, PWA install assets, provider readiness, Android/iOS evidence, privacy boundary, persistent audio cache, and cross-screen learning-loop consistency. The app cannot be declared complete until the real VPS URL and both physical devices pass.

## Delivered

- Closed Phase 7 with `npm run test:release` exiting `0` and the QA base empty.
- Added 192 px, 512 px maskable, and 180 px Apple PNG icons.
- Added explicit iOS `apple-touch-icon` metadata and updated the offline shell cache.
- Added `test:phase8:host` to require production mode, non-local HTTPS, an existing writable private cache directory, persistent-volume attestation, and no public secret variables.
- Added `test:phase8:origin` to validate HTTPS, security headers, production identity, PWA manifest/icons, service worker policy, API no-store, full Teable mappings, AI, and Kokoro readiness.
- Added a strict Android/iOS acceptance evidence schema and `test:phase8:evidence` validator.
- Added `test:phase8` as the final composite release gate.

## Device Procedure

Use one Android device with Chrome and one iPhone with Safari. On each device:

1. Open the final HTTPS URL through the private access boundary.
2. Install the PWA and launch it from the home-screen icon in standalone mode.
3. Visit Home and Chat online, disable networking, and navigate again. Confirm the offline screen appears and no stale learner data is shown.
4. Restore networking. Test native speech recognition in English, Spanish, French, and Italian.
5. Deny microphone permission once. Confirm the error is non-blocking and typing still works.
6. Play a tutor message, correction explanation, and word pronunciation. Confirm visible text remains usable if audio is interrupted.

## Full Learning Loop

On one accepted device, complete onboarding, start a topic, exchange messages, receive at least one correction when appropriate, finish the conversation, and open the summary. Record the conversation ID and feedback date. Verify that Teable, Home, Calendar, Words, and Progress agree on the completed conversation and persisted learning data.

## Privacy And Infrastructure

- From outside the VPN/private proxy, confirm access is denied.
- Inspect browser UI, network responses, exports, Cache Storage, and service-worker caches for full secrets or learner API payloads.
- On the VPS, confirm the audio cache survives an app restart, is not under `public` or `.next`, and is not directly reachable through the reverse proxy.
- Do not attach API keys, access-header values, or exported learner content to the acceptance file.

## Remaining Gate

Create `docs/phase-8-acceptance.json` from the template and fill it only with observed evidence. Phase 8 reaches 100% only when all three commands below pass against the deployed release and `npm run test:phase8` exits `0`:

```bash
npm run test:phase8:host
npm run test:phase8:origin
npm run test:phase8:evidence
```
