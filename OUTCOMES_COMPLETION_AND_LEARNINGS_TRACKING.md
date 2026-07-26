# Outcomes completion and learnings

This document records completed implementation work, directly observed
verification, and lessons that should carry into later phases.

## 26 July 2026 — Phase 1: Authentication and console shell

Status: **implementation complete; core real-account flow verified**.

### Implemented

- Added the current `@supabase/ssr` and `@supabase/supabase-js` packages.
- Added request-scoped browser and server Supabase clients.
- Added Next.js 16 `proxy.ts` session refresh for authentication and console
routes.
- Added server-verified authorization with `supabase.auth.getClaims()`.
- Added email-and-password account creation and sign-in.
- Added the PKCE callback route with safe relative redirects.
- Added authenticated sign-out.
- Added the `/sign-in` route.
- Added the protected `/dashboard` Outcomes Console.
- Added the Sign in link to the existing landing-page header.
- Kept the landing page otherwise visually and structurally unchanged.
- Added `.env.example` with placeholder values only.
- Updated the durable implementation plan with the Phase 1 architecture.



### Design delivered

- The public landing page retains its light editorial design.
- Sign-in and console surfaces use a darker control-plane treatment.
- The console reuses the existing typography, cobalt accent, square geometry,
fine rules, and ledger language.
- The authenticated shell currently exposes only working navigation rather than
placeholder destinations.



### Automated and browser verification

- ESLint passes.
- The production build passes.
- `/` remains statically rendered.
- The landing page was visually checked at desktop and mobile sizes.
- An unauthenticated `/dashboard` request redirects to `/sign-in`.
- Invalid credentials produce a clear accessible error.
- The configured Supabase project responds successfully to authentication
requests.



### Real-account verification

- Created a real customer account.
- Confirmed that signup triggered a Supabase confirmation email.
- Successfully submitted the email-and-password sign-in form.
- Observed `POST /sign-in` return `303` and redirect to `/dashboard`.
- Confirmed that the authenticated dashboard rendered with an active Supabase
session and private-session state.
- Confirmed that no JavaScript or authentication errors occurred during the
successful sign-in.



### Evidence limits and remaining checks

- Signup and email receipt occurred in a different browser from the controlled
sign-in test, so the signup request and confirmation callback were not captured
as one continuous trace.
- The confirmation-link callback and redirect allow-list behavior were not
directly observed in the controlled browser.
- Authenticated sign-out still needs a real-session smoke test.
- After sign-out, `/dashboard` should be reopened to confirm that it redirects to
`/sign-in`.

These remaining checks do not invalidate the verified signup, sign-in, session,
redirect, and protected-dashboard flow.

### Development warnings observed

1. Next.js detected global `scroll-behavior: smooth` without
  `data-scroll-behavior="smooth"` on the root `<html>` element.
2. Instrument Sans and the normal Newsreader variant triggered Chrome preload
  timing warnings during development.

The warnings did not affect authentication. Address the scroll warning together
with reduced-motion behavior. Treat the font warnings as low priority and verify
them against a production deployment before changing preload behavior.

### Learnings for later phases

- Keep signup, email confirmation, sign-in, dashboard access, and sign-out in one
controlled browser when collecting complete end-to-end evidence.
- A received confirmation email proves that delivery was initiated; it does not
independently prove callback-route or redirect-allow-list behavior.
- Server-action response, session establishment, protected redirect, and
authenticated rendering provide the strongest evidence from this test.
- Keep authorization checks in protected server boundaries even when Proxy
performs optimistic session refresh.
- Separate browser warnings from flow-breaking errors.
- Preserve the landing-page regression check whenever shared layout, typography,
or global styles change.

