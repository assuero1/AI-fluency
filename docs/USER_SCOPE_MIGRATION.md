# User Identity And Learning Scope

AI Fluency is now multiuser: the identity of every request comes from the Supabase Auth session, and Postgres RLS isolates each user's data. The Supabase database can contain many user records; the server never guesses which record owns the current session.

## Runtime identity

The signed-in auth user is resolved by `getSessionUser()` (`lib/learning/profile.ts`): the session's `auth_user_id` maps to exactly one row in the `users` table. There is no `AI_FLUENCY_USER_ID` environment variable anymore — it was removed together with the Teable backend.

- No session → `UnauthenticatedError` (redirect to `/login`).
- Session without a linked `users` row → `UserLinkError` (run `scripts/link-existing-user.mjs` once for legacy personal data).

## Legacy scope audit

Learning records must contain both `user_id` and `language_profile_id`. The old Teable-only audit/backfill scripts were removed with the Teable backend; scope integrity is now enforced by the Supabase schema (NOT NULL + RLS) and can be inspected with:

```bash
npm run scope:inspect -- --env .env.local
```
