# Kaizen — Multi-tenant + File Upload (✅ SHIPPED 2026-05-19)

## Review

Shipped in a single session. Codebase migrated from single-user password gate to public-signup multi-tenant SaaS with file uploads.

**What landed:**
- Auth: magic-link via Resend → 7-day JWT cookie. `signSession`/`verifySession`/`getCurrentUserId`/`requireUserId` in `lib/auth.ts`. Routes: `/api/auth/request-link`, `/verify`, `/logout`. Rate-limited (3/10min per email + IP). Optional anti-abuse: `MAX_SIGNUPS_PER_DAY`, `INVITE_TOKEN`.
- UI: Kaizen-branded landing page at `/` (logged-out), dashboard (logged-in). `/signup` + `/login` magic-link forms with "Check your inbox" state. Settings page at `/settings` (email, storage usage, sign-out). Settings link added to sidebar. Mobile chrome + manifest rebranded.
- Multi-tenant data: `userId` FK added to all 30 Prisma models with index. Founder backfill ran cleanly (1,023 rows assigned to emcohen@me.com). All 67 API routes + 12 server pages + lib helpers updated to scope by userId. Bearer/cron/admin endpoints look up founder via `FOUNDER_EMAIL` env var.
- File uploads: `POST /api/attachments/upload` writes to Vercel Blob under `users/{userId}/projects/{projectId}/…`. 1 GB per-user quota, 50 MB per-file cap. FilesPane has drag-drop zone + file picker. Blob deleted on attachment row delete.
- Build: `next build --webpack` compiles clean. Zero TypeScript errors.

