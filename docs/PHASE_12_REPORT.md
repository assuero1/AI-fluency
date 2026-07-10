# Phase 12 Report: Calendar and Contextual Practice

Phase 12 made the calendar the navigable learning memory for the app.

## Completed

- [x] Added `GET /api/calendar?month=YYYY-MM` with real month navigation and feedback-day markers.
- [x] Added `GET /api/daily-feedback/:date` with daily feedback, recurring errors, suggested topics, and completed conversations.
- [x] Added `POST /api/daily-feedback/:date/practice` to turn a saved focus into a `calendar_focus` conversation.
- [x] Rebuilt `/calendario` with dynamic month days, previous/next month navigation, feedback count, last feedback, and AI suggestions.
- [x] Added `/calendario/:date` for full daily learning memory: scores, AI observations, errors, completed conversations, and follow-up topics.
- [x] Ensured calendar actions create a Topic with the original feedback linked, then start a conversation with the contextual instruction sent to the tutor prompt.
- [x] Normalized Teable ISO date values before using them in app routes and calendar UI.
- [x] Updated the remaining legacy Chat calendar anchor to `next/link`.

## Learning Flow

```text
completed conversation
  -> DailyFeedback saved for the day
  -> calendar month marks the feedback day
  -> daily detail exposes strength, weakness, focus, and previous conversations
  -> user chooses “Praticar este foco”
  -> Topic + Conversation mode=calendar_focus
  -> tutor resumes the exact recorded learning focus
```

## Validation

- `GET /api/calendar?month=2026-07` returned the feedback marker for 9 July.
- `GET /api/daily-feedback/2026-07-09` returned the daily feedback and the completed conversation context.
- `POST /api/daily-feedback/2026-07-09/practice` returned `201` and created a `calendar_focus` conversation.
- `/calendario` and `/calendario/2026-07-09` returned `200`.
- The daily detail was checked in a 430 px viewport with loaded CSS and the standard bottom navigation.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.

## Next Step

Proceed to Phase 13: real learning progress.
