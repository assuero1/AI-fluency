# Phase 4 Report

Phase 4 implemented the real onboarding and active language profile foundation.

## Completed

- [x] Rebuilt the onboarding screen as an interactive mobile-first flow.
- [x] Added language, level, learning goal, correction style, and initial learning preference controls.
- [x] Added `GET /api/onboarding` to load the personal user, active language profile, and connection readiness.
- [x] Added `POST /api/onboarding` to create a real `LanguageProfile` in Teable.
- [x] Reused or created the personal user record automatically.
- [x] Updated `Users.active_language_id` after profile creation.
- [x] Registered an `AppEvent` when a language profile is created.
- [x] Updated Home to load the active language and level from Teable.
- [x] Added readiness routing: practice goes to `/`, missing required connections go to `/settings/connections`.

## Implemented Routes

```text
GET  /api/onboarding
POST /api/onboarding
```

## Implemented Files

- `components/OnboardingForm.tsx`
- `app/onboarding/page.tsx`
- `app/api/onboarding/route.ts`
- `lib/learning/profile.ts`
- `lib/teable/client.ts`
- `app/page.tsx`
- `app/globals.css`

## Data Written

Onboarding now writes:

- `Users`, when a personal user does not exist yet.
- `LanguageProfiles`, for the selected language profile.
- `Users.active_language_id`, pointing to the active language profile.
- `AppEvents`, with `language_profile_created`.

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
GET  /                         -> 200
GET  /api/onboarding            -> 200
POST /api/onboarding            -> 201
```

Current onboarding readiness:

```text
readyForPractice: true
redirectTo: /
active language: Inglês
level: Intermediário (B1)
```

No secret values were printed or committed.

## Next Step

Proceed to Phase 5: real Home data, topic creation, topic suggestions, and the `POST /api/conversations/start` entry point.