**Still required from operator (Eddie):**
1. Verify Resend key works for `onboarding@resend.dev` sender — if not, set up a verified `mail.infinitemachine.com` (or similar) sender on Resend and update `EMAIL_FROM` in `.env` + Vercel.
2. Connect Vercel Blob to the project (Storage → Connect Blob) and confirm `BLOB_READ_WRITE_TOKEN` lands in prod env.
3. Set every new env var on Vercel: `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `FOUNDER_EMAIL`, `BLOB_READ_WRITE_TOKEN`. The old `APP_PASSWORD` can be removed.
4. Deploy + smoke test live: sign up with a second email, upload a file, confirm isolation from founder data.

**Lessons captured separately if needed** — none required this session; pattern was straightforward.

---

# (Original plan below for reference)


**Product name**: Kaizen (改善, "continuous improvement"). Replaces the working name "Personal OS" on the landing page, in emails, and in the app header. Codebase / repo / Vercel project keep their existing names for now (rename later).

**Goal**: Replace single-password gate with public signup. Anyone with the link can land on a marketing page, enter their email, get a magic link, and have their own isolated account. Add real file upload to projects (Vercel Blob).

**Out of scope (explicit)**: billing, password auth, OAuth, password reset, GDPR export, abuse handling, SEO. Sharing model is "Eddie hands out the URL"; no public discovery.

---

## Phase 1 — Auth foundation

Magic-link auth (Resend) → JWT cookie. Same pattern as `infinite-machine-dealer-portal`.

- [ ] Add deps: `resend`, `jose`
- [ ] Env: `RESEND_API_KEY`, `JWT_SECRET`, `EMAIL_FROM`, `APP_URL`
- [ ] Prisma: add `User`, `MagicLinkToken` models
  - `User { id, email @unique, name?, createdAt, lastSeenAt }`
  - `MagicLinkToken { id, email, tokenHash, expiresAt, consumedAt? }`
- [ ] `lib/auth.ts`: `signSession(userId)`, `verifySession(req)`, `getCurrentUser(req)`, `requireUser(req)`
- [ ] `/api/auth/request-link` — POST email → upsert User → email magic link (rate-limit: max 3 links per email per 10 min)
- [ ] `/api/auth/verify?token=...` — consume token → set `personalos-session` cookie (JWT, 7d) → redirect to `/`
- [ ] `/api/auth/logout` — clear cookie
- [ ] `middleware.ts`: verify JWT instead of `personalos-auth=ok`; forward `x-user-id` header; allow `/`, `/signup`, `/login`, `/api/auth/*` as public

## Phase 1b — Public landing + signup

- [ ] `/` rewrite: if no session → landing page; if session → existing dashboard (today's `/` content)
  - Marketing-style: headline, what it does (todos / projects / trips / friends / vehicles / files), screenshot or short feature list, single "Sign up" CTA → `/signup`
  - Helvetica Now Display, dark-mode default, matches IM app style guide
- [ ] `/signup` page: email input → POST `/api/auth/request-link` → "Check your inbox" confirmation
- [ ] `/login` page: same form but copy says "Sign in" (same endpoint — magic link creates account if new, signs in if existing)
- [ ] Magic-link email template: branded, single button, expires in 15 min
- [ ] Delete legacy `/api/login/route.ts` and `APP_PASSWORD` references

## Phase 2 — Multi-tenant data

- [ ] Add `userId String` + `user User @relation` + `@@index([userId])` to all 30 models
- [ ] Migration script `scripts/backfill-founder.ts`:
  1. Insert founder user (Eddie's email)
  2. For every table, `UPDATE x SET userId = $founderId WHERE userId IS NULL`
  3. Apply NOT NULL + FK constraint after backfill
- [ ] Scope every API route by `getCurrentUser(req).id` — 66 route files
  - Strategy: grep for `prisma.<model>.findMany/findUnique/findFirst/update/delete/create`, add `where: { userId }` / `data: { userId }`
  - Add a `requireUser(req)` helper that 401s if no session
- [ ] Spot-check: another user can't read founder's projects via API

## Phase 3 — File uploads (projects)

- [ ] Add dep: `@vercel/blob`
- [ ] `POST /api/attachments/upload` — multipart → `put()` to Blob → create `Attachment { kind: "file", url: blobUrl, size, mimeType }`
- [ ] Per-user quota: 1 GB free. Sum `Attachment.size WHERE userId` before insert, 413 if over
- [ ] `FilesPane` UI: file picker + drag-drop zone next to existing "paste URL" input
- [ ] Delete blob from storage when Attachment row is deleted (cascade hook)

## Phase 4 — Polish

- [ ] Settings page (`/settings`): show email, logout button, storage used / quota
- [ ] Update root layout / header to show signed-in user's name/email + logout
- [ ] Smoke test: sign up as a second email, create project, upload file, confirm isolation from founder data
- [ ] Update README: new auth model, env vars, signup flow

## Anti-abuse (cheap, since signup is now public)

- [ ] Rate-limit `/api/auth/request-link` by IP + email (in-memory or Upstash)
- [ ] Cap new signups: 50/day global (env var `MAX_SIGNUPS_PER_DAY`) — just bail if exceeded
- [ ] Optional: `INVITE_TOKEN` query param on `/signup?invite=XYZ` — if set in env, signups without it are blocked. Easy switch to invite-only if randos show up.

---

## Decisions locked

- **Name**: Kaizen
- **Email sender**: dedicated Resend sender (need to register a sending domain — recommend `kaizen@mail.infinitemachine.com` or `hello@…` once a domain is picked; otherwise `onboarding@resend.dev` works as a stopgap)
- **Quick Todo Mac app**: stays hardcoded to founder (Eddie) — the capture endpoint will look up the founder user by env var and attach there
- **Domain**: keep `personal-os-two-gold.vercel.app` for now (rename later)

## Landing page copy (draft — needs sign-off)

> # Kaizen
> *A little better, every day.*
>
> Kaizen holds the whole of your life in one calm, deliberate place — the tasks, the projects, the people you want to stay close to, the trips you're planning, the things you own, the things you've been meaning to read.
>
> Not a productivity app. A place to be honest about what you're keeping track of, and to leave it a little better than you found it.
>
> - **Capture** anything in a second — todos, ideas, links
> - **Projects** with their tasks, notes, and files in one place
> - **People** worth remembering — when you last saw them, what to follow up on
> - **Trips** with flights, lodging, and packing lists
> - **The rest of your life** — vehicles, investments, inventory, places, best practices
>
> [ Sign up — it's free ]
> *Currently invite-only-ish. If you have the link, you're in.*

---

## Review (filled in after work)

(empty)
