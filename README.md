# Kaizen

*A little better, every day.*

Multi-tenant life-management web app: tasks, projects, people, trips, vehicles, investments, inventory, media, places, best practices. Public signup via magic link; per-user isolated data; installable as a PWA.

Live: <https://personal-os-two-gold.vercel.app>

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** with OKLCH tokens, light + dark
- **Prisma 6** + **Neon Postgres** (canonical store)
- **Vercel** hosting + cron + edge middleware
- **Magic-link auth** — Resend → 7-day JWT cookie (jose)
- **Vercel Blob** for file uploads (1 GB per user, 50 MB per file)
- **Anthropic Claude API** for capture, summarization, and project chat
- **PWA**: installable, offline service worker

## Layout

```
src/
  app/
    api/auth/          request-link / verify / logout
    api/attachments/   list + upload (Vercel Blob) + delete
    api/capture/       Mac bearer-token capture
    api/cron/          founder-scoped scheduled jobs
    api/(rest)/        per-user CRUD, scoped by middleware-injected x-user-id
    login, signup      magic-link forms
    page.tsx           landing (logged-out) / dashboard (logged-in)
    settings/          account + storage + sign-out
  components/          shared React components (kaizen-landing, auth-form, files-pane, ...)
  lib/
    auth.ts            sign/verify session, getCurrentUserId, requireUserId
    email.ts           branded magic-link Resend template
    rate-limit.ts      in-memory IP + email throttle
  middleware.ts        JWT verify; forwards x-user-id header to handlers

prisma/
  schema.prisma        canonical schema — every model has userId FK to User

scripts/
  backfill-founder.ts  one-time data backfill to founder user
  add-user-scoping.mjs schema codemod (already applied)

quick-todo/            macOS menu-bar capture app (Swift), uses CAPTURE_TOKEN
```

## Develop

```sh
pnpm install
pnpm dev               # http://localhost:3000
```

Required env (`.env`, gitignored — see `.env.example`):

- `DATABASE_URL` — Neon pooled connection
- `JWT_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `RESEND_API_KEY` — for magic-link emails
- `EMAIL_FROM` — sender, defaults to `Kaizen <onboarding@resend.dev>`
- `APP_URL` — `http://localhost:3000` in dev, `https://…` in prod
- `ANTHROPIC_API_KEY` — Claude API
- `CAPTURE_TOKEN` — bearer for `/api/capture/todo`
- `FOUNDER_EMAIL` — user that bearer/cron/admin endpoints attach data to (default: `emcohen@me.com`)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (auto-populated when connected on Vercel)

Optional:

- `MAX_SIGNUPS_PER_DAY` — cap new signups per 24h (omit for unlimited)
- `INVITE_TOKEN` — if set, only `/signup?invite=<this>` can create accounts

## Auth flow

1. Visitor opens `/` → sees public landing page (no session) or dashboard (with session).
2. Clicks **Sign up** → `/signup` form → POST `/api/auth/request-link` → magic-link email.
3. Clicks link in email → `GET /api/auth/verify?token=…` → token consumed, User upserted, JWT cookie set, redirect to `/`.
4. Every API handler calls `getCurrentUserId(req)` and scopes its Prisma queries by the resulting `userId`. Middleware forwards the verified user id via `x-user-id` so handlers don't re-verify the JWT.

## Deploy

```sh
pnpm exec next build
pnpm exec vercel --prod --yes
```

Vercel project needs every env var above, plus the Blob store connected (Storage → Connect Blob → auto-injects `BLOB_READ_WRITE_TOKEN`).

## Quick Todo

The menu-bar Mac app under `quick-todo/` registers a global hotkey (default ⌃Space), pops a HUD input, and POSTs to `/api/capture/todo`. The endpoint looks up `FOUNDER_EMAIL` and attaches every todo to that user — friends don't have the Mac app.

## Status

Multi-tenant since 2026-05-19. Public signup open via magic link; rate-limited + optional kill-switch (`INVITE_TOKEN`).
