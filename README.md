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
    api/capture/       Mac bearer-token capture
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

## Todo agent

When the founder adds a todo (web, or the Quick Todo capture endpoint), a cheap Claude call decides whether an unattended agent should pick it up. The decision and the result live in one `AgentJob` row per todo (`GET /api/todos/<id>/agent`). Nothing runs unless `AGENT_ENABLED=1` is set on Vercel.

- **code**: a change to a repository in `AGENT_REPOS`. Queued for the Mac worker, which opens a PR.
- **research**: a topic a written report would satisfy. Handed off as a queued `/research` report.
- **none**: everything else (emails, calls, purchases, filings, decisions). Recorded as skipped. Health, family, dating and therapy items are skipped before anything is sent to Claude (same word lists as the `/projects` gate). Subtasks, autopilot todos and other users' todos are never triaged.

Triage must be at least 75% sure, and `code` must name a repo from the allowlist, or the job is skipped. To run a todo by hand (skipping triage): `POST /api/todos/<id>/agent {"repo": "owner/name"}`.

The worker (`scripts/agent-worker.ts`, LaunchAgent `com.personal-os.agent-worker.plist`, same install steps as the research worker) claims the oldest queued code job and, in its own clone under `~/Library/Application Support/personal-os/agent/repos/`, fetches, resets to the default branch, creates `agent/<id>-<slug>`, and runs:

```sh
claude -p "<prompt>" --permission-mode bypassPermissions --output-format json
```

Claude is told to implement the item, run the repo's checks, commit on the branch and write `summary.txt`; it is told never to push, switch branches or run destructive git commands. The worker then pushes the branch, opens the PR with `gh pr create`, marks the job done with the PR URL, cost and summary, comments on the todo, and posts to Slack (`SLACK_BOT_TOKEN` with `chat:write`, `SLACK_AGENT_CHANNEL`). No commits plus a summary is "done, no change"; no summary is "failed". The research worker posts to the same channel when a report is ready.

Guardrails: `AGENT_REPOS` is enforced again on the Mac; `AGENT_ALLOWED_EMAILS` (default `FOUNDER_EMAIL`); `AGENT_DAILY_BUDGET_USD` (default 25) stops claiming once the last 24 hours of jobs cost that much; `AGENT_TIMEOUT_MIN` (default 60) kills a run; a job still running after the timeout plus 5 minutes is marked failed; SIGTERM requeues the current job. `DATABASE_URL` and the Slack token are never passed to the Claude process. The clones under `agent/repos` are the worker's own and are reset before every job; it never touches any other checkout.

Not yet built: clarifying questions over Slack (the agent runs to completion or stops), and email or filing jobs (those stay `none`).

## Status

Multi-tenant since 2026-05-19. Public signup open via magic link; rate-limited + optional kill-switch (`INVITE_TOKEN`).
