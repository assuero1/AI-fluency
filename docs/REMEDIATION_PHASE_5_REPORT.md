# Remediation Phase 5 Report

## Outcome

Phase 5 of `ROBUST_VALIDATION_REMEDIATION_PLAN.md` is complete. Kokoro remains optional to the learning loop, its cache stays private and bounded, native browser STT uses the active learning language, and audio/transcript preferences affect presentation without removing learning records.

## Delivered

- Added server-side allowlists for Kokoro voice and output format through `KOKORO_ALLOWED_VOICES` and `KOKORO_ALLOWED_FORMATS`; defaults are the only permitted values when the variables are omitted.
- Centralized text length, voice, and format validation before cache lookup or a Kokoro request.
- Ensured invalid synthesis inputs return `400` or `413`, not an internal server error.
- Required an active learning profile and enabled audio preference before synthesis. Teable's omitted unchecked checkbox fields are now interpreted as disabled consistently across Chat, Home, Profile, and TTS.
- Kept deterministic audio IDs, single-flight cache generation, expiry, LRU pruning, private streaming, and metadata filename validation.
- Corrected the voice API contract to include `ok: true`, matching `VoiceButton` and allowing real playback.
- Replaced the generic failed label with a recoverable voice-unavailable state that leaves the text visible.
- Centralized native STT locales for English, Spanish, French, and Italian; the browser transcript is still sent as text only.
- Removed upstream Kokoro error details from API responses.

## QA Evidence

- First Kokoro synthesis was a cache miss; the equal second request was a cache hit with the same deterministic audio ID.
- Audio `GET` returned `200`, `audio/mpeg`, a content length, and `Cache-Control: private, max-age=604800`.
- A malformed audio ID returned `404`.
- Voice and format outside the configured allowlists returned `400`.
- With audio disabled in the QA profile, synthesis returned `409`; a text message still created user and assistant records.
- With `KOKORO_BASE_URL` intentionally absent in a local QA process, synthesis returned `503`; a text message still completed successfully.
- QA recovery removed 50 related fixture records and the empty-base check passed.

## Device Gate

The native STT unsupported and permission-denied UI states are implemented and unit-tested for locale selection. Final microphone permission and recognition quality remain a manual acceptance check on an Android Chrome device and an iOS Safari device after the HTTPS VPS deployment.
