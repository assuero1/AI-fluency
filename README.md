# AI Fluency

AI Fluency is a mobile-first PWA for learning languages through AI conversation. The product uses conversation as the learning engine: the user chooses a language and topic, chats with an AI tutor, receives corrections, saves used words, and gets daily feedback stored in a calendar.

## Current Status

The project has completed:

- **Phase 0: preparation and contracts**
- **Phase 1: static mobile-first PWA foundation**
- **Phase 2: Teable persistence foundation**
- **Phase 3: connection status and test routes**
- **Phase 4: onboarding and active language profile**
- **Phase 5: real Home, topic suggestions, and conversation start**
- **Phase 6: real text chat with AI**
- **Phase 7: structured corrections and vocabulary capture**
- **Phase 8: post-conversation summary and daily feedback**
- **Phase 9: Kokoro voice and pronunciation**
- **Phase 10: native speech-to-text in conversation**
- **Phase 11: real vocabulary review**
- **Phase 12: calendar detail and contextual practice**
- **Phase 13: real learning progress**
- **Phase 14: profile, preferences, and privacy**
- **Phase 15: PWA, security, and deployment readiness**
- **Phase 16: persistent Kokoro audio cache**
- **Phase 17: final integrated acceptance**

Existing planning documents:

- [Product logic](AI_FLUENCY_PRODUCT_LOGIC.md)
- [Build plan](AI_FLUENCY_BUILD_PLAN.md)
- [Robust validation and remediation plan](docs/ROBUST_VALIDATION_REMEDIATION_PLAN.md)
- [QA environment](docs/QA_ENVIRONMENT.md)
- [Remediation Phase 0 report](docs/REMEDIATION_PHASE_0_REPORT.md)
- [Design references](assets/screens)

Phase 0 adds the technical contracts needed before implementation:

- Environment template: [.env.example](.env.example)
- Stack decision: [docs/STACK_DECISIONS.md](docs/STACK_DECISIONS.md)
- Visual tokens: [docs/DESIGN_TOKENS.md](docs/DESIGN_TOKENS.md)
- Teable schema map: [docs/TEABLE_SCHEMA.md](docs/TEABLE_SCHEMA.md)
- Phase 0 checklist: [docs/PHASE_0_CHECKLIST.md](docs/PHASE_0_CHECKLIST.md)
- Phase 1 report: [docs/PHASE_1_REPORT.md](docs/PHASE_1_REPORT.md)
- Teable env mapping: [docs/TEABLE_ENV_MAPPING.md](docs/TEABLE_ENV_MAPPING.md)
- Phase 2 report: [docs/PHASE_2_REPORT.md](docs/PHASE_2_REPORT.md)
- Phase 3 report: [docs/PHASE_3_REPORT.md](docs/PHASE_3_REPORT.md)
- Phase 4 report: [docs/PHASE_4_REPORT.md](docs/PHASE_4_REPORT.md)
- Phase 5 report: [docs/PHASE_5_REPORT.md](docs/PHASE_5_REPORT.md)
- Phase 6 report: [docs/PHASE_6_REPORT.md](docs/PHASE_6_REPORT.md)
- Phase 7 report: [docs/PHASE_7_REPORT.md](docs/PHASE_7_REPORT.md)
- Phase 8 report: [docs/PHASE_8_REPORT.md](docs/PHASE_8_REPORT.md)
- Robust remediation Phase 8 report: [docs/REMEDIATION_PHASE_8_REPORT.md](docs/REMEDIATION_PHASE_8_REPORT.md)
- Phase 9 report: [docs/PHASE_9_REPORT.md](docs/PHASE_9_REPORT.md)
- Phase 10 report: [docs/PHASE_10_REPORT.md](docs/PHASE_10_REPORT.md)
- Phase 11 report: [docs/PHASE_11_REPORT.md](docs/PHASE_11_REPORT.md)
- Phase 12 report: [docs/PHASE_12_REPORT.md](docs/PHASE_12_REPORT.md)
- Phase 13 report: [docs/PHASE_13_REPORT.md](docs/PHASE_13_REPORT.md)
- Phase 14 report: [docs/PHASE_14_REPORT.md](docs/PHASE_14_REPORT.md)
- Phase 15 report: [docs/PHASE_15_REPORT.md](docs/PHASE_15_REPORT.md)
- Phase 16 report: [docs/PHASE_16_REPORT.md](docs/PHASE_16_REPORT.md)
- Phase 17 report: [docs/PHASE_17_REPORT.md](docs/PHASE_17_REPORT.md)
- Remediation Phase 1 report: [docs/REMEDIATION_PHASE_1_REPORT.md](docs/REMEDIATION_PHASE_1_REPORT.md)
- Remediation Phase 3 report: [docs/REMEDIATION_PHASE_3_REPORT.md](docs/REMEDIATION_PHASE_3_REPORT.md)
- Remediation Phase 4 report: [docs/REMEDIATION_PHASE_4_REPORT.md](docs/REMEDIATION_PHASE_4_REPORT.md)
- Remediation Phase 5 report: [docs/REMEDIATION_PHASE_5_REPORT.md](docs/REMEDIATION_PHASE_5_REPORT.md)
- Remediation Phase 6 report: [docs/REMEDIATION_PHASE_6_REPORT.md](docs/REMEDIATION_PHASE_6_REPORT.md)
- Remediation Phase 7 report: [docs/REMEDIATION_PHASE_7_REPORT.md](docs/REMEDIATION_PHASE_7_REPORT.md)
- Deployment readiness: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Product Constraints

- The app must be a web app, mobile-first, installable as a PWA.
- The visual implementation must follow the 8 screen references in `assets/screens`.
- The bottom navigation must always be: `Inicio`, `Chat`, `Palavras`, `Calendario`, `Perfil`.
- Teable is the persistent database and runs on the user's VPS.
- Kokoro is the voice/TTS system and runs on the user's VPS.
- AI provider, API key, and model are configurable. Current local setup uses DeepSeek with `deepseek-v4-flash`.
- Secrets must never be exposed to the frontend bundle.

## Planned Stack

- Frontend: Next.js App Router, React, TypeScript.
- Styling: CSS modules or global CSS with design tokens.
- Backend: Next.js route handlers for internal API routes.
- Data: Teable API through server-side service layer.
- Voice: Kokoro through server-side service layer.
- AI: OpenAI-compatible server-side service layer, currently configured for DeepSeek.
- PWA: manifest, maskable icon, service worker, and offline fallback.

## Setup Notes

To run the current static PWA foundation:

1. Keep real credentials in `.env.local`.
2. Set `AI_FLUENCY_USER_ID` to the exact personal record when the Users table already contains a profile.
3. Do not commit `.env.local`.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open `http://localhost:3000`.

If more than one non-empty user exists and `AI_FLUENCY_USER_ID` is absent, the server refuses to guess. See [Personal user and learning scope](docs/USER_SCOPE_MIGRATION.md).

For production deployment and the privacy boundary of this personal MVP, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Design References

The screens in `assets/screens` are the visual contract for implementation. The generated images are references, not code. The only intentional correction is the bottom nav standardization described above.
