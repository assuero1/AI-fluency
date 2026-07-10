# Phase 11 Report: Words and Review

Phase 11 turned the vocabulary view into a real review workflow backed by Teable.

## Completed

- [x] Added `GET /api/words` with `all`, `recent`, `review`, and `corrected` filters plus text search.
- [x] Added `GET /api/words/:wordId` with real usage contexts, conversation topic, and associated corrections.
- [x] Added `POST /api/words/:wordId/practice` to begin a guided review for one word.
- [x] Added `POST /api/practice/weak-words` to select due/corrected words and begin a focused review conversation.
- [x] Added vocabulary domain logic joining `Words`, `WordOccurrences`, `Corrections`, `Conversations`, and `Topics`.
- [x] Rebuilt `/palavras` with real metrics, query search, persistent filters, word status, pronunciation, and a weak-words CTA.
- [x] Added `/palavras/:wordId` with actual sentence contexts, corrections, topic provenance, pronunciation, and single-word practice.
- [x] Excluded incomplete legacy records from the learner-facing vocabulary list.
- [x] Passed the review goal to the tutor prompt, so AI conversations opened from this surface practice the selected vocabulary in context.
- [x] Fixed the existing Home internal navigation links to use `next/link`.

## Learning Flow

```text
conversation message
  -> saved Word + WordOccurrence + Correction
  -> Words filters and word detail
  -> user starts word or weak-words practice
  -> Topic (with learning instruction) + Conversation mode=review_words
  -> tutor prompts the user to use the selected words naturally
```

## Validation

- `GET /api/words` returned real Teable vocabulary data.
- `GET /api/words?filter=review` returned review candidates.
- `GET /api/words/:wordId` returned a sentence context and correction.
- `POST /api/words/:wordId/practice` returned `201` and created a `review_words` conversation.
- `/palavras` and `/palavras/:wordId` were visually checked in a 430 px mobile viewport.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed after all Phase 11 changes.

## Next Step

Proceed to Phase 12: Calendar detail and contextual practice.
