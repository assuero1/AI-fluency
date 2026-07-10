# Remediation Phase 0 Report

## Outcome

Phase 0 of `ROBUST_VALIDATION_REMEDIATION_PLAN.md` is complete. QA data is isolated from the personal learning base and can be created, cleaned, and verified without exposing credentials.

## Delivered

- Created an isolated Teable base named `AI Fluency QA` and mapped all 13 application tables only in ignored `.env.qa.local`.
- Added `.env.qa.example`, secure QA environment creation, schema setup with `--env`, and preflight mapping validation.
- Added QA-only guards: `APP_ENV=qa`, `QA_RUN_NAMESPACE=AI_FLUENCY_QA`, ignored fixture manifests, and `X-AI-Fluency-Environment: qa` response header.
- Added a realistic fixture: user, language profile, topic, active and completed conversations, message, correction, vocabulary word and occurrence, daily feedback, practice session, and app event.
- Added manifest-based cleanup, empty-base verification, and constrained recovery for a partial fixture created before a manifest exists.
- Hardened personal-user lookup to ignore Teable's empty grid rows, allowing an empty QA base to enter onboarding correctly.

## Evidence

- QA preflight: 13 mapped tables validated in the isolated base.
- Fixture cycle: created `qa-1783642527157`, cleaned it by manifest, then confirmed that the QA base had no persisted fixture data.
- Local quality gates: `npm run test:unit` (5 tests), `npm run lint`, `npm run typecheck`, and a clean `npm run build` all passed.
- Production-mode QA smoke: `/` contains the Next.js redirect target `/onboarding` for an empty QA base; page and API responses include `X-AI-Fluency-Environment: qa`; API response cache policy remains `no-store`.

## Operational Rule

Run QA only with `.env.qa.local`. Do not point it at the personal Teable base. After every QA execution, run `qa:cleanup` for its run ID and `qa:verify-empty`.
