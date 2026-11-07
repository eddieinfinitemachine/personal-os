# EC

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
    api/capture/       Mac + iOS bearer-token capture
    api/cron/          founder-scoped scheduled jobs
    api/(rest)/        per-user CRUD, scoped by middleware-injected x-user-id
    login, signup      magic-link forms
    page.tsx           landing (logged-out) / dashboard (logged-in)
    settings/          account + storage + sign-out
  components/          shared React components (ec-landing, auth-form, files-pane, ...)
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
- `EMAIL_FROM` — sender, defaults to `EC <onboarding@resend.dev>`
- `APP_URL` — `http://localhost:3000` in dev, `https://…` in prod
- `ANTHROPIC_API_KEY` — Claude API
- `CAPTURE_TOKEN` — bearer for `/api/capture/todo`
- `FOUNDER_EMAIL` — user that bearer/cron endpoints attach data to (default: `emcohen@me.com`)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (auto-populated when connected on Vercel)

Optional:

- `MAX_SIGNUPS_PER_DAY` — cap new signups per 24h (omit for unlimited)
- `INVITE_TOKEN` — if set, only `/signup?invite=<this>` can create accounts

## iOS capture

The native Personal OS app connects to `https://internal.eddiecohen.com` using
the existing `CAPTURE_TOKEN` (or a user token in `CAPTURE_TOKENS`). Never put
credentials in the app bundle or this repository.

- `GET /api/capture/mobile` verifies the token and returns `{ ok, email,
  maxRequestBytes, maxFiles }` as JSON.
- `POST /api/capture/mobile` accepts JSON or multipart form data with a UUID
  `requestId`, optional `text` and `url`, and up to ten repeated `file` parts.
  The complete request must be at most 3,500,000 bytes.
- Successful saves return `{ ok, id, type, title, destination, path }` (plus
  `assetKind` for assets). Supported types are todo, asset, person, trip, and
  interaction. Organizer or upload failures leave the capture on the phone
  for retry.
- Like the other capture routes, mobile responses carry the Captures inbox row
  id: `reviewId` on `POST /api/capture/mobile`, and on each `items[]` entry from
  `POST /api/capture/mobile/notebook`. A retry returns the same ids.
- Saves require the additive `MobileCaptureReceipt` table proposed in the
  native app handoff. It stores each user's request hash and saved result in
  the same transaction as the record. Repeating the same UUID and content
  returns the original result; changing content for that UUID returns 409.
  Database approval and rollout are tracked in `tasks/todo.md`.

Apply only explicitly approved SQL before enabling the endpoint. Vercel's
`buildCommand` runs `prisma generate && next build --webpack`, bypassing the
generic schema-push helper so a deploy cannot apply unrelated database drift.
The `pnpm build` script still contains that helper for existing manual workflows;
do not use it with `VERCEL_ENV=production` for a narrowly approved rollout.

## Auth flow

1. Visitor opens `/` → sees public landing page (no session) or dashboard (with session).
2. Clicks **Sign up** → `/signup` form → POST `/api/auth/request-link` → magic-link email.
3. Clicks link in email → `GET /api/auth/verify?token=…` → token consumed, User upserted, JWT cookie set, redirect to `/`.
4. Every API handler calls `getCurrentUserId(req)` and scopes its Prisma queries by the resulting `userId`. Middleware forwards the verified user id via `x-user-id` so handlers don't re-verify the JWT.

**Native app.** The iOS app POSTs `/api/auth/request-link` with `{ email, client: "app" }`, so the emailed link carries `&client=app`. Verify then sets no cookie and redirects (302) to `personalos://signin#token=<jwt>&email=<email>`, with the token in the fragment so it never lands in a query-string log. App sessions are the same JWT with a `client: "app"` claim and a 180-day expiry, sent as `Authorization: Bearer <jwt>`; an unauthenticated `/api/*` call that carries an `Authorization` header gets a JSON 401 instead of the `/login` redirect. `GET /api/auth/session` returns `{ userId, email }` or 401. Sessions can't be revoked server-side before they expire: there is no session table, and adding one would be a schema change. `/api/capture/*` routes resolve their own credential and accept the app session as well as the capture token (see `src/lib/capture-auth.ts`); the other passthrough routes (reader and board saves, cron) don't read the bearer session.

