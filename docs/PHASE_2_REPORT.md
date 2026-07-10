# Phase 2 Report

Phase 2 implemented the base Teable persistence layer.

## Completed

- [x] Added Teable schema manifest in code.
- [x] Added table ID env mapping.
- [x] Added server-side Teable config helper.
- [x] Added server-side Teable client.
- [x] Added `TEABLE_TOKEN` alias support.
- [x] Added healthcheck fallback for Teable versions with different user/session endpoints.
- [x] Added API response helpers.
- [x] Added Teable health route.
- [x] Added schema inspection route.
- [x] Added initial CRUD routes for profile, language profiles, topics, and app events.
- [x] Added Teable schema setup script.
- [x] Extracted and configured `TEABLE_BASE_ID`.
- [x] Created the 13 AI Fluency tables in Teable.
- [x] Updated `.env.local` with all 13 table IDs.
- [x] Validated real create/list operations.
- [x] Updated `.env.example` with Teable table ID variables.
- [x] Documented Teable environment mapping.

## Implemented Files

- `lib/env.ts`
- `lib/teable/schema.ts`
- `lib/teable/config.ts`
- `lib/teable/client.ts`
- `lib/api/responses.ts`
- `app/api/health/teable/route.ts`
- `app/api/teable/schema/route.ts`
- `app/api/profile/route.ts`
- `app/api/language-profiles/route.ts`
- `app/api/topics/route.ts`
- `app/api/events/route.ts`
- `scripts/setup-teable-schema.mjs`
- `docs/TEABLE_ENV_MAPPING.md`

## Internal Routes

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

## Schema Setup

The Teable schema can be created idempotently with:

```bash
node scripts/setup-teable-schema.mjs --apply
```

Dry-run:

```bash
node scripts/setup-teable-schema.mjs
```

The script:

- lists existing tables,
- creates missing AI Fluency tables,
- creates missing fields,
- updates `.env.local` with table IDs,
- avoids printing secrets.

## Current Status

Current `.env.local` includes a Teable base URL, `TEABLE_TOKEN`, `TEABLE_BASE_ID`, and all AI Fluency table IDs.

Current status:

```text
Teable reachable: yes
Health table configured: yes
AI Fluency mapped tables: 13/13
```

Validated behavior:

- `/api/health/teable` returns `200`.
- `/api/teable/schema` returns `200`.
- `/api/profile` returns `200`.
- `POST /api/profile` returns `201`.
- `POST /api/language-profiles` returns `201`.
- `POST /api/topics` returns `201`.
- `POST /api/events` returns `201`.

## Next Step

Proceed to dynamic onboarding/profile/topic wiring using the real Teable tables.

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
- `/api/settings/connections` reports Teable mapped tables `13/13`.
- `/api/profile` returned `200`.
- `POST /api/profile` returned `201`.
- `POST /api/language-profiles` returned `201`.
- `POST /api/topics` returned `201`.
- `POST /api/events` returned `201`.

## Security Notes

- No secret values were printed or committed.
- `TEABLE_TOKEN` is supported as an alias for `TEABLE_API_KEY`.
- Teable calls are server-side only.
- Missing table IDs produce explicit configuration errors.
