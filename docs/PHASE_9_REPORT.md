# Phase 9 Report

Phase 9 added Kokoro voice generation to the learning flow.

## Completed

- [x] Added server-side Kokoro speech synthesis.
- [x] Added `POST /api/voice/synthesize`.
- [x] Added reusable `VoiceButton`.
- [x] Added audio playback for assistant chat messages.
- [x] Added audio playback for correction explanations.
- [x] Rebuilt the Words screen with real Teable vocabulary.
- [x] Added word pronunciation buttons.
- [x] Kept text-first fallback: chat never waits for audio before rendering.
- [x] Kept Kokoro API key server-side only.

## Implemented Route

```text
POST /api/voice/synthesize
```

## Implemented Files

- `lib/kokoro/client.ts`
- `app/api/voice/synthesize/route.ts`
- `components/VoiceButton.tsx`
- `components/ChatConversation.tsx`
- `app/palavras/page.tsx`
- `app/globals.css`

## Voice Behavior

- Chat messages render immediately as text.
- The user taps the audio pill to generate/play audio.
- Correction explanations can be played.
- Vocabulary words can be pronounced from the Words screen.
- If Kokoro fails, the button shows failure but the text experience remains usable.

## Validation

Commands run:

```bash
npm run lint
npm run typecheck
npm run build
```

Results:

- Lint passed.
- Typecheck passed.
- Production build passed.

Local route checks:

```text
POST /api/voice/synthesize -> 200
GET  /chat?conversationId=... -> 200
GET  /palavras -> 200
GET  /api/settings/connections -> 200
```

Real Kokoro validation:

```text
content type: audio/mpeg
voice: af_bella
format: mp3
audio data returned: true
```

No secret values were printed or committed.

## Next Step

Proceed to Phase 10: final PWA polish, installability, offline shell, security pass, cleanup, and deployment readiness.
