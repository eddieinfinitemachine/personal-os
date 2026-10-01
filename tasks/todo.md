# Send todo to tracker (Media etc.) — in progress 2026-09-29

Goal: the todo row's project picker (and a "Send to tracker…" context-menu
submenu) lists the Asset-backed trackers enabled in this browser (Media,
Places, Inventory, Investments, Best practices). One click turns the todo into
an item in that tracker, Claude (web search) fills the details, the todo is
deleted, and ⌘Z / the Undo pill deletes the asset and restores the todo.

- [x] `forceType` for media / place / investment / practice (`requiredTypeBlock` in `src/lib/smart-capture.ts`); parse route accepts them
- [x] Shared proposal → Asset helper `src/lib/smart-commit.ts` (commit route uses it; behaviour unchanged)
- [x] Shared `deleteTodo` (`src/lib/todo-delete.ts`, incl. gcal cleanup) used by DELETE /api/todos/[id]
- [x] `POST /api/todos/[id]/to-tracker` (401/400/404/502, restore snapshot in response)
- [x] Todo row: picker section + context submenu, "Sending to Media…" spinner, retry hint on failure, undo
- [x] Tests: route, smart-commit defaults, forceType prompt block, todo-row picker/send/undo/failure
- [x] Live scratch-DB run: "Watch: 711 documentary" → Media → /media → Undo
- [ ] Review + merge

## Review
Live (scratch Postgres, real Claude): asset `711`, category `documentary`,
status `to-watch`, subtitle/url empty, detailsJson `{format: "documentary",
source: "todo", sourceTodoId, sourceTodoTitle}`; notes say the exact work could
not be identified. Claude searched twice but "711 documentary" is ambiguous and
it declined to guess. A probe with "Watch: Free Solo documentary" filled
directors, 2018, runtime, genre, Wikipedia URL. Undo deleted the asset and put
the todo back with its original id.

# Import Granola — home-page button → routed team todos (in progress 2026-09-29)

Goal: "Import Granola" button next to "New list" on Home. Pick a recent Granola
meeting → Claude extracts who committed to what → each item routed to that
person's EC/* list (Dave = EC/DV, sales; Obie = EC/OB, digital; unowned/Eddie
→ To Do + Inbox) → quick review (pre-checked rows) → one click adds them.
Replaces the paste-based importer retired 2026-09-28 (its parse/commit logic is
restored from 1e24c89^ and adapted to pull from the Granola API instead).

## Tasks
- [x] `src/lib/team.ts` — TEAM map (list name → person names + role), used in prompt + resolver
- [x] `src/lib/meeting-extract.ts` — restored prompt/resolver as a pure, tested helper
- [x] `GET /api/meetings/granola` — founder + GRANOLA_API_KEY gated, recent notes (14 days)
- [x] `POST /api/meetings/granola/parse` — { noteId } → note+transcript → items (no writes)
- [x] `POST /api/meetings/commit` — restored, provenance line links the Granola note
- [x] `src/components/import-granola-button.tsx` — pick → extracting → review → done
- [x] Home header: render button (founder + key only) before New list
- [x] Unit + route tests; typecheck; vitest
- [x] Live verify on scratch Postgres with the real GTM Meeting 9/28 note

## Review
Built by the Opus worker (uncommitted on main). `pnpm typecheck` clean (after
removing stale `.next/types` from the deleted old parse route); `pnpm test`
66 files passed / 15 skipped, 647 tests passed. New: meeting-extract (10),
granola list route (3), parse route (3), commit route (2).

Live run (scratch PG on :54332, `next dev --webpack`, real prod GRANOLA_API_KEY
kept in the scratchpad only, Google/Resend/etc. env blanked so nothing left the box):
the picker listed 30 real meetings; "GTM Meeting 9/28" is `not_Zh3xFsvZIANAtk`
in the public API (the UUID 47474c2a… returns 400 there; it is only the
web_url slug). Parse took 24 s and gave 20 items: EC/OB ×12, EC/DV ×3,
EC/Ash ×2, To Do ×3. Add wrote all 20 to the right tiles, To Do ones in the
Inbox project, with the provenance line and the Granola link in notes.
Claude gave "deposit backlog cleanup" to Eddie (To Do), not Dave, even though
the summary says (Dave). EC/DV still got 3 items (Das Auto follow-up,
fleet/B2B cadence, signage to Zach). "Launch ads today" got a due date of the
meeting day, so it is already overdue.

## Granola auto-import cron (GTM / C2 / Leads)

Every 30 minutes, Granola notes in the folders named exactly GTM, C2 or Leads
(case-insensitive; not "GTM Weekly Review", "GTM Daily Standup", "C2-Ben",
"Functional Leads Meetings") are turned into routed todos with no review step.

> **The `GranolaImport` table has NOT been applied to production.** It exists
> only in prisma/schema.prisma (and was pushed to a scratch Postgres for
> verification). Run `pnpm db:push` against prod before merging/deploying, or
> the cron, the picker list and the commit route will all fail on the missing table.

- [x] `src/lib/granola.ts`: `listFolders()` (paged, MAX_PAGES guard) + `folderId` → `folder_id` on listNotes/listNotesPage
- [x] Schema: `GranolaImport` (userId+noteId unique) + User back-relation; `pnpm db:generate`
- [x] `src/lib/meeting-import.ts`: `extractFromNote` + `commitItems` (autopilotKey, skipDuplicates, GranolaImport upsert in one transaction)
- [x] Parse + commit routes refactored onto the service; button sends `noteId`; manual imports record `source: "manual"`
- [x] `src/lib/granola-auto-import.ts`: `AUTO_IMPORT_FOLDERS`, exact matching, non-matching child folders excluded
- [x] `GET /api/cron/granola-todos` (3-day window, max 4 notes/tick, oldest first) + vercel.json `*/30 * * * *`
- [x] Picker shows a muted "Imported" tag (still selectable)
- [x] Tests: cron route (11), meeting-import (7), granola folders (3), list route imported flag, commit route rewritten
- [x] Live verify on scratch PG (:54333) with the real key
- [ ] Apply `GranolaImport` to prod (`pnpm db:push`) — needs Eddie's go-ahead

### Review
`pnpm typecheck` clean; `pnpm test` 68 files passed / 15 skipped, 671 tests passed.
Live run: the real folders resolved to GTM `fol_UeftsroSoNajNN`, C2 `fol_aKL9SrCONDrOpT`
and Leads `fol_lnxL4GrRUwWpWc`, all top-level. The 3-day window held one note,
"GTM Meeting 9/28" (`not_Zh3xFsvZIANAtk`). The first run took 28 s and imported 22
items: EC/OB ×15, To Do ×5 (in Inbox), EC/DV ×2. The second run returned `skipped: 1`
and imported nothing. Home tiles and the picker's "Imported" tag were checked in the browser.
A manual parse + commit of "Olto x Bird" wrote a `source: manual` row, and the picker then flagged it too.
Manual imports get keys `granola:{noteId}:m{stamp}:{i}` instead of `granola:{noteId}:{i}`,
so a deliberate re-import from the picker isn't silently dropped by skipDuplicates.

---

# Trips — Gmail booking import → itinerary (built, Phase-1 verified 2026-08-26)

Goal: "Pull from email" — scan Gmail for booking confirmations (flights, lodging,
trains, restaurants, activities) relevant to a trip → Claude parses into TripItem
proposals → pre-checked review list → bulk add. Auto-runs after trip create via
/trips/[id]?scan=1. Env-token founder-gated Gmail (Dropbox pattern), review-first,
no schema changes. Plan: ~/.claude/plans/wiggly-singing-sketch.md

## Tasks
- [x] `src/lib/google.ts` — token refresh + Gmail REST + extractTextFromPayload
- [x] `src/lib/email-scan.ts` — queries, prompt, validateProposals, markDuplicates (pure)
- [x] `src/app/api/trips/[id]/email-scan/route.ts` — scan endpoint, no writes
- [x] `src/app/api/trips/[id]/items/bulk/route.ts` — bulk insert (cap 100, kind whitelist)
- [x] `src/components/trip-email-import.tsx` — button → scanning → review → add
- [x] Wire: trips/[id]/page.tsx (gmailConfigured/autoScan), trip-itinerary.tsx header, add-trip-button redirect ?scan=1
- [x] `scripts/google-oauth-mint.ts` + .env.example GOOGLE_* vars
- [x] Phase 1 verify: tsc clean; 27/27 checks (extraction/queries/dedupe fixtures +
      live prompt smoke w/ real API key); guard checks on scratch PG (unconfigured
      500, kind "task" 400, 101 items 400, valid bulk insert renders in sections,
      no button when unconfigured, ?scan=1 no-op, create→redirect verified)
