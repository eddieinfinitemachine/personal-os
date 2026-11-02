# Capture Inbox Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and independent reviews. The approved design is `docs/plans/2026-11-01-capture-inbox.md`.

**Goal:** All manual capture sources retain a persistent review row on Home between Projects and Lists, with current placement, safe correction and dismissal/Undo.

**Architecture:** One approved CaptureReview model stores normalized input, proposal, placement and attributable effects. Capture commits and review rows share one transaction; review mutations validate ownership, revisions and destination state. Existing mobile receipts remain compatible. UI consumes a typed session-authenticated API and current destination labels.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 6/Postgres, Vitest, existing CSS tokens and proposal editors.

## 1. Contracts and approved schema
- [x] Create `src/lib/capture-review/types.ts`: serializable review/input/placement/list contracts and supported-kind helpers.
- [x] Add CaptureReview + User relation to `prisma/schema.prisma`; create only `prisma/capture-review.sql` with the approved table, FK and index. Generate Prisma client.
- [x] Establish isolated local Postgres scratch database; never copy production .env into this worktree.

## 2. Atomic capture tracking
Files: `src/lib/capture-review/journal.ts`, `record.ts`, `commit.ts`, tests; adapt existing capture routes/helpers.
- [x] Test create/update effect snapshots, payload bounds, user scoping and stable request-key conflicts first.
- [x] Implement explicit transaction client tracking for domain writes and original attachment references; keep AI/Blob/extraction outside transactions.
- [x] Create review and destination atomically for mobile, smart auto/commit, legacy todo and manual Board/Reader saves; preserve response contracts.
- [x] Keyed retry returns saved/current placement without another write; old unkeyed clients preserve existing behavior.
- [x] Update web/Mac/Chrome payloads to include source and stable per-action IDs; preserve old clients.

## 3. Reads and review mutations
Files: `src/lib/capture-review/{read,mutate,correct}.ts`, `/api/capture-reviews` routes and tests.
- [x] Test current destination resolution after ordinary moves/renames and missing targets.
- [x] Implement user-scoped pending/dismissed pagination and current proposal/placement serialization.
- [x] Test then implement revision-guarded Dismiss/Undo with no target deletion.
- [x] Test then implement in-place/cross-type correction matrix, locked destination comparisons, guarded related data, preserved files, merged-person deltas and derived-date recomputation.
- [x] Preserve Reader highlights/Kindle state and Board images; no automatic Kindle resend. Persist/retry calendar reconciliation state without external calls inside SQL transactions.

## 4. Home UI (independent owned task)
Files: `src/components/capture-review-inbox.tsx`, `capture-review-editor.tsx`, tests, `src/app/page.tsx`, `src/app/captures/page.tsx`.
- [x] Use contracts defined below; tests for section order, pending/empty/error rows, placement, Dismiss/Undo and correction/conflict controls.
- [x] Move existing desktop By project block before Inbox, then preserve existing HomeTiles list pager/grid.
- [x] Add compact first ten captures, Show all + dismissed pagination, guarded poll/focus refresh and capture-saved events.
- [x] Existing monochrome tokens/typography; clear action labels; responsive and keyboard-accessible.

## 5. Validation and rollout
- [x] Real scratch Postgres integration covers transaction rollback, keyed replay, dismissal, correction/ordinary-edit races, file ownership and merges/derived fields.
- [x] Run focused/full Vitest, Prisma generate/validate, tsc and direct `next build --webpack` (never generic production db push).
- [x] Inspect responsive light/dark UI in a scratch environment; independently review source and actual diff.
- [ ] Confirm current production base; apply exact approved SQL only after read-only catalog preflight; deploy checked source.
- [ ] Exercise live synthetic capture→review→correct→dismiss→undo/replay; remove only synthetic records/uploads. Preserve existing workspaces and user data.
- [ ] Commit/PR/merge after checks; verify current live Home/API; document results and limitations truthfully.

## Frozen UI API contract
- GET `/api/capture-reviews?state=pending|dismissed&offset=0&limit=10` → CaptureReviewList.
- PATCH `/api/capture-reviews/:id` body `{ revision, action: "dismiss" | "restore" }` → `{ review: CaptureReviewItem }`.
- POST `/api/capture-reviews/:id/correct` body `{ revision, proposal?: CaptureProposal, fields?: Record<string,unknown> }` → `{ review: CaptureReviewItem }`.
- Errors `{ error: string }`, 401 unauthenticated, 404 inaccessible, 409 stale/unsafe correction.
- Server function `listCaptureReviews(userId, { state, offset, limit })` in `@/lib/capture-review/read` returns the same list.
- UI types live in `@/lib/capture-review/types`; UI must not invent DB or auth access.
- Emit/listen `personalos:capture-saved` after successful web capture, plus visibility/focus refresh. Refresh Home server data only on a changed list fingerprint, not every poll.