## Deploy

```sh
pnpm exec next build
pnpm exec vercel --prod --yes
```

Vercel project needs every env var above, plus the Blob store connected (Storage → Connect Blob → auto-injects `BLOB_READ_WRITE_TOKEN`).

## Quick Todo

The menu-bar Mac app under `quick-todo/` registers a global hotkey (default ⌃Space), pops a HUD input, and POSTs to `/api/capture/todo`. The endpoint looks up `FOUNDER_EMAIL` and attaches every todo to that user — friends don't have the Mac app.

## Read Later

`/reader` saves articles from the share sheet, the Chrome extension or the app (`POST /api/reader`, or a GET with `?url=`) and can email them to a Kindle. JSON reads for the native app, session-authenticated and scoped to the caller (another user's id is a 404): `GET /api/reader` (list, `?archived=1` for the archive; items carry `minutes`, `archivedAt`, `kindleSentAt`, `kindleError` and `kindleStatus`, plus a top-level `kindle: { configured, autoSend }`), `GET /api/reader/[id]` (the article with `contentHtml` and its highlights oldest first), `GET /api/reader/[id]/highlights` and `GET /api/settings/reading` (`{ kindleEmail, kindleAutoSend }`).

## Research

`/research` lists illustrated research reports (PDFs) and has a "New report" box. A new topic becomes a `ResearchReport` row with status `queued`; a worker on the Mac picks it up, runs Claude Code headless with the deep-research skill, renders an illustrated PDF with ReportLab (title page and thesis, why it matters, key works with images, lenses, sources and image credits), uploads it to Vercel Blob and marks the row `ready`. Cards poll every 15 s while anything is queued or running. Only the founder can queue topics, and the worker only claims the founder's rows, because Claude runs there with every permission.

```sh
pnpm exec tsx scripts/research-worker.ts           # loop: poll every 30 s
pnpm exec tsx scripts/research-worker.ts --once    # at most one job, then exit
```

The worker runs, in `~/Library/Application Support/personal-os/research/<reportId>/`:

```sh
claude -p "<prompt>" --permission-mode bypassPermissions --output-format json
```

and expects `report.pdf`, `title.txt`, `summary.txt` and `sources.json` there when it exits. It needs `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (from `.env`; neither is passed to the Claude process), plus `claude` (`~/.local/bin/claude`), `python3` with ReportLab and PIL (`/usr/bin/python3` has both), and `pdfinfo` (Homebrew poppler, optional: page count is left blank without it). Optional env: `RESEARCH_TIMEOUT_MIN` (default 45; the run is killed after it), `RESEARCH_ALLOWED_EMAILS` (default `FOUNDER_EMAIL`), `RESEARCH_CLAUDE_BIN`. A report still `running` after the timeout plus 5 minutes (the Mac slept or the worker was killed) is marked failed; SIGTERM puts the current job back in the queue. Working directories older than 30 days are removed on start.

Add a PDF made elsewhere as a ready report (uploads to Blob, page count from `pdfinfo`):

```sh
pnpm exec tsx scripts/research-seed.ts --user <userId> --file <path.pdf> --title "<title>" --topic "<topic>" [--summary "<text>"]
```

Install the LaunchAgent (runs from the `~/Code/active/personal-os-sync` checkout on main, like the other sync agents, so merge and `git -C ~/Code/active/personal-os-sync pull && pnpm -C ~/Code/active/personal-os-sync install --frozen-lockfile` first):

```sh
mkdir -p ~/Library/Logs/personal-os
cp scripts/launchagents/com.personal-os.research-worker.plist ~/Library/LaunchAgents/
launchctl bootout gui/$UID/com.personal-os.research-worker 2>/dev/null
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.personal-os.research-worker.plist
launchctl list | grep research-worker                    # exit status 78 = program path missing
tail -f ~/Library/Logs/personal-os/research-worker.log
```

It stays running (`KeepAlive`) and only works while the Mac is awake.

## Improve worker

The Improve dialog stores a change request as an `Improvement` row (`queued`). A worker on the Mac claims it, adds a fresh git worktree from `origin/main` at `~/Code/.worktrees/personal-os-improve-<id8>` on branch `improve/<id8>-<slug>`, runs `pnpm install` and then Claude Code headless (`claude -p … --permission-mode bypassPermissions --disallowedTools "Bash(git push:*),Bash(gh:*),…"`), which makes and commits the change and writes `result.json` (summary, its own risk call) to `~/Library/Application Support/personal-os/improvements/<id>/`. The worker then checks the result itself: at least one commit and a clean tree, a rebase onto the latest main, and `pnpm typecheck`, `pnpm test`, `pnpm build` with an unreachable dummy `DATABASE_URL`. A failed check fails the row and pushes nothing.

Statuses: `queued` → `running` → `shipped` | `needs_review` | `failed`; `needs_review` → `approved` (Ship it in the app) → `running` → `shipped` | `failed`.

The risk gate (`src/lib/improvements/gate.ts`) stops a change at `needs_review` (PR open, preview link when Vercel has one within ~3 minutes, worktree kept) when it touches `prisma/`, middleware or auth (`src/lib/auth*`, login, `/api/auth`), `package.json` or `pnpm-lock.yaml`, `vercel.json` or `next.config.*`, LaunchAgents, or the improve machinery itself; adds Prisma deletes or `DROP`/`TRUNCATE`/`DELETE FROM` SQL outside tests; changes more than 800 lines; conflicts with main; or when the agent itself calls it risky. Anything else is squash-merged right away (`gh pr merge --squash --delete-branch`), and the row becomes `shipped` once GitHub reports the Vercel production deployment of the merge commit as successful (after 15 minutes it ships with a "Deploy not confirmed" note). Shipping an approved row rebases and re-checks it, applies exactly the `prisma/changes/*.sql` files the PR adds with `prisma db execute` and the real `DATABASE_URL` (never a whole-schema `db push`; a `schema.prisma` change without a SQL file fails and is left for you), force-pushes with lease and merges.

Branches, commits and PRs (including the request text) land in the public GitHub repo. Only the founder's rows are claimed. Claude never sees `DATABASE_URL` or the Blob token, and `gh` always runs outside any checkout with `--repo`, so `--delete-branch` only deletes the remote branch. Failed runs keep their local branch (when it has commits) for a look; logs carry ids, statuses and durations only.

```sh
pnpm exec tsx scripts/improve-worker.ts           # loop: poll every 30 s
pnpm exec tsx scripts/improve-worker.ts --once    # at most one job, then exit
```

Needs `DATABASE_URL` (from `.env` in the working directory), plus `claude`, `gh` (logged in with push and merge rights), `pnpm` and `git`. Optional env: `IMPROVE_ALLOWED_EMAILS` (default `FOUNDER_EMAIL`), `IMPROVE_TIMEOUT_MIN` (Claude's limit, default 40), `IMPROVE_CLAUDE_BIN`. A row still `running` 90 minutes after that limit (the Mac slept or the worker died) is marked failed; SIGTERM puts a job that hasn't pushed yet back where it was.

Install or restart the LaunchAgent (runs from `~/Code/active/personal-os-sync`, whose `origin` must be the GitHub repo; pull and `pnpm install --frozen-lockfile` there first, then restart to pick up worker changes):

```sh
mkdir -p ~/Library/Logs/personal-os
cp scripts/launchagents/com.personal-os.improve-worker.plist ~/Library/LaunchAgents/
launchctl bootout gui/$UID/com.personal-os.improve-worker 2>/dev/null
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.personal-os.improve-worker.plist
launchctl kickstart -k gui/$UID/com.personal-os.improve-worker   # restart after pulling
tail -f ~/Library/Logs/personal-os/improve-worker.log
```

## Status

Multi-tenant since 2026-05-19. Public signup open via magic link; rate-limited + optional kill-switch (`INVITE_TOKEN`).
