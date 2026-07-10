# Phase 16 Report: Persistent Audio Cache

Phase 16 replaced per-click base64 audio responses with a persistent server-side Kokoro cache.

## Completed

- [x] Added `GET /api/voice/:audioId` to stream cached audio through an internal URL.
- [x] Changed `POST /api/voice/synthesize` to return `audioId`, `audioUrl`, cache status, content type, voice, and format.
- [x] Added deterministic audio IDs based on normalized text, voice, and output format.
- [x] Added single-flight protection so simultaneous requests for the same phrase do not synthesize duplicate files.
- [x] Added persistent disk storage, metadata sidecars, atomic writes, expiration, and least-recently-used size pruning.
- [x] Added `AUDIO_CACHE_DIR`, `AUDIO_CACHE_MAX_MB`, and `AUDIO_CACHE_MAX_AGE_DAYS` configuration.
- [x] Added `.audio-cache/` to `.gitignore` and production volume guidance to deployment documentation.
- [x] Updated `VoiceButton` to play the protected internal audio URL instead of embedding an entire base64 payload in the browser response.
- [x] Set private browser caching for cached-audio `GET` requests while retaining `no-store` for all other API responses.

## Cache Flow

```text
VoiceButton
  -> POST /api/voice/synthesize
  -> cache hit: returns existing /api/voice/:audioId
  -> cache miss: Kokoro generates once, file + metadata saved atomically
  -> GET /api/voice/:audioId streams audio/mpeg
  -> browser plays the internal URL
```

## Validation

- First synthesis of a short phrase returned `200` with `cached: false`.
- The same second synthesis returned `200` with `cached: true` and the same audio ID.
- `GET /api/voice/:audioId` returned `audio/mpeg`, `12044` bytes, and `Cache-Control: private, max-age=604800`.
- The word-detail pronunciation control rendered and did not enter its failure state after playback was requested.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.

## Production Requirement

Set `AUDIO_CACHE_DIR` to a persistent VPS volume before deployment. The cache directory must remain private and must not be served directly by the reverse proxy.
