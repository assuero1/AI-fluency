# Phase 15 Report: Quality, Security, PWA, and Deployment Readiness

Phase 15 prepared the application for private production deployment.

## Completed

- [x] Added a PWA registration component and `/sw.js` service worker.
- [x] Added an offline page plus app-level loading and error states.
- [x] Updated the manifest with standalone scope, app ID, portrait orientation, and a maskable icon.
- [x] Added security headers: CSP, `X-Frame-Options`, `X-Content-Type-Options`, referrer policy, permissions policy, and removed the framework-powered header.
- [x] Added `no-store` cache control for every internal `/api/*` route.
- [x] Added explicit no-cache behavior for the service-worker file.
- [x] Marked environment access as server-only to prevent accidental client imports of secret-bearing config.
- [x] Audited client/server boundaries: no `NEXT_PUBLIC_` secret configuration and no direct AI, Teable, or Kokoro credential use from client components.
- [x] Added production deployment, private-access, HTTPS, PWA, and smoke-test documentation.
- [x] Updated the README with all completed phases and deployment guidance.

## Runtime Checks

- `/manifest.webmanifest` returned `200` and valid standalone PWA metadata.
- `/sw.js` returned `200` with `Cache-Control: no-cache, no-store, must-revalidate`.
- `/api/profile` returned `Cache-Control: no-store, max-age=0`.
- Security headers were present on manifest, service-worker, and API responses.
- The app loaded in mobile layout with its manifest and standard bottom navigation.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed without warnings.

## Manual Production Checks

The in-app browser available during validation does not expose the Service Worker API, so these need a real mobile browser over HTTPS:

1. Install the PWA from the browser menu.
2. Confirm standalone launch and the maskable app icon.
3. Visit Home, go offline, and navigate to confirm the offline fallback.
4. Repeat the full learning smoke test after deployment: conversation, correction, words, calendar, progress, TTS, STT, export, and protected cleanup dialog.

## Security Boundary

This MVP is personal and single-user. It has no login layer. Deploy it only behind a private-access boundary such as Tailscale, VPN, or reverse-proxy authentication; do not expose the app publicly without adding authentication.

See [Deployment Readiness](DEPLOYMENT.md) for commands and the production checklist.
