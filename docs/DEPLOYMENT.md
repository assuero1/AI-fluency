# Deployment Readiness

AI Fluency is a personal single-user app. It has no sign-in layer in this MVP, so do not expose it as a public unauthenticated website.

## Production Prerequisites

- Use Node.js 20 or newer.
- Serve the app over HTTPS. Service workers and PWA installation require HTTPS outside localhost.
- Keep `.env.local` only on the server and outside version control.
- Restrict access with a private VPN, Tailscale, reverse-proxy authentication, or an equivalent private-access layer.
- Allow the app server to reach the Teable, AI, and Kokoro endpoints from the VPS network.

## Environment

Configure the values documented in `.env.example` on the deployment host. At minimum, provide:

- AI provider base URL, API key, and chat model.
- Teable base URL, API key/token, base ID, and all mapped table IDs.
- Kokoro base URL, API key, default voice, and output format.
- Optional Kokoro voice and format allowlists. When omitted, only the configured defaults are accepted.
- Audio-cache directory, maximum size, and retention period.
- `AUDIO_CACHE_PERSISTENT=true` only after `AUDIO_CACHE_DIR` is mounted as a persistent private volume.

Never use `NEXT_PUBLIC_` for these values.

## Build and Run

```bash
npm ci
npm run build
npm run start -- -p 3000
```

Use a process manager such as systemd, PM2, or the platform runtime to keep the process alive. Put a TLS reverse proxy in front of the app and forward only to the local application port.

## Persistent Audio Cache

Kokoro responses are cached on the app server by text, voice, and output format. Set `AUDIO_CACHE_DIR` to a persistent volume path in production, for example `/var/lib/ai-fluency/audio-cache`.

- `AUDIO_CACHE_MAX_MB` defaults to `200`.
- `AUDIO_CACHE_MAX_AGE_DAYS` defaults to `30`.
- `KOKORO_ALLOWED_VOICES` and `KOKORO_ALLOWED_FORMATS` restrict synthesis requests at the server boundary.
- The app removes expired audio and prunes least-recently-used files when the size limit is exceeded.
- Do not mount this directory as a public web folder. Audio is served only through `/api/voice/:audioId`.

## Reverse Proxy Requirements

- Terminate TLS and redirect HTTP to HTTPS.
- Preserve WebSocket upgrade headers in development only; production app traffic is standard HTTP.
- Set a request-body limit appropriate for text and future audio uploads.
- Do not add public caching to `/api/*`; the app already sends `Cache-Control: no-store` for those routes.

## PWA Behavior

- `/manifest.webmanifest` supplies standalone metadata and a maskable app icon.
- `/sw.js` caches only the static shell assets, icon, and offline page. It never caches learner pages or API data.
- New conversations, AI generation, Teable sync, TTS, exports, settings changes, and all learner pages require a live connection.
- When navigation fails offline, the PWA returns the offline page instead of presenting stale learning metrics or chat data as current.

## Production Smoke Test

1. Open the HTTPS URL on a mobile browser and install the PWA.
2. Verify `manifest.webmanifest` and `/sw.js` return `200`.
3. Test Teable, AI, and Kokoro in Connections.
4. Complete one conversation, check words, calendar, and progress.
5. Turn off network after visiting the home page and confirm the offline fallback appears on a new navigation.
6. Confirm no API key appears in browser source, network responses, exports, or UI.
7. Verify profile export downloads JSON and the cleanup dialog requires its confirmation phrase.

## Phase 8 Release Commands

Run the local/QA gate before deployment:

```bash
npm run test:release
```

On the VPS, with the production environment loaded and the persistent volume mounted, run:

```bash
npm run test:phase8:host
npm run test:phase8:origin
```

If the private reverse proxy requires a service header for the origin probe, provide `PHASE8_ACCESS_HEADER_NAME` and `PHASE8_ACCESS_HEADER_VALUE` only in the VPS process environment. The scripts report check names and never print the header value.

Copy `docs/phase-8-acceptance.template.json` to `docs/phase-8-acceptance.json`, record the Android, iOS, privacy, cache-volume, and full-learning-loop evidence, then run:

```bash
npm run test:phase8:evidence
```

The complete final gate is `npm run test:phase8`. It intentionally fails unless the production host, HTTPS origin, automated suites, and signed device evidence all pass.

## Local Acceptance Status

Phase 17 has passed the local production build, service connectivity, security-header, and mobile-viewport checks. The mobile installation and offline checks above remain required after the app is available through its final HTTPS VPS URL.
