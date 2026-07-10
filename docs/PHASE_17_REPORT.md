# Phase 17 Report: Final Integrated Acceptance

Phase 17 completed the final local acceptance pass for the implemented AI Fluency MVP.

## Completed

- [x] Production build passed with `npm run build`.
- [x] Static analysis passed with `npm run lint` and `npm run typecheck`.
- [x] The production server started successfully with `next start` on port `3010`.
- [x] The Home route, PWA manifest, and service worker returned `200` in production mode.
- [x] Connection checks for the configured AI, Teable, and Kokoro services returned `200` in production mode.
- [x] `/api/profile` returned the intended security headers: CSP, `X-Frame-Options: DENY`, and `Cache-Control: no-store`.
- [x] The Home route was checked at a 430 x 932 mobile viewport: stylesheet active, manifest linked, primary navigation present, and no console errors.
- [x] Persistent Kokoro audio caching remains integrated: cached speech is served through a private internal route rather than included in API JSON.

## Production Smoke Results

| Surface | Result |
| --- | --- |
| `/` | `200` |
| `/manifest.webmanifest` | `200` |
| `/sw.js` | `200` |
| `/api/settings/test-ai` | `200` |
| `/api/settings/test-teable` | `200` |
| `/api/settings/test-kokoro` | `200` |

## Handoff Checks

The app is complete for the implementation scope and ready to be deployed privately. The following checks require the real VPS URL and a mobile device, so they cannot be asserted from localhost:

1. Configure HTTPS and the private access layer described in `docs/DEPLOYMENT.md`.
2. Mount a persistent, non-public `AUDIO_CACHE_DIR` on the VPS.
3. Install the PWA from the HTTPS URL on iOS and Android.
4. Load Home once, disable the device network, and confirm the offline fallback on a new navigation.
5. Complete one real end-to-end conversation and confirm its feedback, vocabulary, calendar, and progress data in Teable.

The MVP intentionally has no sign-in layer. It must not be exposed publicly without the private network or reverse-proxy access control described in the deployment guide.