- [x] Google Cloud setup (driven via Eddie's Chrome, 2026-08-26): project
      kaizen-gmail-506720, Gmail API enabled, consent screen **Internal**
      (bookings live on eddie@infinitemachine.com Workspace — Internal beats
      External: no verification, no 7-day Testing-mode token expiry), Desktop
      OAuth client, refresh token minted via scripts/google-oauth-mint.ts +
      in-browser consent. 3 GOOGLE_* vars in .env + Vercel production.
- [x] Phase 2 verify on prod: live scan extracted a real Trainline booking
      (Shrewsbury→London Euston, both times, connection detail, $65.39) into
      Ground transport; auto-scan via ?scan=1, review list, Add, and re-scan
      dedupe all confirmed. Test trip created + deleted.
- [x] FIX during live verify: first prod scan returned 0 proposals from 25
      emails despite matching bookings existing. Broad subject clause
      (confirmation OR booking OR receipt) matched 200+ SaaS invoices /
      internal customer mail; Gmail is newest-first, so junk ate the whole
      25-message budget. Replaced with 4 precise queries (travel senders,
      category:reservations, destination+travel phrases, travel phrases)
      merged ROUND-ROBIN so a broad query can't starve a precise one.
      Junk dropped 25 → 12 scanned, real bookings now surface. (19ab407)

## Review
Implementation dispatched to Sol (cursor) from the full spec, reviewed line-by-line
by Fable — matches spec incl. founder gate (404), no-write scan route, review-first
commit. One prompt fix found via live smoke test: a round-trip fare was landing in
notes on both segments — added rule to put costUsd on the first item only of a
multi-item booking (avoids double-counting); re-ran, 27/27 green. Feature ships
dark: button hidden and ?scan=1 inert until the GOOGLE_* env vars exist, so it is
safe to deploy before the operator steps.

LIVE ON PROD 2026-08-26 (afedacd + 19ab407). Two gotchas worth remembering:
1. `vercel env add` reading piped stdin stores the trailing newline as a
   literal `\n` inside the value → every GOOGLE_* var was 2 chars too long and
   token refresh 502'd. Use `printf '%s'` (no newline) when piping secrets in.
2. Broad Gmail subject keywords are useless in a work mailbox — see the
   round-robin query fix above. Precision beats recall when the result window
   is capped and Gmail sorts newest-first.

MAILBOX CAVEAT: the connected account is eddie@infinitemachine.com (work). It
holds Eurostar/Trainline/OpenTable bookings but essentially no leisure travel —
the Swiss and South-of-France trips have zero matching emails there. Personal
bookings likely live on another account (eddiecohen.on@gmail.com, eddie@walden.us,
or iCloud). Connecting a second mailbox = re-mint a refresh token for that
account; the current design holds ONE token in env, so multi-mailbox support
would need a per-account token store (schema change — flag before building).

---

# Trips — NL trip entry on /trips (✅ built + verified 2026-08-26)

Goal: describe a trip in natural language from the /trips page ("Tokyo Jan 5–12
with Maya, Park Hyatt booked") → parsed fields prefill the New-trip modal →
review → Create. Reuses smart-capture's parseCapture + /api/capture/smart/parse.
Plan: ~/.claude/plans/wiggly-singing-sketch.md

## Tasks
- [x] `src/lib/smart-capture.ts` — `ParseInput.forceType?: "trip"` + REQUIRED TYPE directive line
- [x] `src/app/api/capture/smart/parse/route.ts` — accept `forceType=trip`, skip @alias routing when set
- [x] `src/components/add-trip-button.tsx` — "Describe it…" input + Fill button prefills draft (non-null merge)
- [x] `npm run typecheck` clean; diff reviewed (only these 3 files)
- [x] E2E on scratch Postgres (port 54331, torn down): parse API + full browser flow

## Review
Implementation dispatched to Sol (cursor), reviewed line-by-line — matches spec.
E2E on scratch PG + real API key: "Tokyo Jan 5–12 with Maya, staying at Park
Hyatt, $4k budget, flights booked" → trip w/ 2027 dates (correct forward
resolution), status=booked, travelers=[Maya], costUsd=4000. Force test: "Aspen
with the kids over Thanksgiving" (would classify as interaction) → trip with
approximated Thanksgiving dates, so REQUIRED TYPE directive holds. Browser
pass (agent-browser, magic-link login): Fill disabled when empty → typed
"Lisbon with Piol first week of October, flying TAP, Airbnb in Alfama, ~$3k"
→ all 9 fields prefilled → Create → row verified in psql exactly as parsed.
No new deps, no schema changes. Pushed to main (f464f7a) 2026-08-26.

---

# Trips — AI Packing Lists (✅ built + shipped 2026-08-26)

Goal: on a trip, describe what you're doing → AI recommends a packing checklist
from weather (keyless Open-Meteo) + activities → tune it by chatting → check
items off while packing. Plan: ~/.claude/plans/buzzing-strolling-cerf.md

## Tasks
- [x] Schema: `PackingItem` model + `Trip.packingContext` (additive; db:push)
- [x] `src/lib/trip-weather.ts` — geocode + forecast/historical summary, null-safe
- [x] `src/app/api/trips/[id]/packing/route.ts` (GET/POST) + `[itemId]` (PATCH/DELETE)
- [x] `src/app/api/trips/[id]/packing/generate/route.ts` (maxDuration 60, dedupe)
- [x] `src/lib/packing-edit.ts` + `src/app/api/trips/[id]/packing/chat/route.ts`
- [x] `src/components/trip-packing.tsx` + wire into `/trips/[id]` page
- [x] tsc + build clean
- [x] E2E on scratch Postgres: generate, toggle, chat tune (real API key)
- [x] Weather smoke: forecast path, historical path, garbage destination
- [x] db:push prod (Eddie ran it — classifier blocks agent prod pushes), push main, verified live (v0.173: /trips + trip page + packing 404 path)

## Review
Built exactly per plan; all patterns reused from pets chat / meeting parse.
E2E on scratch PG: generate produced 34 items (weather-aware — rain jacket for
drizzle days, layers for 60s mornings; activity-aware — hike/dinner/gym; altitude
reasoning for Denver). Chat tune removed 5 dinner/gym items + added a book;
"swap book for magazine + check sunglasses" did an update_item (not delete+add)
and set_packed, verified in pixels. Regenerate: 0 dupes, nothing removed.
Found+fixed during verification: Open-Meteo archive precip defaults to mm —
added precipitation_unit=inch. Deploy order matters: schema push BEFORE main
push or /trips/[id] 500s on missing columns.

---

# Meeting Import — transcript → team-list todos (✅ built + verified 2026-08-18)

Goal: paste a Granola meeting transcript → Claude extracts the concrete next
steps → each one is routed to the right team member's `EC/*` delegation list
(Obie's action items land on `EC/Obie`, etc.) → Eddie reviews/edits every row →
commit creates the todos. Nothing is written without the explicit review step
(per feedback_no_auto_todos / feedback_capture_inbox).

Design (mirrors Bulk Add People parse→review→bulk shape):
- `POST /api/meetings/parse` — `{ text }` → `{ meetingTitle, meetingDate,
  items: [{ title, owner, notes, dueDate, listId, listName }] }`. No writes.
  Server injects the user's `EC/*` list names (via `aliasTargetsFromLists`)
  into the prompt so Claude picks an existing list; server validates the
  returned listName against `listAccessWhere` lists and falls back to
  alias-prefix matching on owner ("David" → EC/Dave), else null.
- `POST /api/meetings/commit` — `{ meetingTitle?, meetingDate?, items }` →
  validated per-row list access → `todo.createMany`. Rows with no/invalid list
  go to To Do + Inbox project (capture triage convention); a "From meeting: …"
  provenance line is appended to notes.
- `/capture/meeting` page + `MeetingImport` client component (dense editable
  rows: include ✓, title, list select, notes, optional due date). Entry link on
  the Capture page. No schema changes; `callClaudeJSON` + DEFAULT_MODEL.

## Tasks
- [x] `src/app/api/meetings/parse/route.ts` (maxDuration 60, 200k char cap)
- [x] `src/app/api/meetings/commit/route.ts` (≤100 items, list access checks)
- [x] `src/components/meeting-import.tsx` (input → review → done phases)
- [x] `src/app/capture/meeting/page.tsx` + link from `/capture`
- [x] `tsc --noEmit` clean
- [x] E2E on scratch Postgres (seed EC/Dave, EC/Obie, EC/Ash, EC/Ben; run the
      real GTM Team Sync transcript through parse → commit; verify rows)

## Review
Verified against the real 58k-char GTM Team Sync transcript on a scratch
Postgres (port 54329, torn down after): parse returned 15 items in ~24s, all
correctly routed (EC/Obie ×8, EC/Dave ×4, EC/Ben ×2 incl. an end-of-day due
date resolved to the meeting date, EC/Ash ×1); commit created all rows with
context notes + a "From meeting: GTM Team Sync (Aug 17)" provenance line;
unrouted items fall back to To Do + Inbox project (Smart Capture triage
convention). Full browser pass (fill → Extract → review grid → Add → done
panel) also verified. Follow-up 2026-08-18: processing interstitial while
parsing (spinner + explanation + elapsed timer + Cancel via AbortController)
that auto-opens the triage grid; triage subtitle added. Browser-verified:
interstitial renders with live timer, auto-transitions to triage, Cancel
returns to the paste screen with text preserved and no error.
Follow-up 2 (2026-08-18): "Import meeting" sidebar link under Calendar (the
/capture link was the only entry and Eddie couldn't find it), and shared-list
removal — DELETE /api/lists/[id] as a member now deletes only your ListMember
row ("Remove from my lists" in the tile ⋯ menu); owner delete/default guard
unchanged. Verified on scratch PG: leave keeps the list + owner's todos,
repeat leave 404s, owner delete still works; browser pass confirmed the menu
item and tile removal. Known pre-existing wart: the color swatches shown on a
shared tile don't save (PATCH is owner-only) — left as is.
Follow-up 3 (2026-08-18, Eddie approved the schema change): per-member tile
colors — `ListMember.color String?` (additive, pushed to prod Neon
ep-cold-mountain via db push before deploy). Member PATCH /api/lists/[id]
now saves color to their membership row (name/position still 400 for
members); home page + GET /api/lists render the member's color when set,
falling back to the owner's List.color. Verified on scratch PG + browser:
member picks violet, owner stays emerald, name hijack rejected. Model call is `callClaudeJSON` + DEFAULT_MODEL; owner→
list fallback is alias common-prefix ≥ 3 ("David" → EC/Dave). No schema
changes, no new deps. Uncommitted — review then push to deploy.

---

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

# EC — Multi-tenant + File Upload (✅ SHIPPED 2026-05-19)

## Review

Shipped in a single session. Codebase migrated from single-user password gate to public-signup multi-tenant SaaS with file uploads.

**What landed:**
- Auth: magic-link via Resend → 7-day JWT cookie. `signSession`/`verifySession`/`getCurrentUserId`/`requireUserId` in `lib/auth.ts`. Routes: `/api/auth/request-link`, `/verify`, `/logout`. Rate-limited (3/10min per email + IP). Optional anti-abuse: `MAX_SIGNUPS_PER_DAY`, `INVITE_TOKEN`.
- UI: EC-branded landing page at `/` (logged-out), dashboard (logged-in). `/signup` + `/login` magic-link forms with "Check your inbox" state. Settings page at `/settings` (email, storage usage, sign-out). Settings link added to sidebar. Mobile chrome + manifest rebranded.
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


**Product name**: EC. Replaces the working name "Personal OS" on the landing page, in emails, and in the app header. Codebase / repo / Vercel project keep their existing names for now (rename later).

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

- **Name**: EC
- **Email sender**: dedicated Resend sender (need to register a sending domain — recommend `ec@mail.infinitemachine.com` or `hello@…` once a domain is picked; otherwise `onboarding@resend.dev` works as a stopgap)
- **Quick Todo Mac app**: stays hardcoded to founder (Eddie) — the capture endpoint will look up the founder user by env var and attach there
- **Domain**: keep `personal-os-two-gold.vercel.app` for now (rename later)

## Landing page copy (draft — needs sign-off)

> # EC
> *A little better, every day.*
>
> EC holds the whole of your life in one calm, deliberate place — the tasks, the projects, the people you want to stay close to, the trips you're planning, the things you own, the things you've been meaning to read.
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

---

## Shared-list add notifications (2026-06-12)

- [x] `src/lib/notify.ts` — `notifySharedListAdd()`: loads list owner+members, emails all
  participants except the creator; 5-min in-memory burst suppression per
  recipient+list+creator (multi-line paste → one email); never throws.
- [x] `src/lib/email.ts` — `sendSharedListAddEmail()` + EC-styled HTML template
  (subject: `{Creator} added "{title}" to {List}`, links to APP_URL).
- [x] `src/app/api/todos/route.ts` — both create branches (top-level + subtask) call it via
  `after()` (post-response, zero added latency).
- Capture/cron creation paths deliberately not hooked: they file into default lists, which
  can't be shared (members API rejects `isDefault`).
- Verified by dry run with Resend disabled: private list → no attempt; EC/Shane →
  exactly one intended send to the member; repeat add suppressed; creation 200 throughout.
- Follow-up candidates: iPhone PWA web push (needs sw push handler + VAPID +
  PushSubscription table = schema approval), per-user mute setting, digest mode.

---

## Asset editor: suggestion chips + Enter-to-submit (2026-07-02)

- [x] `asset-editor.tsx`: `EditorField.suggestions` → one-tap chips under the input
  (toggle on/off, active = solid foreground); plain Enter now saves from any
  single-line input (was ⌘-Enter only); blank text fields save as null (no more
  "" groups).
- [x] Pages: places/investments/inventory/media/best-practices — status+category
  placeholders ("visited · wishlist · favorite" etc.) converted to `suggestions`.
- Verified: tsc + build green; headless browser (minted dev JWT) — chips fill the
  field, Create lands the row grouped under VISITED w/ RESTAURANT tag + stars;
  test row deleted after.

## Places: staff field + smarter chips (2026-07-02, follow-up)

- [x] `detailsJson`-backed editor fields: `EditorField.detail` flag + `detailStr()` helper;
  POST stores `body.details` (nulls stripped), PATCH merges into existing detailsJson
  (null/"" deletes the key). No schema change — Json column already existed.
- [x] Places: "Staff / who to ask for" field (fills the empty cell next to Rating);
  shown in table Detail cell ("· ask for X"), cards ("Ask for X"), and mobile list.
- [x] Chips now merge values already used in the data (case-insensitive dedupe, cap 12)
  so an existing vocabulary (Paris, art, …) is re-selectable.
- Verified: tsc + build green; API round-trip (create w/ staff, edit, clear) + headless
  browser (field hydrates, chips highlight active values, row shows "ask for Karsah").
  Test row deleted.

## Places: Google Maps enrichment (2026-07-02, follow-up 2)

- [x] `POST /api/assets/enrich-place` — keyless: expands maps.app.goo.gl/goo.gl
  short links (redirect-follow, google-hosts-only SSRF guard, consent.google
  `continue=` unwrap), parses name + coords from the URL (`/maps/place/`,
  `!3d!4d` marker, `@viewport`, dropped-pin `/maps/search/lat,+lng`, `?q=`),
  reverse-geocodes via Nominatim (`accept-language=en`) for neighborhood+city,
  bounded name-search fallback recovers venue type when the coordinate lands
  on the building. OSM type → app category mapping (restaurant/cafe/bar/hotel/
  hike/shop).
- [x] Editor: `autoEnrich="place"` (AssetGrid pass-through, Places only) —
  debounced watch on the Link field; fills ONLY empty title/location/category;
  "Looking up place… / ✓ Filled from Google Maps" status line. Link field moved
  to top of Places form with advertising placeholder.
- Verified: tsc+build green; endpoint tested w/ full URL, viewport URL, 2 real
  short links (venue + dropped pin), hostile host rejected; UI paste→autofill
  seen in headless browser. No Google API key needed.

## Places: search-as-you-type place picker (2026-07-02, follow-up 3)

- [x] `GET /api/assets/search-place?q=` — Nominatim name search (limit 6,
  dedupe, accept-language=en); returns title/subtitle(address)/location/
  category + constructed Google Maps link per hit.
- [x] Shared helpers extracted to `src/lib/place-enrich.ts` (composeLocation,
  mapCategory, UA) — used by both enrich-place and search-place.
- [x] Editor: Places Title field is now a search combobox — 500ms debounce ≥3
  chars, dropdown w/ name + address, ArrowUp/Down + Enter to pick, Esc closes
  dropdown w/o closing modal, mousedown-pick beats blur; picking fills title/
  location/category/url (enrich suppressed for the picked URL); hydrated titles
  don't trigger search on edit-open.
- Verified: tsc+build green; API disambiguates (Lucali Brooklyn vs Glasgow;
  "Uzuki Brooklyn" → Greenpoint restaurant); headless UI: type → dropdown →
  Enter → title/link/category-chip/city all filled, modal stays open.

## Inbox triage mode (2026-07-02, from ideation doc idea #2)

- [x] `src/components/triage-mode.tsx` — TriageLauncher (Triage button on Inbox
  project header + `t` shortcut) → full-screen TriageMode overlay: one capture
  at a time, j/k or arrows nav, p=file-to-project (fuzzy picker), l=move-list,
  d=due date (Today/Tomorrow/Next week/Clear + date input, stays in queue),
  e=complete, #=delete, u=undo, Esc close. Actions auto-advance; optimistic
  queue w/ rollback on failed save; undo stack (patch-revert; delete→recreate,
  attachments/subtasks don't survive recreate). Mobile: swipe l/r nav + wrap
  action row. Overlay uses house data-overlay/useOverlayTransition idiom.
- [x] Guards: e.repeat ignored (held key can't machine-gun the queue);
  busyRef serializes mutations (one in flight, action keys no-op meanwhile).
- [x] `GET /api/todos` now returns `createdAt` + `listId` (was dropped by the
  mapper — "captured Invalid Date" bug + undo needs listId). Additive.
- [x] Mounted in projects/[id]/page.tsx only when project.name === Inbox.
- Verified end-to-end vs SERVER STATE (not just UI): complete/undo/file/date/
  delete+undo-recreate each confirmed by API reads; mobile 390px layout checked.
- ⚠️ Test-harness note: agent-browser `press` floods 10k+ keydowns (repeat=false)
  after first use per daemon — key verification done via JS-dispatched
  KeyboardEvents instead. Not an app bug; real keyboards send repeat=true.

## feat/usage-grounded-v1 branch (2026-07-07) — all five ideation items

- [x] Names route everywhere: `src/lib/alias.ts`; @token pre-parse in
  capture/todo + smart/parse (returns routedByAlias proposal, skips Claude) +
  smart/auto; commit honors listName ONLY for routedByAlias; triage detects
  aliases in titles → `a` one-key filing chip.
- [x] Context strip: GET /api/todos/context?id= (±12h neighbors, done struck
  through) rendered in triage card + "· 41d ago" age.
- [x] Decay v2 (⚠️ SCHEMA: Todo.droppedAt/isReference/snoozedUntil): drop and
  reference also set completedAt (all open filters exclude for free); snooze
  read-filters on /api/todos + home + project TasksTab + print/today; triage
  keys x/r/s + snooze picker; Sweep launcher (stale=1 queue, 14d, oldest
  first) + count badge; age chips (14d+) + resurfaced chip in todo rows.
- [x] 1:1 Agenda (⚠️ SCHEMA: Todo.lastDiscussedAt/discussCount): agenda-mode.tsx
  meeting runner on EC/* list headers — d/e/n/j/k, raised-N× badges,
  new-since-last-1:1 + carryover dividers, quick-add, copy recap
  (clipboard + execCommand fallback). PATCH {discussed:true} increments.
- [x] Usage-diet: /inbox redirect route; mobile tabs → Home/Inbox/Calendar/
  Practices (private host); home attention strip (N to triage · M stale);
  labs searchable in ⌘K.
- [x] KILLED during build: Restaurant-BP→Places merge — dry-run showed those
  entries are principles for running a restaurant, not venues. Script removed.
- Verified end-to-end on scratch Postgres (initdb, db push, seeded): both
  capture endpoints, parse→commit alias path, drop/reference/snooze/undo +
  stale queue + resurface via API; browser: triage card w/ context strip +
  alias chip + a-key filing (server-confirmed), sweep button, home strip,
  age/resurfaced chips, agenda full flow, /inbox redirect, private mobile tabs.
- ⚠️ MERGE REQUIRES: `npm run db:push` against prod (3 nullable columns +
  2 with defaults on Todo — additive, backwards-compatible) BEFORE deploying.

## Teammate Mac capture shortcut (2026-08-13)
- [x] Multi-user capture auth: new `src/lib/capture-auth.ts` resolves bearer
  token → user. CAPTURE_TOKEN → founder (unchanged); new CAPTURE_TOKENS env
  (JSON token→email map) for teammates. Wired into /api/capture/smart/auto
  and /api/capture/todo; per-route founder lookups removed. tsc clean.
- [x] quick-todo/build.sh: QT_TOKEN + QT_APP_DIR overrides to bake a
  teammate's token into a separate .app without editing main.swift.
- [x] Built teammate copy → ~/Desktop/Quick-Todo-teammate.zip (app +
  INSTALL.txt; verified their token baked in, founder token absent).
- [ ] BLOCKED on teammate email: add Vercel env
  CAPTURE_TOKENS={"<token>":"<email>"} (token in scratchpad), redeploy,
  then send the zip.

## ⌘Z undo (2026-08-24)
- [x] `src/lib/undo.ts` — module-singleton undo stack (depth 25, entries go
  stale after 15 min). Not a context: every todo row/tile only writes to it,
  so a context would re-render the whole board on each push.
- [x] `src/components/undo-host.tsx` — mounted in layout. ⌘Z / ⌃Z runs the
  newest entry; bottom pill shows "<action> · Undo ⌘Z" for 5s (the Undo
  button is the phone path, which has no ⌘Z) and "Undone · …" after. ⌘Z
  inside an input/textarea/contentEditable is left to the field's native undo.
- [x] `POST /api/todos/restore` — undo for deletes. Re-creates the row with
  its ORIGINAL id plus its subtasks; no shared-list email (unlike POST
  /api/todos). Attachments/comments are gone with the cascade; the task isn't.
- [x] Registered inverses: complete/reopen (tile + project card + subtasks),
  delete, move between lists, file/unfile project, due date, rename.
  Each entry's `run` also unwinds that component's optimistic state — a row
  restored on the server but still in `hiddenIds` would come back invisible.
- [x] keyboard-nav's `u` now runs the same stack (its bespoke one-slot
  LastAction ref is gone), so ⌘Z and `u` agree.
- Verified on scratch Postgres + browser (localhost:3717, seeded): complete →
  ⌘Z (list tile AND project card), delete → ⌘Z restores row + subtask with
  original ids, cross-list move → ⌘Z returns it to the source tile visibly,
  rename → ⌘Z, `u` key, pill Undo button, ⌘Z inside the New Reminder input
  leaves the stack alone, "Nothing to undo" on an empty stack. DB state
  confirmed by psql after each. No console errors. Build + tsc clean.
- Not covered (deliberate): list/project deletion (confirm-gated), attachment
  and comment deletes (blob/cascade, not restorable), capture commits, reader.

## Google Calendar due-date sync (2026-09-08)
Eddie: "when I assign a date, add it to my calendar." Target: Google Calendar via
the existing founder OAuth token; completed/dropped todos stay on the calendar with
a ✓/✗ prefix (his call). No schema change — event ids are derived from todo ids.
- [x] `src/lib/google.ts`: export `getGoogleAccessToken` / `isGoogleConfigured`
- [x] `src/lib/gcal.ts`: syncTodoEvent / deleteTodoEvent / syncRecentTodos / reconcileCalendar
- [x] `after(() => syncRecentTodos())` on every todo write route; DELETE removes the event
- [x] `/api/cron/calendar-sync` daily reconcile + orphan sweep (vercel.json)
- [x] mint script scope += calendar.events; `.env.example` GOOGLE_CALENDAR_ID
- [x] `pnpm typecheck` clean
- [ ] Build + end-to-end verification against a real calendar
- [x] Operator steps done by Claude (2026-09-08): Calendar API enabled on the
      kaizen-gmail Cloud project; token re-minted with gmail.readonly + calendar
      (full scope, so the app can create its own calendar) for
      eddie@infinitemachine.com via Chrome consent; GOOGLE_REFRESH_TOKEN replaced
      in .env and Vercel prod (printf, byte-length verified); app auto-created the
      "EC" calendar; local backfill upserted 16 dated todos, verified via the
      Google Calendar connector.
- Review: `syncRecentTodos` only upserts *dated* todos (a reorder bumps
  updatedAt on every row; issuing a Google DELETE per undated row would be
  dozens of wasted calls). Clearing a date → PATCH route calls
  `deleteTodoEvent` explicitly; the daily sweep also removes events whose todo
  is gone or undated. Todos go to a dedicated auto-created "EC" calendar (GOOGLE_CALENDAR_ID overrides). Event id prefix is `ka` (Google ids are base32hex:
  `[a-v0-9]`, so my planned `kz` was invalid — Sol caught it).


## Read Later share-sheet saves never landed (2026-09-08)
Eddie: desktop Read later page empty despite "using it for a while on my phone".
- Root cause: the "Read Later" Shortcut's Get-contents-of-URL action is a GET
  (Method field is hidden under Show More and was never set to POST). Middleware
  only passed POST through, so every share 307'd to /login and the Shortcut
  still showed "Saved to Read Later". DB had 0 reader items for any user, ever.
- [x] Fix server-side so no Shortcut edit is needed: middleware passes
  `/api/reader` through when the request carries `?url=`; route's GET with
  `?url=` runs the same save path as POST (shared `saveFromRequest`).
- Test items created during diagnosis: Wikipedia "Kaizen" (POST test) and
  theverge.com (Shortcut run from the Mac). Archive/delete at will.
- Follow-up (same day): with GET fixed, the phone's request still arrived with
  `url=` EMPTY (Vercel log: POST, token OK, BackgroundShortcutRunner). The
  Shortcut's "URL Encode" action has no input wired, so it encodes nothing.
  Built a replacement from a plist ("Save to Read Later": Get URLs → POST form
  {url, text} → notification shows the server response), signed with
  `shortcuts sign --mode anyone`, imported on the Mac (syncs via iCloud).
  Verified: Mac run saved nytimes probe; a phone share (WSJ) saved at 22:45Z.
  Left for Eddie: delete the old "Read Later" and the stray "Read Later signed"
  (GUI-only; tiles are unlabeled AXGroups, and his terminal was in front).
  Shortcut source: scratchpad only (contains CAPTURE_TOKEN) — not committed.

## Contacts → Friends link + iMessage stats (2026-09-09)
Eddie: "first link my contacts to my friends database. then do imessage sync but i just
want stats." Decisions: stats bump `Person.lastInteractionAt` + report file (no schema
change); nightly launchd on the Mac. WhatsApp out of scope (no personal API).
Baseline: 502 people, 1 phone, 77 emails, 86 with any last-seen. Contacts: 6,788 cards.
Dry-run tiers: exact 197 / contains 40 / nickname 5 / unique-first 2 → 244 matched.
- [x] `scripts/link-contacts.ts` — JXA export → tiered match → fill null phone/email →
      `~/Library/Application Support/personal-os/contact-handles.json` + link-report
- [x] `scripts/imessage-stats.ts` (written; live run blocked on FDA) — chat.db copy, metadata-only SQL, per-person stats,
      bump-forward last-seen, report JSON + console tables, `--install-launchd`
- [ ] BLOCKED on Eddie: Full Disk Access for /Applications/Knife Terminal.app
- [x] Link ran for real 2026-09-09: 245 matched (exact 197 / contains 40 / nickname 6 /
      unique-first 2), phones 1→229, emails 77→207; second run is a no-op. Handles map
      + link-report written to ~/Library/Application Support/personal-os/.
- [ ] Run stats once FDA granted; install launchd
- Review: Cursor relay returned nothing (three attempts, exit 0, no files) → Codex
  fallback wrote both scripts. Fixed in review: JXA must use the `app.people`
  specifier (not `app.people()`) for bulk property reads; tier counters were
  double-counting; unique-first-name tier now only for single-token names;
  dry-run now reports would-set counts; empty sqlite3 -json output guard.

## Inventory: natural-language add (2026-09-09)
Eddie: "allow me to add an item to inventory with natural language" (the New entry modal
has 11 fields). Reuses `parseCapture` with a new `forceType: "inventory"`.
- [x] `smart-capture.ts`: forceType "inventory" + categoryHints addendum
- [x] parse route: accept forceType=inventory, pass the user's existing categories,
      coerce/422 non-asset results
- [x] `asset-editor.tsx`: "Describe it" textarea + Fill (⌘↩) in create mode, fill-empty-only
- [x] grid + inventory page pass `smartFill="inventory"`
- [x] `pnpm typecheck` clean
- [ ] Build + API/browser verification

Review: Inventory create mode now sends descriptions through the authenticated smart-capture
route, reuses the user's category vocabulary, and prefills only blank fields. Existing typed
notes are preserved while unique inventory details are appended. No schema or script changes.

## Inventory: receipts/files + owned-only filter + spreadsheet editing (2026-09-10)
Eddie: "allow me to add receipts or files to this" (New entry modal); then "i just want
items that i own… filter out stolen or lost… edit the spreadsheet like airtable… bulk
delete and edit."
Part 1 — files (SCHEMA CHANGE, approved in plan: `Attachment.assetId` + index,
`Asset.attachments`; additive, `pnpm db:push` before deploying code):
- [x] schema + prisma generate; attachments list/upload routes accept assetId; asset
      DELETE removes blobs (`src/lib/asset-delete.ts`)
- [x] `attachment-list.tsx` (extracted from todo modal); editor Files section — edit mode
      uploads now, create mode queues and uploads after Create
- [x] paperclip count on rows (inventory query `_count`)
- [x] db:push run 2026-09-10 (Eddie said "do it for me"); `Attachment.assetId` +
      `Attachment_assetId_createdAt_idx` confirmed present in Neon.
- [x] Browser-verified on localhost:3717 against the live DB: upload a PDF to Tag Heuer
      Calculator → row shows 📎 1 live, blob + row in DB → delete → row and count gone.
      Todo/project attachments untouched (3 todo rows still present).
- INCIDENT: the Codex agent ran `git checkout` on Eddie's two uncommitted list-sharing
  files (21 + 38 lines, present since ≤ Aug 26). Not recoverable: no stash, no editor
  history, no printed diff in any transcript, no usable APFS snapshot. Lesson recorded.
Part 2 — table (done 2026-09-10):
- [x] status filter chips, default owned+loaned+stored+broken, persisted in the existing
      localStorage prefs; header shows "N of M shown" and totals follow the filter
- [x] inline cell edits on 8 columns (PATCH one field, optimistic, Tab/Enter/Esc/arrows);
      row click no longer opens the modal in spreadsheet mode — an Open icon does
- [x] multi-select + sticky bulk bar; `POST /api/assets/bulk` update|delete (reuses
      `deleteAssetWithBlobs`, 200-id cap, chunked client-side)
- [x] other asset pages unchanged (gated by `spreadsheet` prop) — Investments verified
- [x] TableView/EditableCell/BulkBar extracted to `src/components/asset-table.tsx`
- Verified live: inline edit of "Where" wrote + cleared (null) in DB; "lost" chip revealed
  the Ikepod Seaslug and totals moved 63→64 of 74; bulk status→stored on 2 scratch rows
  moved them out of the filter; bulk delete removed both (count back to 74).
- Polish pass (2026-09-10, after Eddie: "this interaction is weird" + "make inventory
  match the investments page"): the spreadsheet table had drifted from the house style.
  Fixed — (a) edit input no longer widens the column (an <input> carries a ~20ch intrinsic
  width; `size={1} min-w-0` and dropping `min-w-24` pins it to the cell), numbers are
  right-aligned with native spinners suppressed; (b) category renders as the uppercase chip
  again; (c) Expected Return is emerald/rose; (d) cost muted, value medium; (e) where /
  status / category no longer wrap, so rows are one line like Investments.
- Checkbox column removed on sight (2026-09-10, Eddie: "i think get rid of checkbox
  column" — he likes the Investments layout). Selection is kept but hidden: the box
  fades in on row hover, and once anything is selected every box shows so a selection
  can be extended. Column is w-8 so nothing shifts. Linear/Airtable pattern.
- INCIDENT 2: the Part-2 agent overwrote tasks/todo.md with its own scratch plan (776
  lines → 58). Restored from HEAD. Same root cause family as INCIDENT 1 — see lessons.

Review: `pnpm typecheck` and `git diff --check` passed. Mocked DOM checks covered filtering/preferences, keyboard commits/cancel/navigation, regrouping focus, decimal/date values, rollback/retry, selection, bulk update and delete confirmation. Static rendered HTML matched the original AssetGrid for four non-spreadsheet kinds. Bulk API mocked validation/auth/scope/sequential-delete checks passed. No live browser or database writes were performed.

## Send to Kindle for Read Later (2026-09-15)
Plan: ~/.claude/plans/fizzy-hugging-dawn.md. Branch `feat/kindle` (worktree ~/Code/.worktrees/personal-os-kindle).
Decisions (Eddie): each saved article emailed to Kindle right away; capture = Chrome extension, iOS share sheet (existing Shortcut), forwarded newsletters.
- [x] P1 pipeline: `src/lib/safe-fetch.ts`, `src/lib/kindle-epub.ts`, `src/lib/kindle.ts`, vitest, `scripts/kindle-send.ts` (dc6c8fc)
- [x] P1 verify: 65 tests green, epubcheck 0/0/0 on Colossus (15k words, 7 imgs, 2.3 MB), build ok; real send Resend id 1e60d2b4… → Eddie's 2nd Kindle (confirm on device)
- [x] P2 schema (APPROVED, additive; a153796): Eddie ran prod db push 2026-09-15 (direct host); re-diff prod vs branch = empty
- [x] P2 auto-send in /api/reader via after(), `html` input, POST /api/reader/[id]/kindle, daily cap (39fb2a2 → fixed 8e8ea6d: claim guard `NOT` on NULL kindleError had blocked every send). Verified: typecheck, 90 unit tests, build, scratch-DB e2e 38/38
- [x] P2 UI: article top-bar Kindle button ("Emailed to Kindle"), list marker, Settings → Reading (EC CSS vars) — pixel check in Chrome pending
- [~] P2 preview deploy DROPPED: copying prod secrets to branch-scoped preview env is blocked (secret-store write); verify on prod right after merge instead
- [x] P3 Chrome extension "Save to Read Later" (rendered HTML, URL fallback) v0.2.0 (05974ef; ⌘⇧U, context menus, popup button)
- [x] P4 shipped 2026-09-15 (main e15e5b6, prod v0.203): Kindle email set in Settings on internal host; prod bearer save of Colossus → kindleSentAt in ~6s, Resend delivered, Amazon Docs lists the readable title. Follow-ups: Eddie reloads the unpacked extension; first real iPhone share
- [ ] P5 newsletters: /api/reader/inbound (Svix, address + sender allowlist, dedupe) on Eddie's personal Resend account
- [x] Amazon (Eddie's PERSONAL account — Chrome defaults to the IM business account, which has no Kindle): hello@infinitemachine.com approved 2026-09-15; target = "Eddie's 2nd Kindle"
- Needs from Eddie: prod db push; reload unpacked extension after merge; personal Resend account for newsletters (P5)

## Workout page — photo → AI plan → guided session (2026-09-20)
Eddie: "on my ios pwa, a workout page that lets me upload photos of my equipment and
recommend a workout. timer, reps, visualizations of the exercises, etc." Built in Fable.
- [x] `src/lib/image-compress.ts` — `compressImage` extracted from smart-capture-form (shared)
- [x] `src/lib/claude.ts` — messages accept text + base64 image content blocks (vision)
- [x] `src/lib/workout.ts` — plan types, 15 movement patterns, 14 muscles, prompt, normalizer, `flattenPlan` (supersets/circuits interleave), vitest
- [x] `POST /api/workout/plan` — ≤6 photos + minutes/focus/intensity/notes/saved equipment → `{ equipment, plan }`; nothing stored server-side
- [x] `POST /api/workout/log` — finished session → FitnessSession (kind "lift", source "manual") on the user's Human, if any; data-only
- [x] `/workout` + `WorkoutStudio`: Setup (camera/library photos, saved-equipment chips, 15–60 min, focus, intensity, notes, resume banner, recent list) → Plan review (equipment spotted, warm-up / blocks / cool-down, tap a row for cues + muscle map) → Player (set x of y, rep stepper + load, timed holds with ring, auto rest countdown with +15s/pause/skip, prev/skip, wall-clock timers that survive backgrounding, wake lock, beeps + haptics) → Summary (minutes/sets/reps, per-exercise log, Log to Personal, New workout)
- [x] `ExerciseFigure` — side-view kinematic stick figure; poses sampled into native SVG `<animate>` (no per-frame JS); prop (dumbbell/bar) inferred from equipment text. `MuscleMap` — front/back silhouettes with tinted regions
- [x] localStorage: in-progress session, equipment profile (merged from each plan), prefs, last 30 sessions
- [x] Sidebar template "Workout" (Dumbbell) + command palette entry
- [x] Verified: `tsc` clean; vitest 97/98 (the 1 failure is `kindle-epub > passes epubcheck` hitting the 5 s default — passes alone with `--testTimeout=30000`, Java startup, unrelated); API e2e with a real kettlebell photo (Claude read the colour-coded weights, 17–28 s); browser run at 390×844 in dark + light: setup with photo, resume banner, player, 40 s hold ring, rep log (persisted), rest screen, summary, "Logged to Personal" → prod FitnessSession row created and then deleted (id cmua6ysya…)
- Not verified in a browser: the SMIL figure (headless screenshots wedged agent-browser; covered by an SSR markup test instead — same geometry as the rAF version that was screenshotted) and the plan-review page after a real upload (API verified by curl; component shares rows with the player)
- [x] Shipped 2026-09-20: main 9803d52 + 57017d1 (reduced-motion) live on internal.eddiecohen.com — /workout 200, prod plan call with the kettlebell photo 200 in 22 s (3 warm-up, 4-exercise circuit, 3 cool-down)
- Follow-ups: real iPhone pass (wake lock, camera capture, haptics); persist plans/sessions server-side if history should sync across devices (schema change → flag first)

## Board: import from Cosmos (2026-09-29)
Eddie: "can you import my board from cosmos?" — his cosmos.so profile (@ec): 648 public elements + private collections, 1,250 elements across 46 collections.
- [x] Export: Cosmos has no export and blocks GraphQL introspection, so the data was pulled from a logged-in Chrome tab by replaying the site's own `GetClusterElements` query per collection (pageSize 100) plus a minimal `userClusters` query; handed to disk via the clipboard (a POST to localhost hangs on Chrome's local-network permission prompt). Export JSON lives in the session scratchpad, not the repo.
- [x] `src/lib/cosmos-import.ts` (pure mapping + tests): one board row per Cosmos element; image re-hosted from cdn.cosmos.so (video → poster frame, animation → the animated image); `url` = source page, or the Cosmos share page for uploads; title = Cosmos's caption (its `<n>` markup stripped) or the page title; kind = image unless the source is playable (YouTube/Instagram reel → video, Spotify → music) or a saved web page (link); collection names → `tags` ("Unsorted Elements" dropped); `savedAt` = Cosmos createdAt; `via: "cosmos"`
- [x] `scripts/import-cosmos.ts`: `--dry-run`, `--concurrency`, `--undo` (deletes via=cosmos rows + their blobs); manifest `<export>.imported.json` makes re-runs skip what landed; unrendered links (7) go through `saveToBoard` so they get metadata/oEmbed
- [x] Verified: 11 unit tests, tsc clean, dry run 1,243 images + 7 links / 0 skipped; 10-item sample imported to prod DB and checked row by row (blob URLs, sizes, dominant color, tags, dates)
- [x] Full import run on prod DB 2026-09-29: 1,234 images + 6 links, 0 failed, 1 image left pointing at cdn.cosmos.so (re-host failed); ~3 min at concurrency 6. Board went 3 → 1,253 items
- [x] Unfiled items (20 only in "Unsorted Elements") got Claude tags on first board load; it reused the Cosmos names (walden, product, Ads…)
- [x] Board cap raised 1000 → 3000 (`app/board/page.tsx`, `api/board/route.ts`): the grid showed "All 1000" and hid the oldest 253
- [x] Verified in the browser (local dev server on the prod DB): "All 1253", 45 collection chips with counts, tiles render with re-hosted images, hover shows caption + host, lightbox shows tag + "Saved <date> · via cosmos"; 629 unit tests pass, tsc clean (only stale `.next/types` noise)
- Note: one tile per Cosmos element — carousel posts (60 elements with 2–18 images) keep only the cover image, like Cosmos shows them. `pnpm lint` (`next lint`) is broken on this Next version; pre-existing

## Board: mood board of things you like (2026-09-26)
Eddie: "send anything I come across that I like (video, song, product) ... a mood board page like cosmos". Easy sending first; recommendations later.
- [x] `BoardItem` model (additive; needs prod `pnpm db:push` before merge)
- [x] `POST /api/board`: session or capture token; forgiving input (JSON / form / multipart / raw image / text / query); byte-sniffs images; HEIC via heic-convert
- [x] Link resolution: oEmbed (YouTube, Vimeo, Spotify, SoundCloud, TikTok) then og/JSON-LD (title, image, price); kind = image/video/music/product/link/note; images re-hosted to Blob as WebP with size + dominant color; re-sharing a URL bumps it to the top
- [x] `/board`: masonry grid, filter chips, search, paste anywhere, drag and drop, lightbox with inline YouTube/Vimeo/Spotify/Apple Music player, notes, delete; refreshes on focus
- [x] Sending: iOS Shortcut (3 actions, steps in "Ways to send"), Chrome extension v0.3.0 (image/page context menus, ⌘⇧Y, popup button), PWA share_target (Android/desktop)
- [x] Middleware: drop client-supplied `x-user-id` (bearer passthrough routes could be spoofed)
- [x] Verified locally: 128 unit tests, typecheck, prod build, scratch-DB e2e (YouTube, Spotify, Vimeo, product w/ price, direct image, HEIC, notes, dedupe, share target, PATCH/DELETE, auth), browser screenshots light/dark/mobile
- [ ] Eddie: prod db push; build the Shortcut; reload the extension
- [x] Recommendations ("For you" tab on /board):
  - `BoardTaste` (profile + run state) and `BoardRec` models (additive)
  - `lib/board-recs.ts`: board (150 newest) + saved/dismissed/shown picks → Claude with `web_search_20260209` → taste profile + 12 picks with real URLs; `lib/claude.ts` gained `callClaudeWithServerTools` (resumes `pause_turn`)
  - Each pick's link resolved like a board save (image, site, price); 404/unreachable links swap to a search link, bot-blocked (403) keep the real link; items already on the board are dropped
  - `POST /api/board/recs` claims a run (stale after 6 min) and generates in `after()`; UI polls GET; errors keep the previous picks
  - Save copies a pick onto the board (`via: "rec"`) and counts as a like; ✕ dismisses and steers the next run away
  - Weekly cron `/api/cron/board-recs` (Sat 15:00 UTC): up to 4 users with ≥5 items and picks older than 6 days, then a push "N new picks for you" deep-linking to `/board?view=for-you`
  - Verified: 135 unit tests (prompt, reply parsing incl. citation-split text, pause_turn resume, API errors), typecheck, prod build; scratch-DB run of the real pipeline with only the Anthropic call faked (YouTube/Spotify art resolved, dead link → search, on-board item filtered); route flow start/poll/error/cron/auth; browser screenshots desktop light + mobile dark, save + dismiss
  - NOT verified: a live Claude call (no API key in the build env). First real run on prod is the test
- [x] Shipped 2026-09-26: PR #4 merged (main 1d1bd31); prod deploy confirmed (manifest share_target live, board routes gated, bearer save 401 without token, spoofed x-user-id 401). Waiting on Eddie: prod `pnpm db:push`
- [x] Follow-up PR: "More like this" (lightbox → 8 picks centered on one item, added on top of current picks, taste profile untouched) + fixes from an independent review:
  - recs can't get stuck "generating": 220 s deadline on the Claude turn, GET reports runs older than 320 s as failed, errors shown are friendly (internal messages hidden)
  - weekly cron fans out one request per user (each its own 300 s function)
  - reply parsing: only text after the last search, pretty-printed JSON, refusal / max_tokens handled
  - board grid re-observes width after For you → Board (was stuck at 2 columns); dragging a tile no longer saves a copy; focus + visibility refresh deduped; failed delete restores without dropping new saves; paste/drop on For you jumps to Board
  - uploads capped at 4.4 MB (Vercel body limit) with a client-side message; delete only removes blobs under the user's own `users/<id>/board/`
  - share target redirect only carries user-facing error text
  - search-fallback picks save as a clean card (name + search link), not a note with a raw URL
  - safeFetch: DNS-rebinding fix, addresses re-checked in the socket's own lookup (undici Agent); verified a rebinding host is refused against a live localhost port. Also covers Read Later / Kindle fetches

## Dating: people I'm seeing (2026-09-26)
Ask: a page that pulls in messages, holds notes on each person, plots the relationship, and helps learn from each one.
- [x] `DatingPerson`, `DatingEvent`, `DatingMessage` models (additive; needs prod `pnpm db:push` before merge)
- [x] `/dating`: Now / Past cards (stage, 12-week message sparkline, last text, dates, avg vibe, top things to remember), Lessons roll-up, "Find patterns" (Claude across everyone's notes, lessons, flags, timelines)
- [x] `/dating/[id]`: Overview (stats: volume, who starts conversations, median reply time each way, dates + avg vibe; messages-per-week chart stacked you/them over a vibe-over-time chart on the same time axis; Remember / Green flags / Red flags lists; "Claude's read" with one-click add of suggested facts, flags and lessons), Timeline (dates, milestones, calls, conflicts, rated 1-10), Messages (thread, search, load older, paste import), Notes (notes, what this taught me, details incl. phone/email for sync, delete)
- [x] Messages in: `scripts/dating-messages-sync.ts` on the Mac reads only 1:1 iMessage threads for handles added on /dating (decodes `attributedBody` for text-less rows, skips tapbacks and group chats), POSTs to `/api/capture/dating` (CAPTURE_TOKEN), deduped by guid; `--install-launchd` runs it every 30 min. Paste import handles WhatsApp exports (iOS + Android) and "Name: text" lines, deduped by hash
- [x] Sidebar template is `privateOnly` (shows on the private host); `/dating` itself works on any host for the signed-in user
- [x] Verified: 17 new unit tests (handles, transcript parsing, stats, weekly buckets, attributedBody), typecheck, scratch-DB e2e (create, events, capture ingest + dedupe, paste, search, patch, cross-user 404s), sync script against a fake chat.db (tapback, group and other threads skipped; attributedBody decoded; re-run adds 0), browser screenshots light/dark/mobile with no console errors
- [ ] Eddie: prod db push; add `APP_URL` + `CAPTURE_TOKEN` to the Mac repo `.env`, Full Disk Access for the terminal, run the sync once then `--install-launchd`
- NOT verified: a live Claude call for "Claude's read" / "Find patterns" (no API key in the build env)

## Dating: dictation + Granola filing (2026-09-26)
Ask: talk (or type) about how it's going and have Claude file it on the right person; file Granola meeting notes the same way.
- [x] ⚠️ SCHEMA (approved): `DatingEvent.source` ("dictation" | "granola" | null), `DatingEvent.externalId` + `@@unique([userId, externalId])`. Additive, nullable. Filed notes are `kind: "note"` events
- [x] `src/lib/dating.ts` filing helpers (pure): `parseProposal` (validates Claude's or the client's proposal; unknown ids → new person or snap to exact name; forced personId; merges duplicates; strips items already on the person; `strict` mode for client round-trips drops foreign ids), `freshItems` / `appendLessons` dedupe, `dateContext` (note day + last 7 days with weekdays so Claude maps "last night"/"Saturday"), `resolveEventDay`, `granolaExternalId`, `withSourceLine` / `splitSourceLine` (Granola label + URL live on the note's last line, no extra columns)
- [x] `src/lib/dating-filer.ts`: `fileDatingNote` (Claude, default model, roster with lists + recent timeline so it doesn't re-log events) and `applyProposedPerson` (one transaction per person: note, events, deduped lists, lessons, stage; creates people only when isNew; skips an already-used externalId, P2002-safe)
- [x] `POST /api/dating/dictate` (proposal, no writes) + `POST /api/dating/dictate/apply` (session auth, userId-scoped, foreign person ids 404/dropped)
- [x] `POST /api/capture/dating/notes` (CAPTURE_TOKEN via resolveCaptureUser, ≤20 items, text capped at 40k): auto-files matched people as `granola:<meeting>:<person>`, meetings already filed are skipped before any Claude call
- [x] UI: Dictate card on `/dating` (multi-person, can add new people) and on the person Overview (everything to her). Web Speech mic (continuous + interim), hidden with a "Tap the mic on your keyboard" hint when unsupported. Review lists every change ticked, editable note, Save / Cancel. Timeline shows "dictated" / "from Granola · <meeting>" (links to the Granola note)
- [x] Verified: 11 new unit tests (169 total pass), typecheck, prod build. Scratch-PG e2e with the REAL Claude API: multi-person dictate (matched "Anna" → Ana Reyes, ignored the work call, new person Jess, "last night"/"Thursday"/"Tuesday" resolved correctly), apply with an unticked item, forged/foreign person ids (404 / dropped), unauth → login redirect, list dedupe on re-apply, stage change to ended + lessons append; capture 401 without/with wrong bearer, matched person filed, work meeting ignored, re-POST → skipped, other user's "Zoe" not matched (returned as a suggestion). Browser: person page review → untick → Save (light, desktop), `/dating` multi-person review + save creating a new person (dark, 390px), Granola badge links, no console errors
- [x] ⚠️ SCHEMA (approved, option a): `DatingSuggestion` (userId, name, meetingId, title, url, occurredAt, summary, note, status pending|added|dismissed, personId, `@@unique([userId, meetingId, name])`, `@@index([userId, status])`). Additive
- [x] Capture stores unmatched people as pending suggestions (insert-only `createMany skipDuplicates`, so added/dismissed rows are never brought back) and skips a meeting before the Claude call when it has any filed event OR any suggestion row
- [x] `/dating` "New from Granola" (name, summary, date, link to the Granola note) with Add her / Dismiss. `POST /api/dating/suggestions/[id]/add` creates the person (talking) and files the note of every pending suggestion with the same name (case-insensitive) as `granola:<meeting>:<person>` note events with the source line; `/dismiss` sets dismissed. Session auth, userId-scoped, 404 for someone else's or a non-pending suggestion
- [x] Review Save/Cancel are left-aligned on phones so the floating + button can't cover Save
- [x] Verified (round 2): 2 more unit tests (171 total), typecheck, prod build. Scratch-PG e2e with the real Claude API: 3 meetings produced a note filed to Ana plus 3 suggestions (Priya ×2 meetings, Lena); re-POST → skipped 3 in 9 ms (no Claude call); cross-user add/dismiss → 404, unauth → login redirect, adding a dismissed one → 404; Dismiss Lena and Add Priya in the browser → one new person with both meeting notes (right dates, keys, badges), both rows added; re-POST after that brings nothing back. Browser: section in light desktop and dark 390px, Priya timeline, review Save at x=103-157 on 390px (the + button is at the right edge), no console errors
- NOT verified: the unsupported-mic hint (tested browser has webkitSpeechRecognition), real voice input, iOS Safari, a real Granola payload (no sender wired up yet), `pnpm lint` (`next lint` no longer exists in Next 16 and the repo has no eslint.config — broken before this change)
- [ ] Eddie: prod `pnpm db:push` (2 nullable columns + 1 unique index on DatingEvent, new DatingSuggestion table) BEFORE deploying; point the Granola routine at `POST /api/capture/dating/notes` with `Authorization: Bearer $CAPTURE_TOKEN`

## Dating: Granola API sync (2026-09-26)
Ask: pull Granola meetings straight from the Granola public API (no sender needed) and file the dating-related ones.
- [x] `src/lib/granola.ts`: typed read-only client for `GET /v1/notes` (`created_after`, `page_size=30`, `cursor`/`hasMore`) and `GET /v1/notes/{id}` (`include=transcript`; on 413 TRANSCRIPT_TOO_LARGE it pages `GET /v1/notes/{id}/transcript`). Requests spaced 220 ms (5 req/s), 429 retried twice (honours Retry-After), clear 401/403/429 errors. `GRANOLA_API_URL` override for tests
- [x] Selection (pure): title "Therapy"/"Block" → candidate; else title/summary/my private notes mention (whole word, any case) a person on /dating (full or first name) or a dating word. Note text = my notes + summary + transcript, capped to NOTE_BUDGET with notes/summary kept first
- [x] Capture route loop moved into `fileGranolaMeeting` (dating-filer.ts); endpoint behaviour unchanged. Shared `granolaMeetingsDone` skip check (any filed event or suggestion row)
- [x] `syncGranola(userId, { since, limit })` (src/lib/dating-granola.ts): oldest-first, skips handled meetings before any detail fetch or Claude call, title hits fetch the transcript directly, others are screened on summary/notes first; at most `limit` Claude calls and ~200 s per batch; returns `{ processed, filed, suggestions, skipped, remaining, meetings, errors, nextSince }`
- [x] Meetings Claude reads and finds nothing in get a dismissed `(nothing to file)` DatingSuggestion marker (data only, never shown) so the daily run doesn't pay for them again. Sync path only; the capture endpoint doesn't write it
- [x] Optional `GRANOLA_OWNER_EMAIL`: when set, notes owned by anyone else are skipped (the API exposes `owner.email`). Unset = every note the key can see
- [x] Cron `/api/cron/dating-granola` daily `0 12 * * *` (CRON_SECRET via isAuthorizedCron, founder via FOUNDER_EMAIL, last 10 days, limit 6; logs a no-op when GRANOLA_API_KEY is unset)
- [x] `POST /api/dating/granola/sync { since? }` (session, founder only → 403 otherwise, 503 when key unset). /dating "Granola" card (founder only): Sync now (10 days) and Import since… (date, default 2026-01-01) looping batches with "N of M checked · X filed · Y new", Stop, then refresh
- [x] Verified: 18 new unit tests (198 total), typecheck, prod build. Scratch-PG e2e against a mock Granola server + faked Claude (fetch preload): cron without/with wrong secret → 401; sync → 403 for a non-founder, unauth → login redirect (middleware), bad since → 400; cron run filed the therapy note to Ana (note + date event, stage, remember), made a Priya suggestion, marked the empty Block meeting, screened out GTM; second run → 0 Claude calls and no transcript fetches; import since 2026-01-01 paged the list (2 pages), 46 notes over 2 batches resuming from nextSince, 6 filed; capture endpoint regression (skip known, file new, validation error, no marker). Key unset → cron `{skipped}` + log, sync 503. Browser (Playwright/Chrome): Import + Sync now on /dating light desktop and dark 390px, no console errors, no horizontal scroll
- NOT verified: the real Granola API (no key locally; field names are from the docs' OpenAPI), a real Claude call, iOS Safari. Unauthenticated sync gets the middleware's login redirect, not a JSON 401 (same as every session route)
- Note: meeting ids from the API are `not_…`; if a Granola routine ever posts to `/api/capture/dating/notes` with different ids, the two paths won't dedupe against each other
- [ ] Eddie: after deploy, click "Import since…" → 2026-01-01 on /dating. If Granola's account email differs and shared notes get filed, set `GRANOLA_OWNER_EMAIL`

## Notes: focus mode + HIG polish (2026-09-26)
Ask: hide the side drawers so only the notepad shows, and redesign the project Notes pane per Apple's HIG (sidebars, split views, layout, typography, color, dark mode, toolbars, accessibility).
- [x] Focus mode: toolbar button (sidebar icon, "Hide sidebars" / "Show sidebars", aria-pressed) + ⌘\ / Ctrl+\ (free: ⌘K, ⌘⇧K, ⌘1-9, ⌘N, ⌘Z, ⌘C are taken; ⌘⇧F is fullscreen in some browsers). Esc exits unless an overlay owns it. Hides the app sidebar (slides shut), the notes list (grid column collapses), the project header + tabs, the mobile top bar, and the FABs; editor centers at a 65ch measure. Preference in localStorage `personalos:notes-focus` (try/catch), restored on load without animating. 300 ms spring transition, off under prefers-reduced-motion
- [x] Mechanism: `html[data-notes-focus]`, set only by NotesPane and removed on unmount; CSS in globals.css targets `[data-app-sidebar]`, `[data-app-main]`, `[data-focus-hide]`. No context/store; other pages never see the attribute
- [x] Notes pane redesign: one split-view card (list | 1px separator | editor) filling the viewport on desktop; list → editor navigation stack below 1024px with a "‹ Notes" back button. List: Today / Yesterday / Previous 7 Days / Previous 30 Days / month / year groups, title + date + first-line preview ("No additional text"), neutral selected fill (no recolor, per lessons), hairlines hidden next to the selection, ↑/↓ to move. Editor: timestamp, 28px bold title (Return → body), 17px / 1.6 sans body (was mono) that auto-grows, quiet "Saving…" → "Saved" (fades) → nothing, "Couldn't save · Retry" on failure. Inline delete confirm (Cancel focused, Esc cancels) instead of window.confirm; deleting selects the next note. New notes start blank ("New Note" placeholder) with the title focused. Empty state with a "New Note" button
- [x] Behaviour fix: switching notes or leaving within the 600 ms debounce used to drop the last edit (cleanup cleared the timer); now flushed with keepalive on unmount/pagehide. No PATCH unless the text changed
- [x] Pure helpers + 8 unit tests: `src/lib/notes-ui.ts` (recency groups, row dates, preview, shortcut matcher)
- [x] Verified: typecheck, 206 unit tests, prod build. Browser (Playwright + Chrome for Testing, scratch PG on :5519, seeded): 69/69 checks: button/⌘\/Ctrl+\ (also inside the textarea)/Esc toggles, reload persistence, sidebar width 0 ↔ 256, header/tabs/list hidden, editor centered, autosave + flush-on-switch persisted (API read back), ↑/↓ list nav, inline delete (no dialog, Esc cancels without leaving focus), create → title focused → Return → body saved, Home and Tasks tab untouched with the preference on, empty state, dark mode, reduced motion (transition 0), 390px light/dark: list-first stack, 44px hit targets, top bar hidden in focus, no horizontal scroll, no console errors
- NOT verified: real iOS Safari / an actual phone; Firefox/Safari desktop (grid-template-columns transitions are supported there but untested). Known pre-existing: the global `@media (hover:none) *:hover { background-color: revert }` gives tapped buttons the UA gray until the next tap (visible on the focus toggle in touch emulation); left alone as it's app-wide

## Dating: Instagram links (2026-09-26)
Ask: an Instagram link on each person, editable, fillable from dictation.
- [x] ⚠️ SCHEMA (approved): `DatingPerson.instagram String?` (handle without @). Additive, nullable
- [x] `normalizeInstagram` / `instagramUrl` (src/lib/dating.ts, pure): "@x", "x", "instagram.com/x", share links with `?igsh=`, m./www./instagr.am, stories links → lowercased handle; null for empty, spaces/dashes/non-ASCII, >30 chars, leading/trailing/double dots, post/reel links, other domains
- [x] `PATCH /api/dating/[id]` and `POST /api/dating` accept `instagram` (normalized; invalid → 400 "That doesn't look like an Instagram handle…" via `personPatchError`, checked before any write; "" / null clears). DTO carries it
- [x] UI: Instagram field in Notes → Details (saves on blur, shows "@handle", rejects invalid client-side too so a bad value never becomes her link), "@handle" link under the name in the person header, small Instagram icon on /dating cards (card is now a stretched name link so the icon is a sibling `<a>`, no nested anchors). All links `target=_blank rel="noopener noreferrer"`
- [x] Dictation: SYSTEM prompt shape has `"instagram"` (only when the note explicitly states a handle; never guessed), roster lists the current handle, `parseProposal` normalizes and drops one equal to what she has, review shows a tickable "Instagram @x" row. Apply: new people get it on create; reviewed dictation replaces a different handle; unreviewed Granola filing only fills an empty one
- [x] Verified: 32 new unit cases (229 total pass), typecheck, prod build. Scratch-PG e2e (fake Claude via fetch preload) 25/25: PATCH with @handle / bare / instagram.com/x / share URL with igsh → normalized; invalid text, post URL, non-string → 400 and old value kept; other-field PATCH leaves it; "" and null clear; cross-user PATCH 404 and her row untouched; unauth → login redirect; create with/without valid handle; dictation proposal carries the handle, apply sets it, unticked (null) keeps it, a new handle replaces the old one, prompt/roster contain the new shape; forged cross-user apply 404/400. Browser (agent-browser, scratch DB): /dating cards light desktop + dark 390px (icon hit-test → instagram link, card body → person page), header link, Notes field set via share URL → "@ana.browser" in field/header/DB, invalid → error and link unchanged, dictate review row in dark 390px; no horizontal scroll
- NOT verified: a real Claude call recognising "her insta is …" (faked in e2e), iOS Safari, Granola auto-fill path end to end (logic covered by the same apply code), `pnpm lint` (broken before this change)
- [ ] Eddie: prod `pnpm db:push` (1 nullable column on DatingPerson) BEFORE deploying

## Dating: photos + taste (2026-09-26)
Ask: photos on each person (avatar on /dating cards) and a "Your taste" read in Find patterns that also looks at them.
- [x] ⚠️ SCHEMA (approved, commit 9644a16): `DatingPhoto { id, userId, personId, url, caption?, createdAt }`, cascades with User and DatingPerson, index (personId, createdAt)
- [x] Storage: board image re-hosting generalized into `src/lib/user-image.ts` (`storeUserImage` / `deleteUserImage` / `readUserImage` / `ownsUserImage`); board.ts keeps `storeBoardImage` / `deleteBoardImage` as thin wrappers (same keys and local paths as before). Dating photos go to Blob `users/<userId>/dating/<personId>/` (local dev: `public/uploads/dating/<userId>/<personId>/`). Delete and fetch are both gated by the prefix guard (own user + folder, https Blob host, no `..`)
- [x] API: `GET/POST /api/dating/[id]/photos` (multipart `file` + optional `caption`, or raw image body; 4.4 MB cap → 413; undecodable → 415; 60 per person), `PATCH/DELETE /api/dating/photos/[photoId]` (caption set/clear; delete removes row then blob). Session auth, userId-scoped, cross-user 404. Deleting a person now also deletes their photo files (rows cascade)
- [x] Data: person page gets photos newest first; /dating card DTO has `avatarUrl` (newest photo)
- [x] UI: "Photos" strip at the top of the Overview tab: thumbnail grid (4/6/8 cols), Add button (file picker `accept="image/*" multiple`), paste and drop anywhere on the page (drop overlay), client compress + 4 MB check as on the board, upload placeholders. Lightbox: solid black, Esc closes (Esc first cancels a pending delete), arrows prev/next, focus goes to Close and returns to the thumbnail, caption field (saves on blur/Enter/Esc), Delete with inline "Delete this photo?" confirm. 36px round avatar on /dating cards only when a photo exists (fixed size, no shift on load)
- [x] Taste: Find patterns sends each person's newest 3 photos (round-robin by rank, capped at 24 total) as base64 image blocks, resized to 768px JPEG, right after that person's text block (stage, met via, dates, "lasted"/"so far" duration, avg vibe, flags, timeline, notes, lessons). One Claude call; reply split on `=== YOUR TASTE ===` into `{ text, taste, photos }`. Prompt: stayed-interested vs lost-interest traits, stated type vs who they pursue, looks vs character vs duration; no rating/ranking/comparing looks, no body commentary beyond the pattern, never infer ethnicity/race/religion/health/age. maxDuration 120 → 300. "Your taste" card under the patterns text with "Read with N photos"
- [x] Verified: 11 new unit tests (240 total pass: selection/cap, avatar pick, caption/duration/split helpers, prefix guard incl. traversal and other-user/other-person/other-host), typecheck, prod build. Scratch-PG e2e, route handlers with Blob `put`/`del` and Claude mocked (4/4): upload → Blob key under users/<A>/dating/<person>/, list newest first, B upload/list → 404, 5 MB → 413, text file → 415, caption set/clear, B PATCH/DELETE → 404, owner delete removes row + calls `del`, a tampered row pointing at another user's blob is removed without deleting that file, patterns with 11 people × 3 photos → exactly 24 image blocks (base64 jpeg ≤ 768px) after the right text blocks, taste split, B → 400, deleting a person deletes its blobs. Dev server on scratch DB (local-disk fallback) via curl: upload ×4, list order, cross-user list/upload/PATCH/DELETE → 404, 5 MB → 413, unauth → login redirect, deleted files gone from disk. Browser (Chrome, scratch DB): strip dark + light desktop, 390px light/dark for detail, empty state and /dating avatars, lightbox open / arrow / Esc / inline delete confirm, paste and drop upload, "Your taste" card with a stubbed response
- NOT verified: a real Claude call on real photos (quality/tone of the taste read, real latency with 24 images), real Vercel Blob upload/delete/fetch (mocked), iPhone camera-roll picking and HEIC on a real device, `pnpm lint` (broken before this change)
- [ ] Eddie: prod `pnpm db:push` (new DatingPhoto table) BEFORE deploying

## Dating: board + rows views (2026-09-26)
Ask: every person as a card grouped by stage, as a Kanban board or horizontal rows; dates prominent on each card.
- [x] `src/lib/dating-board.ts` (pure): `groupByStage` (all stages, unknown → talking), `byActivity`/`lastActivity` (newest of last text, last event, creation, and endedAt while ended), `withStage` (optimistic copy mirroring PATCH: → ended stamps endedAt, leaving keeps it), `defaultView` (board ≥1024px), `spanLabel` ("Jun–Jul 2026 · 5 wks" / "since Aug 2026 · 7 wks" / "Ended Mar 2025" / "Added Sep 2026"), `shortDate`, `duration`, `monthRange`, `vibeTone`. Dates formatted in UTC + en-US so SSR and hydration match
- [x] `/dating` page data: per person `firstEventAt`, `lastEventAt`, `lastDate {at, vibe}`, `dateCount`, `avgVibe` (all events, as before), avatar. Dropped the unused sparkline / message-count queries
- [x] `PeopleBoard` (src/components/dating/people-board.tsx): Board | Rows toggle (localStorage `personalos:dating-view`, try/catch; before a saved choice CSS picks board ≥lg, rows below, so no flash). Board: 5 columns with counts, vertical scroll per column, horizontal board scroll, native HTML5 drag between columns (optimistic, PATCH, revert + toast on failure), Ended collapsed with "Show n" (`personalos:dating-ended-open`), still a drop target when collapsed. Rows: one scroll-snap strip per stage, empty stages hidden except Talking/Dating hints. Compact card: avatar/initials, name, Instagram icon, "Move to…" native select (keyboard/touch), date range as main subline, last date + vibe, last text date, number of dates, avg-vibe dot, first remember item; whole card links to the person
- [x] Home layout: people view first; Granola sync, suggestions, Dictate, Lessons/patterns, sync help below (unchanged, max-w-5xl)
- [x] Verified: 21 new unit tests (278 total), typecheck, prod build. Browser (Playwright + Chrome for Testing 153, scratch PG, 12 seeded people): 22/22 checks: desktop default Board, sort order, drag Talking → Dating persisted after reload, Move-to persisted, drag onto collapsed Ended (endedAt stamped in DB), forced 500 → toast + revert, Ended open state + Rows view persisted across reload, dark desktop, 390px light/dark default Rows, no page horizontal scroll (rows and board), card controls ≥44px; no console errors besides the forced 500
- NOT done: "Delete…" on cards (Eddie's follow-up ask); the edit was blocked by a permission check, so it's not implemented
- NOT verified: real touch drag on iOS (the Move-to menu is the touch path), Safari/Firefox, `pnpm lint` (broken before this change)

## Dating: one-page person + organize notes (2026-09-26)
- [x] /dating/[id] is one scrolling page (tabs removed): header (avatar from first photo or initials, name, stage pill, Instagram, key dates: met / range / duration / last date + vibe / dates count), photos, Organize button, Dictate, Claude's read (collapsible, 2-line preview), Remember / Green / Red, "How it's going" (message stats + chart), Timeline + add form, Notes + lessons (save on blur), Details (delete at bottom), Messages (collapsed; `#messages` opens it). Section ids: #insights #chart #timeline #notes #details #messages. Errors show as a dismissible bottom toast. No `?tab=` links existed for dating.
- [x] `organizePersonNotes` (src/lib/dating-organize.ts): fileDatingNote with source "journal" on notes + lessons, journal rules in the prompt (events on the explicit dates in the text, undated ones dropped via `resolveJournalDay`, up to 60 events, 8k tokens), auto-apply, "From journal" marker note keyed `journal:<personId>` (short line, not the notes text). Skips when marked or notes empty; stage only set when current stage is "talking" (endedAt = last event day). Notes field never touched. Marker note uses the client's local day (`clientToday`).
- [x] POST /api/dating/[id]/organize (404 cross-user) → { result, person, events }; GET/POST /api/dating/organize-all (3 people per batch in parallel, `skip` for failed ids so the loop ends) → { done, remaining, results, failed }. maxDuration 300.
- [x] Granola card: "Organize everyone's notes with Claude (n left)" with progress + Stop.
- [x] Verified: 15 new unit tests (272 total), typecheck, prod build. Scratch-PG e2e on `next start` with faked Claude (fetch preload): unauth → login redirect (POST organize, GET organize-all, page); cross-user and unknown id → 404 with 0 Claude calls; Ana organize → 2 dates + 1 conflict on 2025-01-31 / 02-14 / 04-02, undated event dropped, 3 flags, 1 detail, lessons appended, stage talking→ended with endedAt 2025-04-02, notes intact; second call "skipped" with 0 Claude calls; organize-all 2 batches → remaining 0 with the forced failure skipped; stage "dating" not overwritten; other user's count untouched. Browser (Playwright): Ana light desktop + dark 390, Gia organize click dark 390, /dating card light + dark 390; no console errors, no horizontal scroll; notes blur save, timeline add, messages expand/anchor, insights expand.
- NOT verified: a real Claude call on the 22 production journals (faked in e2e); iOS Safari.
- Pre-existing, not fixed: the timeline "Add a moment" date defaults to the UTC day (shows tomorrow in US evenings).

## Dating: WhatsApp sync (2026-09-26)
Ask: the Mac message sync also reads WhatsApp Desktop's local database for the people on /dating.
- [x] `scripts/dating-messages-sync.ts`: WhatsApp on by default (`--no-whatsapp` skips; a missing db logs one line and skips; an unexpected schema logs the missing columns and skips). Reads `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` from a temp snapshot (db + -wal + -shm), only 1:1 sessions (`ZSESSIONTYPE` 0, `@s.whatsapp.net`) whose JID digits equal a person's normalized phone; groups (@g.us), status/broadcast, @lid and newsletters never match. Text messages only (`ZMESSAGETYPE` 0, non-empty `ZTEXT`) → `{ guid: "wa:<ZSTANZAID>", sentAt (Core Data seconds since 2001), fromMe, text, source: "whatsapp" }`. Per-person output `Name: X iMessage, Y WhatsApp messages (Z new)`. Env overrides `DATING_SYNC_CHATDB` / `DATING_SYNC_WADB` for testing. Header documents Full Disk Access (covers the WhatsApp group container too); the FDA error names the resolved node binary (`realpath(process.execPath)`), and the temp snapshots are deleted on that exit path too
- [x] Readers/helpers split out: `src/lib/dating-message-sync.ts` (pure: JID ↔ phone, Core Data / iMessage dates, row mapping, source allowlist, summary line) and `src/lib/dating-message-readers.ts` (sqlite3 CLI readers, snapshot, FDA help)
- [x] `/api/capture/dating`: POST takes an optional batch `source` and per-message `source` (allowlist imessage | whatsapp, default imessage; invalid batch source → 400, invalid per-message source → message dropped). GET adds `whatsappSince` so last-synced time is tracked per source. No schema change (`DatingMessage.source` is already a String)
- [x] Message thread (dating-detail.tsx): small tertiary "iMessage" / "WhatsApp" / "Pasted" label at the start of each run of messages from one source, and in the bubble tooltip. Sync help mentions WhatsApp and the node binary
- [x] Verified: 16 new tests (309 total pass) incl. fixture chat.db + ChatStorage.sqlite (WAL mode, with a live writer holding an uncheckpointed row that the snapshot must pick up; mutation-checked), typecheck, prod build. Dry-run + real run against fake DBs and a mock server (per-source POST batches, --no-whatsapp, missing db, FDA error path). Scratch-PG e2e on `next start`: sync stored 4 + 1 rows with source whatsapp/imessage, re-run and `--full` → 0 new (dedupe), GET returns per-source since, invalid source → 400, legacy (no source) → imessage
- NOT verified: against a real WhatsApp Desktop database (column names come from public forensic references; the script checks them and skips WhatsApp with a clear log if they differ), whether launchd attributes FDA to node or /bin/zsh on this macOS, the thread label in a browser (typecheck + build only), `pnpm lint` (broken before this change)
- [ ] Eddie: grant Full Disk Access to the node binary (the script prints the exact path when access is missing; re-grant after a node upgrade), then run `pnpm dlx tsx scripts/dating-messages-sync.ts --dry-run` once and a real run

## Dating: link Granola suggestion + quick add (2026-09-26)
Ask: file a "New from Granola" suggestion onto someone already on /dating ("Margo" is really Margaux), and replace the inline "+ Add" form with a compact quick-add sheet.
- [x] `src/lib/dating-match.ts` (pure): `foldName` (case, accents, punctuation), `editDistance`, `nameScore` (per-word best of prefix / shared-prefix / edit similarity, averaged; exact = 1), `rankByName`, `LIKELY_MATCH` 0.6
- [x] `linkSuggestion(userId, id, personId)` in dating-filer.ts: suggestion must be the user's and pending, person must be the user's (else null → 404). Files every pending same-name suggestion (DB case-insensitive equals + `sameName`) as the same kind "note" event addSuggestion writes (shared `suggestionNote` builder: title, source line, source "granola", externalId `granola:<meeting>:<person>`), `createMany skipDuplicates` so a meeting already filed to her isn't duplicated, then marks them added with personId. addSuggestion now uses the same builder (output unchanged)
- [x] `POST /api/dating/suggestions/[id]/link { personId }`: session auth, 400 without personId, 404 for other users' suggestion/person or not pending
- [x] UI: "Add to…" next to "Add her" opens `LinkPicker` (combobox + listbox, name + stage, best match first; top one highlighted only when it's a likely match so Enter can't file onto a stranger; ↑/↓/Enter, Esc). Optimistically hides every same-name row; restores them with an error on failure
- [x] Quick add: "+ Add" opens `QuickAdd` in a `Sheet` (bottom sheet on phones, centered from sm; Esc/outside click close, Tab trapped, focus returns to the opener). Name (autofocus, required), Stage (default Talking), Phone (→ `handles` via parseHandles/normalizeHandle), Instagram (normalizeInstagram server-side), Met via, Met on (default today). Enter submits; success shows "Open her page" / Add another / Done and `router.refresh()` puts her card on the board. Inline form removed (it no longer auto-opens when there are zero people)
- [x] `POST /api/dating`: new `newPersonError` → 400 for an unknown stage, a phone/handles value that normalizes to nothing, non-string handles, or an unparseable metAt (PATCH unchanged)
- [x] Verified: 11 new unit tests (304 total pass after rebasing on main), typecheck, prod build. Scratch-PG e2e via dev server + curl: cross-user suggestion 404, other user's person 404, no personId 400, unauth → login redirect; link "margo" onto Margot filed m1 + m3 notes with correct title/source line/externalId/occurredAt, skipped m2 (already filed), marked Margo/margo/MARGO added with personId, left Kat/Priya and user B's Margo pending; re-link 404; "Add her" still works (regression); quick add → handles {+14155550123}, instagram "quinn.t", stage/metVia/metAt; invalid instagram / stage / phone → 400; blank name 400. Browser (Playwright + Chrome for Testing, scratch DB): picker order and highlight (Margot, Margaux, Maria…), Esc closes + focus back on the trigger, typed filter, Enter links and rows vanish, forced 500 restores the Kat row with an error, quick add autofocus, invalid Instagram error in the sheet, success link href, new card on the board, light + dark desktop, dark 390px (no horizontal scroll). No console errors besides the forced 500 / expected 400
- NOT verified: iOS Safari / real touch, VoiceOver reading of the combobox, `pnpm lint` (broken before this change)

## Dating: simpler person page (2026-09-26)
Ask (Eddie): "the page for each person is too complicated", and he couldn't find how to change the name.
- [x] Header: avatar (newest photo or initials; tapping it opens More and scrolls to Photos), name as an inline-editable heading (click the name or the pencil; Enter or blur saves via PATCH `{name}`, Esc cancels, empty refused with a toast), stage as a compact pill select, Instagram icon link, and one quiet line of dates from new pure `datesLine` ("Met Jan 26 · 8 months · 3 dates · last Sep 12 (8/10)", empty parts left out, UTC + en-US so SSR matches)
- [x] Default view is three sections: Dictate → Summary (Claude's summary + Refresh, or one "Read everything with Claude" button; Remember / Green / Red as compact bullet lists with inline "+ Add" and Claude's suggestions shown muted with a +; Ideas + lesson behind a small disclosure; "Organize notes" row only while notes aren't organized) → Timeline (one-line rows, tap to edit, "+ Add" opens the form inline, Delete lives in the edit form)
- [x] Everything else in one "More" disclosure (collapsed by default, open state in localStorage `dating:detail-more-open` with try/catch; always mounted so photo paste/drop keeps working): Photos, How it's going (stats + chart), Notes & lessons, Details (no Name field any more: the header owns it; Delete at bottom), Messages (collapsible thread, unchanged)
- [x] Anchors: a hash pointing inside More (#photos #chart #notes #details #messages) opens it and scrolls once visible; #insights / #timeline stay in the main view
- [x] PATCH `/api/dating/[id]`: `personPatchError` now returns 400 "Name can't be empty" for a blank/non-string name (was silently ignored). Quick add with a blank name gets this message instead of "name is required" (still 400)
- [x] 44px touch targets on phones for the new controls, the Dictate mic/File it and the Photos Add button (desktop sizes unchanged)
- [x] Verified: new unit tests for `datesLine` and the empty-name check (305 total pass), typecheck, prod build. Browser (Playwright + Chrome for Testing, scratch PG, rich + empty person): 34/34 checks: rename via Enter persists in DB and after reload, Esc cancels, blank refused (UI + API 400), blur saves; list add / remove / suggestion add; timeline add / edit / delete; dates line updates; More collapsed by default, opens, open + closed state survive reload; Details city saves; #messages opens More + thread and scrolls; #details opens More; #timeline doesn't; avatar opens Photos; chart renders inside More; stage change; Organize button shown; ideas disclosure; notes save; no horizontal scroll at 390px; no mobile targets under 40px; no console errors. Before/after screenshots light/dark, 390px + desktop
- NOT verified: iOS Safari / real touch, VoiceOver, `pnpm lint` (broken before this change)
- Pre-existing, not fixed: timeline "Add" date defaults to the UTC day (tomorrow in US evenings)

## Dating: outstanding reliability, privacy and board controls (2026-09-26, Codex)
- [x] Add confirmed person deletion to board and rows; keep the card and show an error on failure.
- [x] Make all Granola meeting writes atomic. Explicit completion markers let historical partial meetings recover without overwriting previously filed per-person records.
- [x] Use timestamp + meeting ID for Granola batches, preserve the cursor on error/Stop/batch cap, and offer Retry/Continue.
- [x] Deduplicate identical undated pasted transcripts while retaining repeated lines; paginate messages with timestamp + ID so ties are not dropped.
- [x] Serialize profile saves, roll back failed changes without discarding later edits, and recover busy states/drafts after failed requests.
- [x] Store dating photos privately and serve only through a signed-session, owner-checked content route. Local dating files stay outside public. Mood-board uploads keep their existing storage.
- [x] Configure EC personal-os private Blob store `personal-os-dating-private` and server-only `DATING_READ_WRITE_TOKEN` for Production/Preview/Development. Original public token preserved. Read-only production audit found zero dating photos, so no production data migration was needed.
- [x] Independently review combined changes. Targeted PostgreSQL tests prove rollback/concurrency, complete timestamp-tie pagination, repeated-import dedup, ownership, and private image delivery. Real private Blob synthetic upload/read/delete and running-app HTTP checks passed; synthetic remote files were deleted.
- [x] Final verification: 372 tests across 32 files passed (including 13 real-PostgreSQL integration tests), typecheck passed, production build passed.
- [x] Published PR #19, merged as fcc4161, and verified the production deployment Ready.

No database schema changes. All verification database writes used isolated local PostgreSQL on port 55439; the live Mac sync checkout/job was untouched. Granola/Claude production imports were not triggered. Browser confirmed board controls; the in-app browser stalled on the native confirmation dialog, so confirmation/cancel/success/failure were verified with rendered-component tests and deletion with running-app HTTP checks instead. Identical undated imports dedupe going forward; old imports and overlapping/edited undated transcripts cannot be matched reliably. Migration CLI is dry-run by default with a restricted resumable manifest; no migration ran against production. Existing lint command remains broken independently of this change.

## Dating: date-aware person matching (2026-09-26, Codex)
- [x] Reproduce similarly named-person ambiguity and the parser's unmatched-name fallback.
- [x] Supply the filer each person's full activity window and note date, and prefer date-consistent matches.
- [x] Preserve ambiguous matches as reviewable suggestions; keep forced-person journal/dictation behavior.
- [x] Test two similar names, overlapping/unknown windows, date boundaries and real PostgreSQL loading/filing.
- [x] Run full checks and independent review: 387 tests (including 9 real-PostgreSQL identity tests), typecheck and build passed. Six existing Granola transaction tests also passed separately. Three live Claude checks using invented people passed: current, explicitly historical, and ambiguous recollection.
- Release: publish the reviewed branch and verify the production deployment; record its status in the takeover handoff.

No schema changes or production data repair planned. The handoff says existing misfiled data was already corrected manually.

## Dating: simple people cards (2026-09-26, Codex)
Eddie: the board is confusing; chose simple cards, with past relationships tucked below.
- [x] Review existing board and agree on simple-card direction.
- [x] Replace columns and view switching with a responsive current/past card layout.
- [x] Keep status and confirmed-delete actions with request recovery.
- [x] Verify transitions, desktop/mobile presentation, tests, typecheck and build.
- [x] Published PR #21 and verified EC production a064531 on both domains.

Verified: 394 tests passed (22 unrelated opt-in database tests skipped), typecheck and production build passed; independent review approved. Browser checked synthetic local profiles on desktop and 390px mobile: no horizontal overflow, 44px menus, current/past status updates persisted through reload, past disclosure persisted, and profile navigation worked. No browser console errors. Real iPhone/VoiceOver not tested. No schema changes, production data writes, or Mac sync changes.

## Dating: everyday overview usability (2026-09-26, Codex)
Eddie asked for improvements to be selected and implemented, preserving the simpler cards.
- [x] Add name search across current and past people; reveal past matches while searching without changing the saved disclosure preference. Clear and Escape restore the normal view; no-match state explains how to recover.
- [x] Sort past relationships by recorded relationship dates, not the time an old note was imported; keep refreshed profile names/photos after a status change.
- [x] Name the main action Add person. Keep everyday notes and Granola review visible; tuck import/sync tools into a collapsed disclosure while preserving mounted progress.
- [x] Recover Add her / Dismiss failures, prevent concurrent duplicate review actions, and show review counts/errors near the relevant controls.
- [x] Run regression tests, browser checks and independent review.
- [ ] Publish and verify deployment.
No schema changes, automatic imports, production data repair or changes to the Mac sync job.

Verification: 412 tests passed (22 unrelated opt-in database tests skipped), typecheck/build passed. Browser: accented/reordered search finds a collapsed past profile; clear restores collapsed preference; 390px viewport has no horizontal overflow; review buttons are 44px; native disclosure preserves draft and import date; no console errors. Component tests verify in-flight imports survive disclosure toggles and failed reviews release controls for retry. No real import or AI call was triggered. Existing build warnings remain; real iPhone/VoiceOver untested.

## Dating: paragraph add and grounded enrichment (2026-09-27)
Eddie wants to describe someone once, find saved contact details, and build their history without prompting for each source.
- [ ] Save the supplied phone for the requested contact and import only her matching messages.
- [x] Make Add person paragraph-first with editable inferred details, unknown dates blank, and duplicate detection.
- [x] Resolve contact details from available owned sources with explicit identity evidence; expose unavailable Instagram connection honestly.
- [x] Refresh summaries automatically after new message imports without overwriting user notes.
- [x] Verify authentication, uncertain identity handling, network recovery, rendering and regression checks.
- [ ] Publish, verify deployment, and update live sync checkout and handoff.
No database schema changes. Tests use isolated local data; production data changes are limited to the requested requested contact/import.

Verification so far: 523 tests passed (including scratch PostgreSQL capture/contact/insight tests), typecheck and production build passed. Browser with invented people verified paragraph extraction, explicit and unknown contact/date fields, original context, Pursuing status, 390px layout without overflow, save/navigation, and a summary generated automatically with honest source counts. Independent reviews found and fixed stale contact transfer when switching to manual entry, duplicate-name/concurrent contact assignment, and empty targeted-sync arguments. WhatsApp backfill verification and production release remain pending.

## 2026-09-27 — Separate dating groups and hide lessons

Requested design: retain simple cards, separate Dating (including Exclusive), Pursuing and Paused into labeled groups, and preserve the past disclosure/search. Make Lessons collapsible, initially closed, remembering the preference on this browser and preserving any generated results while hidden. Existing auth/data model unchanged.

- [x] Inspect current components and explicit screenshot request; choose the small existing-style change above.
- [x] Implement grouping and persisted lessons disclosure.
- [x] Verify status movement/recovery, search and disclosure persistence with component tests; full suite506passed/41opt-in skipped; typecheck/build passed. Live mobile/desktop check follows deployment.
- [x] Independent review approved with no findings.
- [ ] Release and production desktop/mobile verification.

## 2026-09-27 — Automatic dating intake and review inbox

- [x] Reconcile live dating implementation, EC Pad source architecture and user-approved direction.
- [x] Specify source adapters, evidence ownership, durable review decisions and concrete additive schema proposal.
- [x] Independently review the intake design and resolve findings; final review approved after clarifying undated evidence, serialized alias resolution and retention limits.
- [x] Obtain approval for the documented three-table/additive-column schema change before schema edits — Eddie approved September 28.
- [ ] Implement, verify and release intake/review; preserve outstanding reflection, summary and photo improvements as follow-up scope.

No schema, code, installed-worker or production source changes in this design step. EC Pad is actively being edited in another task; do not overwrite its working tree. Spec: docs/superpowers/specs/2026-09-27-dating-intake-design.md.

Implementation progress September 28: additive SQL upgraded a full-baseline scratch database with no schema difference afterward. Core ingestion/review/identity/retention and insight freshness integration tests pass; UI and native connector implemented. EC Pad isolated commits c36850d/fbcb7c0 pass195 native tests and macOS/iOS builds. Final adapter integration, release review and deployment remain. No production schema application or new private-source imports yet.

September 28 release preparation: frozen pnpm lockfile build passed; full suite with new scratch PostgreSQL integration passed569 tests (41 unrelated opt-in tests skipped). Synthetic browser checks passed add/edit, unknown dates, dismiss/exclude, message discovery opt-in, source evidence and390px layout. EC Pad connector reconciled with3fd073c at1684299;209 native tests and macOS/iOS builds passed. Production schema-only backup saved privately, approved additive SQL applied transactionally and live schema diff reports no difference. No new source enabled or private source imported. Final review fixes extend exclusions across alias chains and revoke outstanding EC Pad pairing codes on disconnect. Active EC Pad task was notified to integrate the tested local connector after preserving its ongoing work.

## 2026-09-28 — Automatic contact lookup when adding someone

Existing approved paragraph-add behavior should work by name alone. Keep exact full-name auto matching; present plausible ambiguous matches for selection. Refresh the on-device Contacts cache daily/on missing data, poll added people every minute on the awake Mac, and invoke existing targeted message sync after a contact is attached. Keep the directory local and only send matches for already-added people. Record status using existing source configuration (no schema changes), expose progress/retry/choices on her page, and preserve manual handles and editing.

- [x] Find cause: September9 contact snapshot, no refresh,30-minute worker, silent ambiguous failures.
- [x] Implement refreshed Contacts, fast worker, owner-scoped status/choice API and person UI.
- [x] Verify exact/ambiguous identity, stale-name/manual-edit races, worker retries and message import with invented fixtures and scratch PostgreSQL.
- [ ] Deploy web, install fastworker, verify live health without adding synthetic people to production.

Verification:621 tests passed with scratch PostgreSQL,42 unrelated opt-in tests skipped;9 legacy contact integration tests also passed. Production build/typecheck passed. Synthetic mobile browser added a person without a phone, resolved Contacts through capture API, and imported only the matching SQLite iMessage thread. Independent review found no blockers. One pre-existing WAL fixture timed out during an unrestricted parallel suite; its16 tests passed alone and the full suite passed with four workers. Live Contacts refresh succeeded; release/LaunchAgent installation remains.

## 2026-09-28 — Replace meeting import with Board

- [x] Remove the manual meeting importer and its Capture link; retain an old-bookmark redirect to Board.
- [x] Pin Board below Calendar on desktop and mobile, removing it from optional trackers to prevent duplicates.
- [ ] Verify build and rendered navigation, publish and check the live release.

No data or schema changes; existing imported tasks remain.

Build and typecheck passed. Synthetic desktop/mobile browser verified permanent Board below Calendar, no duplicate with old saved tracker preferences, no importer link, old bookmark redirect, deleted API404s and no browser errors.

## 2026-09-28 — Daily Call Sheet

- [x] Explore CRM and message-reader architecture; inspect read-only contact coverage.
- [x] Clarify audience:friends, family and professional relationships; Eddie approved message-based relevance.
- [x] Compare selection approaches and draft the bounded design.
- [x] Independently review the written design and resolve blocking findings — approved with no blockers.
- [x] Obtain approval for the three additive tables before schema changes — Eddie said “great - start with teh call sheet” after the explicit approval question.
- [x] Resolve Mac message-file access and complete a real source-coverage audit — succeeded after Eddie enabled Full Disk Access.
- [ ] Write implementation plan, implement, test with scratch data, and release the authenticated call sheet.

Initial read-only audit:510 CRM people,262 with usable identities,28 shared handles excluded. Both iMessage and WhatsApp file reads denied in this execution context. No conversations read, schema changed, message transfer or job installed. Design:docs/superpowers/specs/2026-09-28-call-sheet-design.md.

September28 access follow-up:both message databases now readable in the same runtime. Direct activity matched179 CRM people on iMessage and29 on WhatsApp, with overlap;26 had activity within7days and179 had newer activity than their CRM date. Reviewed bounded excerpts across an8-person sample plus a4-person WhatsApp-focused sample. No cloud import or CRM writes; temporary snapshots cleaned up. The subsequent “start with the call sheet” reply approved the three-table proposal.

## 2026-09-28 — Add CRM people from conversations

- [x] User explicitly authorized adding missing people from iMessage and WhatsApp.
- [x] Inspect past12months of direct conversation activity and match uniquely to saved Contacts. Require at least2 messages each direction and activity on at least2 days. Exclude existing/archived people, shared identities and uncertain names.
- [x] Review348 candidates, defer51 unclear/service names plus9 possible duplicates, and atomically add288 verified people with contact details, source tags and last observed message date. No schema changes or message sending.
- [x] Verify all288 new records through authenticated live CRM API; active total798.

Source split:227 iMessage only,24 WhatsApp only,37 both. Private import manifest with exact created IDs and deferred names remains on-device under Application Support/personal-os/crm-conversation-import-2026-09-28-manifest.json (0600). No personal identities, contact details or messages committed to git. Eddie subsequently approved the Daily Call Sheet three-table proposal.

September28 Call Sheet implementation:three additive tables verified against scratch PostgreSQL with no schema difference; Home/Friends UI, direct-message worker and evidence extraction implemented. Final full suite679 passed,42 unrelated opt-in skipped; production build/typecheck passed. Synthetic browser verified five stable rows, shared Home/Friends list, Done/Undo, Snooze/Replace/Hide/Undo, collapsed conversation evidence, pending-source states and390px layout. A pre-existing WAL timing fixture failed during concurrent build load, then passed16 tests alone and the complete suite passed after the build. Independent spec review fixes address category balance, the cross-source three-snippet budget, and optional AI follow-ups remaining context-only. Explicit due-follow-up priority is deferred because CRM has no Person-linked due field. Production rollout remains pending.

Release review fixes:connector cue checkpoints now include non-text activity; CRM deletion atomically scrubs historical/Undo snapshots, with maintenance covering archive/identity changes; first sync replaces newly discovered pre-generation recent contacts rather than claiming a new check-in. Approved three-table production SQL applied transactionally after private schema-only backup; production Prisma diff reports no difference. No sources enabled or job installed yet.

## 2026-09-28 — Give Call Sheet its own page

- [x] Add authenticated /call-sheet page and permanent navigation directly below Board on desktop/mobile; include command-palette discovery.
- [x] Move the existing interface from Home/Friends to the dedicated page, retaining the same daily data/actions and hourly sync.
- [x] Verify build and desktop/mobile navigation, release, and verify live (PR29).

No schema or data changes.

Dedicated Call Sheet page verification:production build/typecheck and7existing component tests passed. Synthetic browser verified authenticated /call-sheet, desktop/mobile link directly after Board, five rows, Home/Friends embeds removed, and no overflow/browser errors.

## 2026-09-28 — Ask how a call-sheet check-in happened

- [x] Done opens a compact method picker (Call, Text, WhatsApp, Email, In person, Other) before any save, with Cancel.
- [x] Require a supported method on the authenticated action; save it through existing Interaction kind/title and daily JSON, display it on the completed row, preserve Undo.
- [ ] Verify selection/cancel/retry, persistence and Undo in scratch, browser, build, then release and verify live.

No schema change; daily list and message sync are unchanged.

Check-in method verification:56 call-sheet tests and97 dating component tests passed, along with typecheck and production build. Synthetic browser verified cancel without writes, WhatsApp persistence/reload/Undo, mobile In person, Escape/autofocus, focus trapping during a delayed save, and focus returning to Undo. Independent review approved. Production rollout pending.

## 2026-09-28 — Nest Call Sheet in Home To Do

- [x] Add a compact Call Sheet row inside the owned default To Do tile, showing current daily progress and linking to the dedicated page.
- [x] Share one progress request between desktop/mobile layouts; retain a usable link if unavailable.
- [ ] Verify desktop/mobile placement, progress and navigation, then release and check live.

No schema changes or extra todo records. Full check-in actions stay on /call-sheet.

Verification: typecheck and production build passed. Synthetic desktop/mobile browser checks confirmed a single compact shortcut only in To Do, one shared progress request, navigation to the full sheet, progress after a saved check-in, and a usable fallback during API failure. Screenshots inspected; independent review approved.

## 2026-09-29 — Call / Text on the call sheet log the check-in

Ask (Eddie, screenshot of the Call · Text · Done · ••• row): "these buttons should log the communication not trigger the action".
- [x] Call and Text on each pending row are buttons that save a `done` check-in with method `call` / `text` straight away (same `/api/call-sheet` mutation the Done picker uses), instead of `tel:` / `sms:` links. No dialog. Undo keeps working (focus moves to Undo after the save)
- [x] The row no longer links to the phone, Messages or mail at all; the `mailto:` shortcut for email-only people is gone too. Done still opens the picker for WhatsApp / Email / In person / Other
- [x] Call and Text show for every pending person (logging doesn't need a phone number) and disappear once the row is checked in
- [x] Verified: 10 component tests (2 new: row Call and row Text send the right method with no dialog; retry after a failed save; conflicts; polling paused during the save), all 57 call-sheet tests, `tsc --noEmit` clean
- NOT verified: in a browser. The only DATABASE_URL on this machine is the Neon prod DB and there is no local Postgres, so a click-through would have written real check-ins
- No schema or API change

## 2026-09-29 — CRM context backfill (AI context per Person)

Ask (Eddie): "can you search more and backfill the crm with context about the person?" Approved: additive schema (Person.context Json?, Person.contextAt DateTime?), sources = iMessage + WhatsApp + existing CRM data/interactions + Granola + web search on company/role, model = Sonnet 5.5.
- [ ] ⚠️ SCHEMA (approved): `Person.context Json?`, `Person.contextAt DateTime?`. Additive, nullable. Prod `pnpm db:push` BEFORE deploy (branch: schema.prisma + prisma generate done; prod push pending)
- [x] Shared contract `src/lib/person-context/types.ts` (PersonContext shape, limits)
- [x] Server: `refreshPersonContext` (Sonnet 5.5, fingerprint skip, lease, optimistic write, never touches manual fields), Granola match by exact full name (cached note list), web search only when company/role set, labeled public
- [x] Capture endpoint `POST /api/capture/people/context` (CAPTURE_TOKEN bearer, body/thread limits) + `GET` targets. Raw messages never stored
- [x] Mac worker `scripts/crm-context-sync.ts` (reuses call-sheet target resolver + readers, 365-day 1:1 threads, 80k-char budget, local checkpoint, --dry-run/--limit/--person), LaunchAgent plist hourly
- [x] UI: read-only Context card in the person editor + one-line summary on the friends row, marked AI-generated with date and sources. No colour changes (lesson 2026-06-10)
- [x] Tests: prompt/fingerprint/validation, capture limits, script bounding, component render; integration gated by env flag
- [ ] Merge, prod db:push, deploy, update personal-os-sync worktree, install LaunchAgent, run the backfill once for real, spot-check a few people with Eddie
- [x] Reviewed both halves (Fable): prompt treats sources as untrusted, relationship basis stated/inferred, lease + optimistic write guarded on updatedAt, worker logs ids only. Fixed: editor hides the Context card while a first generation is in flight (context holds only the lease, no summary)
- [x] Verified: typecheck clean, 663 tests pass (118 gated/skipped), prod build OK
- Known: Granola cache warms ~90 notes per request (20 s budget); the first few people of the very first backfill may come back `busy` and are retried on the next run. CRM-only edits don't retrigger a person whose messages are unchanged (use `--force`)
- NOT verified: browser rendering with real generated context, the worker against real Mac data (run once after release, see below), integration test (no local Postgres)
- [x] Fix: Granola matching bounded to the list + newest 40 details, never blocks (first prod run returned busy for everyone on cold instances); worker --verbose

## 2026-09-29 — Todo links + text selection

- [x] Row title/notes text (`data-todo-text`): a primary mouse press on it sets `textPress` (and flips the `<li>` `draggable` attribute off synchronously) until window `mouseup`/`blur`, so drag-across selects text instead of dragging the todo. Presses elsewhere (checkbox, padding, meta line) still drag. Touch path untouched (handler bails when `touchEnv`).
- [x] Title wrapper click no longer enters edit mode if a non-collapsed selection exists or the mouse moved >4px since mousedown. Plain click still edits; double-click still opens the modal (except on a link).
- [x] Row is not draggable while the detail modal is open (the modal renders inside the `<li>`); modal root stops `contextmenu`/`touchstart` propagating to the row's context-menu handlers so right-click Copy and touch long-press selection work in the modal.
- [x] Notes line in the row is linkified (still single-line truncate); link clicks stopPropagation; anchors from `linkify` are `draggable={false}`.
- [x] Detail modal: row of note links (hostname label, full URL in `title`) under the notes textarea via new `extractUrls()`.
- [x] Agenda mode titles linkified.
- [x] Tests: `src/lib/linkify.test.tsx`, `src/components/todo-row.test.tsx` (jsdom). `pnpm test` green (722 passed). `pnpm typecheck`: only pre-existing errors from the shared node_modules' stale Prisma client (`granolaImport`), none in touched files.
- [ ] Not verified in a real browser: native drag-vs-select arbitration, Safari/Firefox behaviour, iOS long-press selection in the modal, link inside the agenda `<button>` (invalid nesting; clicks work in modern browsers but worth a look).

## 2026-09-29 — Contacts → CRM auto-add

Ask (Eddie): "would also be cool to have anyone i add to my contact get added automatically". New cards only, from install; no backfill unless `--since`.
- [x] `POST /api/capture/people` (CAPTURE_TOKEN bearer, 200 KB body, ≤200 cards) + pure `src/lib/people-capture.ts` (normalise; skip no first name / no phone+email / business card; dedupe on externalId `contacts:<cardId>`, phone last-10, email, exact full name of an active person; tag `from-contacts`)
- [x] Mac worker `scripts/contacts-crm-sync.ts` (JXA export with id + creationDate, checkpoint `since`/`floor`/`posted`, 3-day lookback for iCloud-late cards, batches of 50, `--dry-run`/`--verbose`/`--since`). Import guard: >20 new cards in one run (Contacts restamped ~2,000 cards on 2026-09-23) → nothing posted, floor moves past them; `--since` bypasses
- [x] LaunchAgent `com.personal-os.contacts-crm-sync.plist` (every 5 min), not installed
- [x] Tests: people-capture, route (mocked Prisma), worker. Typecheck clean, suite green
- [x] Verified: real JXA export (6,649 cards, id/creationDate populated), worker dry run end to end
- [ ] Merge, deploy, update personal-os-sync worktree, install LaunchAgent (first run records "now"), add a test contact on the iPhone and watch it arrive
- NOT verified: route against a real database (no local Postgres); first-run Automation prompt under launchd (Terminal already has Contacts access)

## 2026-10-01 — Call sheet reminders via natural language

Ask (Eddie): "put Alex Rivera on my call sheet for Tuesday" puts that person on the Call Sheet on that date.
- [x] Schema (additive): `CallSheetContact.dueOn` / `dueNote` (TEXT, nullable); `prisma/changes/20261001_call_sheet_reminders.sql` (`ADD COLUMN IF NOT EXISTS`). Not applied to any DB
- [x] Policy: due reminder (`dueOn <= today` in sheet timezone) is tier 0, reason "You asked to be reminded today.", bypasses snooze / 7-day cooldown / recent contact / cadence; respects archived and hidden; future dates don't change ranking
- [x] Service: reminders are extra rows on top (no 2-per-category balancing), count toward the regular five, win over `skipped`, are cleared on placement (fires once; late if the day was missed); refresh keeps their reason and never auto-flips/removes them; row cap raised 5 → 25 (`MAX_DAY_ENTRIES`); hide clears a pending reminder (Undo restores it); a fired row survives Undo of an earlier action and an identity edit the same day
- [x] `setCallSheetReminder` + `POST /api/call-sheet/reminders` `{ personId, dueOn | null, note? }`; `CallSheetResponse.upcoming`
- [x] Smart capture: sixth proposal type `call_sheet` (prompt rules, validator, `forceType: "call_sheet"` with no web search); person resolver `src/lib/call-sheet/resolve-person.ts` (full name incl. whole-name-in-firstName rows, unique first name only, else 409 with candidates, else create); commit + auto routes; preview fields on /capture
- [x] Call Sheet page: quick-add ("Alex Rivera Tuesday" → parse pinned → commit, no preview), Upcoming list with cancel, reminder note on the row
- [x] Tests: policy, in-memory service (`reminders.test.ts`), resolver, capture commit, smart-capture validator/prompt, HTTP auth, component; integration spec extended (not run: no scratch DB)
- [ ] Apply the SQL to prod from merged main (flag first), deploy, then try "Alex Rivera Tuesday" for real
- Review: TODAY for smart capture is now the user's Call Sheet-timezone date instead of the UTC date (affects every capture type in US evenings). NOT verified: integration tests against Postgres, live Claude classification, real browser
