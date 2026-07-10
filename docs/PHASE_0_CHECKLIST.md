# Phase 0 Checklist

Phase 0 prepares the project for implementation. It does not build the UI or integrate live APIs yet.

## Completed In This Phase

- [x] Confirmed product direction from `AI_FLUENCY_PRODUCT_LOGIC.md`.
- [x] Confirmed build phases from `AI_FLUENCY_BUILD_PLAN.md`.
- [x] Preserved the 8 visual references in `assets/screens`.
- [x] Defined Next.js + TypeScript PWA as implementation stack.
- [x] Added `.env.example`.
- [x] Added setup README.
- [x] Added design token contract.
- [x] Added Teable schema map.
- [x] Added security rule: no secrets in frontend.

## Still Needed Before Phase 1

- [ ] Confirm final package manager: npm, pnpm, or bun.
- [ ] Confirm whether MVP is single-user or multi-user.
- [ ] Confirm initial AI provider and chat model.
- [ ] Confirm Kokoro API contract on the VPS.
- [ ] Confirm Teable base ID and whether tables will be created manually or by script.
- [ ] Decide whether STT is included in MVP or deferred.

## Phase 1 Entry Criteria

Phase 1 can start when:

- Stack decision is accepted.
- Visual tokens are accepted.
- The app scaffold can be created.
- The bottom nav rule is accepted.
- No real credentials are committed.

## Phase 1 Goal

Implement the static mobile-first PWA foundation:

- AppShell.
- BottomNav.
- Visual tokens.
- Static routes for the 8 reference screens.
- PWA manifest.
- Mobile viewport polish.
