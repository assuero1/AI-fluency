# Phase 14 Report: Profile, Preferences, and Privacy

Phase 14 made the Profile screen functional and added personal-data controls.

## Completed

- [x] Added `GET /api/profile` for the personal user, active language profile, available language profiles, and connection status.
- [x] Added `PATCH /api/profile` for name, timezone, and active language updates.
- [x] Added `PATCH /api/preferences` for correction style, audio, transcript, calendar memory, and learning goals.
- [x] Rebuilt `/perfil` with editable profile data, active-language selector, correction choices, preference toggles, real connection states, export, and cleanup controls.
- [x] Added `GET /api/export`, which returns a JSON attachment containing the user’s learning history and never includes API keys.
- [x] Added a two-step cleanup path: `POST /api/data/delete-confirmation` creates a 10-minute scoped challenge, and `DELETE /api/data` requires both its token and the phrase `LIMPAR HISTORICO`.
- [x] Learning-history cleanup removes conversations, messages, corrections, words, occurrences, feedbacks, topics, practice sessions, and related events while preserving user profile and preferences.
- [x] Added Teable record deletion support for the protected cleanup workflow.
- [x] Connected audio and transcript preferences to the Chat interface.
- [x] Connected calendar-memory preference to topic recommendation context.
- [x] Added validation errors with HTTP `400` for invalid profile/preference/delete requests.

## Preference Effects

```text
correction style -> tutor prompt on every new assistant turn
audio enabled -> assistant/reason playback controls in Chat
transcript enabled -> text visibility in Chat bubbles
calendar memory -> use or ignore feedback memory in topic suggestions
active language -> profile used by future conversations and tutor prompts
```

## Validation

- `GET /api/profile` returned the active English B1 profile and connection status.
- `PATCH /api/preferences` persisted the current correction style to Teable.
- `GET /api/export` returned `200` with a JSON export response.
- `POST /api/data/delete-confirmation` returned `201` without deleting data.
- `DELETE /api/data` without confirmation returned `400` and did not delete data.
- `/perfil` was checked in a 430 px viewport with loaded CSS and the standard bottom navigation.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.

## Deliberately Not Executed

The confirmed `DELETE /api/data` path was not run against the real Teable base because it is intentionally destructive. Its challenge, phrase validation, deletion ordering, and rejection behavior were implemented and the safe rejection path was validated.

## Next Step

Proceed to the final quality, PWA, security, and deployment-readiness phase.
