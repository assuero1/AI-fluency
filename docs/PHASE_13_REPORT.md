# Phase 13 Report: Real Learning Progress

Phase 13 replaced the illustrative Progress screen with a Teable-backed learning panorama.

## Completed

- [x] Added `GET /api/progress` with real profile, fluency, correction, vocabulary, streak, activity, strength, error, and weekly-focus aggregates.
- [x] Added `POST /api/progress/focus-practice` to turn the weekly focus into a tracked practice conversation.
- [x] Added a progress aggregator scoped to the active user and language profile.
- [x] Calculated monthly fluency using saved daily feedbacks and compares against the prior month when evidence exists.
- [x] Calculated corrections, new words, completed conversations, recurring correction types, and the seven-day activity sequence from Teable records.
- [x] Rebuilt `/progresso` with real level data, metrics, strengths, recurring-error examples, weekly focus, and streak.
- [x] Kept Progresso out of the fixed bottom navigation while preserving the standard navigation itself.
- [x] Created focus practice topics with source `recurring_error`, carrying the correction evidence into the tutor context.

## Learning Flow

```text
conversations + corrections + words + daily feedback
  -> Progress aggregate for the active language
  -> recurring error becomes weekly focus
  -> user chooses “Treinar foco da semana”
  -> Topic source=recurring_error + Conversation mode=review_words
  -> tutor practices the error with real recent evidence
```

## Validation

- `GET /api/progress` returned B1, fluency `8/10`, one recurring tense error, five new words, and a one-day streak from real records.
- `POST /api/progress/focus-practice` returned `201` and created a conversation for `Tempos verbais em contexto`.
- `/progresso` returned `200`.
- The page was checked in a 430 px viewport with the standard bottom navigation and loaded CSS.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.

## Next Step

Proceed to Phase 14: Profile, preferences, and privacy controls.
