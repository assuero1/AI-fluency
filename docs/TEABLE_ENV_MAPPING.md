# Teable Environment Mapping

Phase 2 adds server-side Teable access and creates/maps the AI Fluency tables.

## Required Connection Variables

The app supports these names:

```text
TEABLE_BASE_URL=
TEABLE_API_KEY=
```

`TEABLE_TOKEN` is also supported as an alias for `TEABLE_API_KEY`.

## Optional Base Variable

```text
TEABLE_BASE_ID=
```

This is required for automated schema setup.

## Required Table ID Variables

These are added to `.env.local` by `scripts/setup-teable-schema.mjs --apply`:

```text
TEABLE_USERS_TABLE_ID=
TEABLE_LANGUAGE_PROFILES_TABLE_ID=
TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID=
TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID=
TEABLE_CONVERSATIONS_TABLE_ID=
TEABLE_MESSAGES_TABLE_ID=
TEABLE_CORRECTIONS_TABLE_ID=
TEABLE_WORDS_TABLE_ID=
TEABLE_WORD_OCCURRENCES_TABLE_ID=
TEABLE_DAILY_FEEDBACKS_TABLE_ID=
TEABLE_TOPICS_TABLE_ID=
TEABLE_PRACTICE_SESSIONS_TABLE_ID=
TEABLE_FLASHCARDS_TABLE_ID=
TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID=
TEABLE_APP_EVENTS_TABLE_ID=
```

## Implemented Internal Routes

```text
GET  /api/health/teable
GET  /api/teable/schema
GET  /api/profile
POST /api/profile
GET  /api/language-profiles
POST /api/language-profiles
GET  /api/topics
POST /api/topics
POST /api/events
```

## Security Contract

- The browser never calls Teable directly.
- The Teable token is read server-side only.
- API responses can include connection status and schema metadata, but never secret values.
- If table IDs are missing, routes return a clear configuration error instead of silently using mock data.

## Current Local Env Observation

At the time Phase 2 was started, `.env.local` had:

- `TEABLE_BASE_URL`: present
- `TEABLE_TOKEN`: present
- AI Fluency-specific Teable table IDs: not yet present

After schema setup:

- `TEABLE_BASE_ID`: configured from the provided Teable URL.
- AI Fluency-specific Teable table IDs: configured `13/13`.
- Real create/list routes validated.

No secret values were copied into documentation.
