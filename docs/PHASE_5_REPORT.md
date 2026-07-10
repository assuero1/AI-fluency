# Phase 5 Report

Phase 5 turned Home into the real practice decision center.

## Completed

- [x] Added real Home data loading from Teable.
- [x] Added `GET /api/home`.
- [x] Added interactive Home actions for topic input, AI suggestions, suggested-topic start, and free conversation start.
- [x] Added `POST /api/topics/suggest` using the configured AI provider.
- [x] Added `POST /api/conversations/start`.
- [x] Updated topic creation to save records with active user/profile context.
- [x] Created conversations, practice sessions, and app events when starting practice.
- [x] Added readable `Name` fields for new Teable records.
- [x] Normalized AI topic difficulty into CEFR values accepted by Teable.

## Implemented Routes

```text
GET  /api/home
POST /api/topics
POST /api/topics/suggest
POST /api/conversations/start
```

## Implemented Files

- `components/HomeDashboard.tsx`
- `app/api/home/route.ts`
- `app/api/topics/suggest/route.ts`
- `app/api/conversations/start/route.ts`
- `lib/learning/home.ts`
- `lib/learning/topics.ts`
- `lib/learning/conversations.ts`
- `lib/ai/client.ts`
- `app/page.tsx`
- `app/globals.css`

## Data Written

Home actions now write:

- `Topics`, for custom and AI-suggested topics.
- `Conversations`, when a practice session starts.
- `PracticeSessions`, linked to the conversation.
- `AppEvents`, for topic creation and conversation start.

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
GET  /api/home                    -> 200
POST /api/topics/suggest          -> 201
POST /api/conversations/start     -> 201
GET  /                            -> 200
```

AI suggestion validation:

```text
provider/model: deepseek / deepseek-v4-flash
result: topic saved in Teable
```

Conversation start validation:

```text
custom topic conversation -> created
free conversation         -> created
redirect format           -> /chat?conversationId=...
```

No secret values were printed or committed.

## Next Step

Proceed to Phase 6: load the active conversation in Chat, generate the first AI tutor message, save messages, and send user replies through the conversation loop.
