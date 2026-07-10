# Phase 7 Report

Phase 7 added structured learning analysis to the chat loop.

## Completed

- [x] Added structured AI analysis for each user message.
- [x] Saved inline corrections in Teable.
- [x] Saved vocabulary words in Teable.
- [x] Created word occurrence records linked to the conversation and message.
- [x] Updated existing words with `total_uses`, `last_used_at`, and `review_due_at`.
- [x] Rendered correction blocks in the chat UI.
- [x] Rendered saved-word count feedback in the chat UI.
- [x] Loaded existing corrections when reopening a conversation.
- [x] Added fallback extraction for words and common past-tense mistakes when the AI response is not valid structured JSON.
- [x] Added retry behavior for empty AI provider responses.

## Data Written

The chat now writes:

- `Corrections`
- `Words`
- `WordOccurrences`
- `Messages`
- `AppEvents`

## Learning Behavior

For each user message, the app now asks the AI for:

```json
{
  "assistant_reply": "text",
  "corrections": [],
  "words": []
}
```

The app normalizes:

- correction `error_type`
- correction `severity`
- word lemma
- duplicate words within a single analysis

If the AI does not return valid structured data, the app still extracts useful vocabulary and detects simple recurring mistakes such as past-tense issues.

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
POST /api/conversations/start                    -> 201
GET  /api/conversations/:conversationId          -> 200
POST /api/conversations/:conversationId/messages -> 201
GET  /chat?conversationId=...                    -> 200
GET  /api/home                                   -> 200
```

Real learning-analysis validation:

```text
corrections saved: 1
words saved: 5
conversation reload included corrections: true
home vocabulary metrics updated: true
```

No secret values were printed or committed.

## Next Step

Proceed to Phase 8: ending a conversation, generating the post-conversation summary, saving daily feedback, and showing learning memory in the calendar.
