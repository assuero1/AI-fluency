# Personal User And Learning Scope

AI Fluency is a personal application, but the Teable base can still contain more than one user record after QA, imports, or older deployments. The server must never guess which record owns the current session.

## Runtime identity

Set the exact personal user record in the server environment:

```bash
AI_FLUENCY_USER_ID=rec...
```

When this value is absent, the app starts only when the Users table has zero or one non-empty record. More than one record produces an explicit configuration error.

## Legacy scope audit

Learning records must contain both `user_id` and `language_profile_id`. Audit old records without changing them:

```bash
node scripts/backfill-learning-scope.mjs \
  --env .env.local \
  --user-id rec-user \
  --profile-id rec-profile
```

Review the candidate and conflict counts. Only after confirming the exact user and language profile, apply the backfill:

```bash
node scripts/backfill-learning-scope.mjs \
  --env .env.local \
  --user-id rec-user \
  --profile-id rec-profile \
  --apply
```

The script fills missing scope fields only. It never overwrites a conflicting user or language profile; conflicts remain listed for manual review.
