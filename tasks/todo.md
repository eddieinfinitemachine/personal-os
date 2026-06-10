# Bulk Add People — Friends (in progress)

Goal: paste freeform text ("Met Sarah Chen at the AI dinner in SF, PM at Stripe,
into climbing; also Jon her partner, photographer in Brooklyn") → structured
Person rows → reviewed/edited → inserted in bulk.

Decisions: skip WhatsApp for now (no API for personal WhatsApp — revisit via
chat-export later); editable preview before insert; web-only (flag iOS port).

## Tasks
- [x] `POST /api/people/parse` — `{ text }` → `{ people: ParsedPerson[] }` via
      `callClaudeJSON` (no DB writes). "context"→howWeMet/notes,
      "location"→city/country, infer strength/interests/tags.
- [x] `POST /api/people/bulk` — `{ people }` → createMany scoped to userId →
      `{ created }`. Coerce birthday→Date, socialUrls→Json. Caps: 200/req.
- [x] `BulkAddPeople` client modal — textarea → Parse → editable preview cards
      (checkbox + editable key fields + duplicate flag) → "Add N" → bulk insert.
- [x] Wire "Bulk add" button into `FriendsList` next to "Add person".
- [x] Verify: `tsc --noEmit` clean.

iOS port (not now): SwiftUI sheet w/ TextEditor → /people/parse → editable list
→ save. Flagged for later.

## Review
Files: `src/app/api/people/parse/route.ts`, `src/app/api/people/bulk/route.ts`,
`src/components/bulk-add-people.tsx`, edits to `src/components/friends-list.tsx`.
- Reused existing `callClaudeJSON` (sonnet-4-6) + auth (`getCurrentUserId`) +
  CSS-var styling — no new deps. Parse and insert are split so nothing is
  written until the user confirms in the editable review step.
- Duplicate detection is name-based against the loaded Friends list (client-side
  warning only; doesn't block). Per-row include checkbox + delete.
- Needs `ANTHROPIC_API_KEY` (already set in env). Untested against live API in
  this session — verify one real paste end-to-end after deploy.

---

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

---

# Code-improvement pass — 2026-05-28

Full four-angle audit (security/tenancy, correctness, code quality, performance). App is
well-built overall; this pass fixes real security/correctness bugs, removes dead/unsafe
surface, dedupes route boilerplate, and splits god components.

## Phase 1 — Security criticals
- [ ] Delete `src/app/api/admin/*` (6 unauthenticated seed routes, ~1180 LOC) + remove `/api/admin/` middleware bypass + remove dev hint in human-dashboard
- [ ] Lock `api/dropbox/{list,thumbnail}` to founder only (cross-tenant root-namespace leak)
- [ ] Fail closed on missing `JWT_SECRET` in production (auth.ts + middleware.ts)

## Phase 2 — High-severity correctness / auth
- [ ] sync-poll: reschedule on `!res.ok` (dead-loop) + light backoff
- [ ] Due-date timezone off-by-one (parse YYYY-MM-DD as local, not UTC)
- [ ] Capture endpoints fail closed in prod when `CAPTURE_TOKEN` unset; drop querystring token
- [ ] Magic-link verify: atomic `updateMany` consume (token-reuse race)

## Phase 3 — Cleanups / dedup
- [ ] `withAuth` + `requireOwned` route helpers; refactor routes
- [ ] `callClaude` lib helper; dedupe routes + coach.ts
- [ ] Fix dead sidebar cache (wrap `unstable_cache` with the already-invalidated tag)
- [ ] Remove dead exports + applied codemod scripts
- [ ] Batch the personHints N+1 in capture/smart/auto

## Phase 4 — God-component splits
- [~] DEFERRED (see review)

## Verification
- [x] `pnpm typecheck` clean
- [x] `pnpm build` clean (only pre-existing jose/Edge `CompressionStream` warning)

## Review

Shipped Phases 1–3. Net **−1,164 LOC** across 34 files. Build + typecheck green.

### Security (all verified)
- **Deleted `src/app/api/admin/*`** (6 routes, ~1,180 LOC) — they had *zero* auth, were
  waved through by middleware, and let anyone wipe/reseed founder data or trigger unbounded
  Claude calls. Removed the `/api/admin/` middleware bypass + the dev hint in human-dashboard.
- **Dropbox routes founder-gated** — `api/dropbox/{list,thumbnail}` used one shared
  root-namespace token reachable by any tenant. Added `isFounderUser()` gate (lib/cron.ts).
- **`JWT_SECRET` fails closed in prod** — `auth.ts` + `middleware.ts` now throw at boot if
  unset in production instead of signing with a public default (was a forge-any-session hole).
- **Capture endpoints fail closed in prod** when `CAPTURE_TOKEN` unset (matched the cron pattern).
- **Magic-link verify is now atomic** — guarded `updateMany(usedAt: null)` closes the
  token-reuse race.

### Correctness
- **Due-date / trip-date off-by-one** — date-only values stored at UTC midnight were rendered
  & compared in local time → showed the previous day west of UTC, and `isOverdue` tripped a
  day early. Added `formatCalendarDate` / `toDateInputValue` / `isCalendarDateOverdue` to
  `lib/utils.ts` and applied across todo-row, calendar-view (incl. month-grid bucketing),
  trip-itinerary, trips-list, print/today.
  - *Correction to the audit:* the "sync-poll permanently dies on !res.ok" finding was **wrong** —
    the `finally` block reschedules even on early `return`. Polling does not die. I instead added
    exponential backoff (1.5s→15s) that resets on focus/change, cutting idle request volume ~6×.
  - *Known remaining inconsistency:* vehicle/pet service & vaccination dates conflate a date-only
    pick with a `new Date()` now-timestamp default, so a blanket UTC fix would shift the
    now-defaulted rows the other way. Left as-is; proper fix is to normalize those to date-only
    storage. (follow-up)

### Cleanup / perf
- **`callClaude` helper** (`lib/claude.ts`: `callClaudeText` / `callClaudeJSON`) — deduped the
  Anthropic fetch+extract boilerplate across 6 routes + `coach.ts`. Added a `messages[]` option
  so `projects/[id]/ask` keeps its multi-turn history (a regression the first cut would've caused).
- **Removed dead `revalidateTag('sidebar-projects:…')` calls** (5 sites) — no `unstable_cache`
  ever tagged that key, so they were no-ops. Honors the explicit "no cache layer for friends-only"
  decision documented in layout.tsx.
- **Removed dead `getCurrentUser`** + its orphaned prisma import from `auth.ts`.
  (`invalidateLists/Projects` turned out to be *used* via window listeners — audit was wrong; kept.)
- **Fixed the personHints N+1** in `capture/smart/auto` — ported the batched `findMany(OR)` +
  in-memory map the commit route already uses (was 2 queries per hint).

### Deliberately deferred (recommended as a dedicated, test-backed effort)
These are **pure-structure** changes to **working, security-critical, untested** code; the
regression risk outweighs the readability gain in a single sweep. The security audit confirmed
tenant isolation is currently correct and consistent, so there's no urgency.
1. **`withAuth` / `requireOwned` helpers across ~61 routes** — would collapse the repeated
   auth preamble (92×) and ownership check (58×). High mechanical-churn; do it behind tests.
   `requireUserId` already exists in `auth.ts` as the seed for this.
2. **Splitting god components** — list-tile (1270L), smart-capture-form (1268L), todo-row
   (1142L), friends-list (1092L), trip-itinerary (999L) into hooks/files. No functional benefit;
   meaningful regression surface in core UI without tests.
3. **Shared `Field`/`Input` primitives** redefined in 8 files → one `components/ui/`.

Happy to take any of these on next as a focused, verified pass.

---

## Follow-up fixes — 2026-05-28 (list behavior bugs reported by Eddie)

**1. Checking a todo off didn't remove it from the list.** Home tiles & project lists only
render incomplete todos (server filters `completedAt: null`), but `toggleComplete` only set an
optimistic `completedAt` override — the row stayed visible (checked) until the next refresh.
Fix: on *completing*, also hide the row immediately (`hiddenIds` / `hidden`), with rollback on
PATCH failure, in both `list-tile.tsx` and `project-card.tsx`. Added the missing `.catch`
rollback to project-card's toggle while there.

**2. "+N more…" pagination / "lists skitzing" on check-off.** Tiles were fed a capped slice
(`PREVIEW_LIMIT=12`, `PROJECT_LIST_PREVIEW=8`, project page `slice(0,20)`) plus a `totalCount`,
and list-tile lazily loaded the rest into `extraTodos`. Checking off an item triggered
`router.refresh()` → the `[todos]` effect reset `extraTodos` to `[]` → the expanded list
collapsed back to the preview, which read as the list "skitzing." Project cards silently
truncated at 8 with no "more" affordance at all.
Fix: removed all three caps — every tile now receives and renders **all** its incomplete todos.
Removed the now-dead `loadMore`/`loadingMore` + both "+N more" buttons from list-tile. Kept
`extraTodos` solely as the optimistic holding pen for drag-in-from-another-tile.

Both verified: `pnpm typecheck` + `pnpm build` green.

---

## HIG Design Polish Pass (2026-06-10)

Apple-HIG-guided polish: snappy motion, materials/depth, type hierarchy. Zero new deps —
all CSS (custom easing tokens, keyframes, @starting-style). Plan: ~/.claude/plans/parsed-knitting-sedgewick.md

### Done
- [x] **Tokens** (`globals.css`): motion (`--ease-spring/out-quart/bounce`, check-pop/fade-in-up/scale-in
  keyframes), HIG label levels (secondary/tertiary/quaternary), separator/card-border/fill/elevated +
  destructive/success/warning colors (white-alpha in dark), layered `shadow-card/popover/modal`
  (var()-referenced so dark overrides work), HIG type scale (`text-large-title/title/headline/subhead/caption`),
  `pressable` utility, `prefers-reduced-motion` kill switch, grouped desktop bg, thin scrollbars, ::selection.
- [x] **Completion choreography** (list-tile + todo-row): check pops (bounce overshoot) + `haptic("success")`
  → strikethrough eases → 600ms linger → 260ms grid-rows collapse → hidden. Interruptible (re-tap cancels).
  Refresh deferred 950ms so server data doesn't unmount mid-animation. "All done" moment when a tile
  empties via completion. New `temp-` rows fade-in-up.
- [x] **Overlays**: `use-overlay-transition.ts` hook + data-overlay CSS system. Todo modal: scale+fade desktop,
  bottom-sheet on mobile, animated exit. Capture drawer slide+fade. Nav drawer 300ms ease-spring + blur
  material. Context menu / project picker / list menu scale-in on `--color-elevated` + shadow-popover.
- [x] **Materials**: top/tab bars `bg/80 backdrop-blur-xl saturate-150`, separators, sidebar fill-secondary.
- [x] **Type/components**: page h1s → text-large-title bold (14 pages), tile titles → text-title, counts →
  tertiary gray tabular (iOS Reminders style), tinted sidebar/drawer selection, tab bar sliding pill +
  tint active + haptic, FAB long-press sink, refined checkbox (quaternary border, 1.5px desktop), due
  chips (fill bg, destructive overdue), auth form (tint primary button, fill inputs, focus ring),
  shimmer skeletons (4 loading.tsx), EmptyState component (trips + friends).

### Fixes found during browser verification
- todo-row swipe-area painted `bg-background` over lifted dark cards → `md:bg-transparent`.
- li grid collapse broke long-URL wrapping (implicit column min-content) → `grid-cols-[minmax(0,1fr)]` + `min-w-0`.

### Verified
- `tsc --noEmit` + `next build` green; compiled CSS contains all custom utilities/keyframes.
- Browser (agent-browser, desktop 1440 + iPhone 390, light + dark): grouped bg + floating cards,
  dark elevation ladder, completion animation sampled at t+100/400/750/900 (linger → collapse → gone),
  mobile flat bg + blurred bars + tab pill intact.
- NOT yet manually verified: drag-and-drop todo rows (desktop HTML5 + mobile long-press) after the
  li wrapper change — exercise on next real use; fallback is opacity-fade only (see plan).
