# QA Environment

The QA environment exists to validate AI Fluency without writing to the personal learning history.

## Safety Boundary

- The isolated Teable base is named `AI Fluency QA`.
- `.env.qa.local` is ignored by Git and must contain `APP_ENV=qa` and `QA_RUN_NAMESPACE=AI_FLUENCY_QA`.
- QA scripts refuse to run when either QA marker is missing.
- Fixtures store their created record IDs under `.qa-fixtures/`, which is also ignored by Git.
- Every QA server receives `AI_FLUENCY_USER_ID` from its fixture manifest, so concurrent fixtures cannot select each other.
- Never point `.env.qa.local` at the personal base.

## Setup

The secure local QA file is generated from the existing local environment and receives a new Teable base ID:

```bash
node scripts/create-qa-env.mjs --base-id <qa-base-id>
node scripts/setup-teable-schema.mjs --env .env.qa.local --apply
node scripts/validate-qa-environment.mjs --env .env.qa.local
```

The schema command is idempotent. It creates or verifies the 13 application tables and writes their IDs only to `.env.qa.local`.

## Fixture Cycle

```bash
node scripts/qa-fixture.mjs --env .env.qa.local
node scripts/qa-cleanup.mjs --env .env.qa.local --run <run-id>
node scripts/qa-verify-empty.mjs --env .env.qa.local
```

The fixture saves its manifest after each created record, so a partial run can be cleaned safely. The cleanup command requires the exact run ID and deletes only IDs recorded in that run's manifest. It cannot operate when the environment is not explicitly marked as QA. The empty-base verifier ignores Teable's blank grid rows and fails only when a record contains persisted field data.

Recovery also reads the fixture's user ID from the manifest. Renaming the QA user during a test therefore does not prevent cleanup of records created later by the application.

When an older fixture failed before it could create a manifest, use the deliberately constrained recovery command:

```bash
node scripts/qa-recover-fixture.mjs --env .env.qa.local --run <qa-run-id>
```

It accepts only IDs beginning with `qa-` and removes records related to the matching QA user in the QA base.

## Running the App in QA

Load the QA environment into the shell before starting the application:

```bash
node scripts/qa-fixture.mjs --env .env.qa.local
jq -r '.records.TEABLE_USERS_TABLE_ID[0]' .qa-fixtures/<run-id>.json
set -a
source .env.qa.local
set +a
export AI_FLUENCY_USER_ID=<fixture-user-id>
npm run dev -- -p 3012
```

Keep the fixture user ID tied to that server process. Do not write a temporary fixture ID back into `.env.qa.local`.

Responses include `X-AI-Fluency-Environment: qa` while `APP_ENV=qa` is active. This header is the non-production marker and must never appear in a production deployment.

## Required Checks Before QA Tests

1. `node scripts/validate-qa-environment.mjs --env .env.qa.local`
2. `node scripts/qa-verify-empty.mjs --env .env.qa.local` when starting a clean test run.
3. `npm run test:unit`
4. Run the intended QA integration suite.
5. Run fixture cleanup and verify the base is empty again.
