# Automatic Dating Intake Implementation Plan

> **For agentic workers:** Use executing-plans for the coordinated server work; bounded independent native-client work may be delegated. Preserve unrelated files and use synthetic data.

**Goal:** Keep dating evidence current from selected EC Pad notes, Granola and opted-in recent messages, with approval before adding people and durable exclusions.

**Architecture:** Source adapters submit immutable segmented revisions to an owner-scoped intake service. A shared extraction/review service validates exact evidence, resolves verified identities transactionally, preserves manual edits and exposes source progress.

**Tech Stack:** Next.js, Prisma/PostgreSQL, React, Vitest, Swift/SwiftUI native EC Pad.

Schema explicitly approved by Eddie on September 28 in this task. Reviewed spec: `docs/superpowers/specs/2026-09-27-dating-intake-design.md`. No additional schema beyond that contract. No real journal reads or production writes during verification.

## Frozen connector contract and work limits

POST `/api/dating/intake/pair` accepts `{code, scope}` and returns `{token, stateId}`. The code is 32 random hexadecimal characters, expires in 10 minutes and is claimed once. `scope` is the persisted library UUID. Authenticated owner POST `/api/dating/sources` with `{action:"pair"}` creates that code. All other connector routes use `Authorization: Bearer <token>` and no client-supplied owner.

POST `/api/dating/intake/records` accepts one version-1 envelope defined below plus `documentVersion` (positive increasing integer, persisted per document, at most 2^31-1). Response `{accepted:true, externalId, revision, segmentIndex, documentVersion, complete:boolean}` acknowledges only that exact persisted segment, not classification. Text uses unchanged Unicode scalar strings, UTF-8 SHA-256 of concatenated ordered segments, no separators or newline normalization. Split at Unicode scalar boundaries. Up to 12,000 UTF-16 units per segment, 128 segments/document, 64 KiB/request; refuse oversize with visible error rather than truncation. Newer documentVersion invalidates prior work; equal version with different revision is conflict. Older versions return 409 and never supersede newer work.

POST `/api/dating/intake/manifest` accepts `{version:1, generation, complete, documents:[{externalId, documentVersion, revision}], unavailableIds:[]}` with monotonically increasing persisted library generation and at most 10,000 documents. Only a complete manifest can withdraw missing documents, and unavailableIds protect temporarily unreadable known documents. A manifest referencing unaccepted revisions returns 409; caller retries after uploading. Partial manifests cannot withdraw anything. Response `{accepted:true,generation,complete}`; only acknowledged complete generations advance local manifest checkpoint. Decreasing generations or conflicting same-generation manifests return 409. Explicit removal of imported evidence remains an owner-only settings action, distinct from source pause/disconnect.

GET `/api/dating/intake/status` returns `{enabled,status,lastSuccessAt,backlog,error}` for the paired source. Source health is server-owned; uploaded-complete and processed-complete are separate. Client sends no credentials or source text to any off-origin redirect. Owner settings GET returns `{sources:[{id,source,enabled,status,lastSuccessAt,lastAttemptAt,lastNewDataAt,backlog,coverageStart,coverageEnd,error}], ...}` and review GET returns `{candidates,excluded}`.

Each server processing run stops at 8 segments/model calls or 45 seconds (configurable downward for tests), with 20-second provider timeout and 90-second expiring claims. Finish/acknowledge only processed segments; backlog remains durable and ordered for subsequent cron/after processing. Granola enumerates one 30-note API page and fetches at most 6 transcripts per run, retaining page tasks and cursor before moving onward. Mac discovery submits at most 40 segments or 45 seconds per invocation, retaining a local per-source/thread cursor. All three budget-exhaustion cases get tests larger than one run; budget exhaustion reports backlog, never up-to-date. Failed work is attempted at most once per run with persisted capped exponential retry delay and remains visible after its raw payload expires.

### 1. Persistence and source envelope

Files: `prisma/schema.prisma`, `prisma/changes/20260928_dating_intake.sql`, `src/lib/dating-intake/{contracts,store}.ts`, corresponding tests.

- [x] Add the three approved tables and nullable/defaulted relations; generate additive SQL from old/new schemas and inspect for destructive statements.
- [x] Define envelope `{version:1, externalId, revision, segmentIndex, segmentCount, text, title, occurredAt:null|string, url:null|string, identities:string[], evidenceFamily:string|null}`. Bound body, segment size/count and validate SHA-256 full-document revision after all segments arrive; accepted segments cannot silently change.
- [x] Add scratch-Postgres integration fixtures with a localhost-only guard, test incomplete/out-of-order/retried/edited revisions and two-owner isolation before implementing writes.
- [x] Implement transaction-scoped owner lock, exact owner/source identity uniqueness, stale-revision protection, lease claims, manifest withdrawal and retention cleanup. No partial revision publication, old worker overwrite or silent success on expiry/failure.
- [x] Run `npm test -- src/lib/dating-intake`; validate schema and inspect SQL diff; commit reviewed persistence.

### 2. Extraction and durable review

Files: `src/lib/dating-intake/{extract,review}.ts`, `src/app/api/dating/review/route.ts`, `src/app/api/dating/review/[id]/route.ts`, legacy suggestion actions, person create/update routes.

- [x] Test exact quote validation, unsupported model identities, unknown dates, nonromantic content and overlapping verified aliases.
- [x] Extract per bounded segment with source text treated as untrusted; publish only a complete validated revision. Strong aliases come only from verified adapter metadata or explicit user linking; names remain source-scoped.
- [x] Implement GET pending/excluded candidate DTOs and POST `{action:add|link|dismiss|exclude|restore, fingerprint, personId?, draft?}`. Add accepts editable fields; unknown dates null. Lock owner identity mutations and check every alias/profile handle before creation.
- [x] Test concurrent add/link/exclude, repeated clicks, stale fingerprints, restore, source deletion, manual timeline edits and existing profile field preservation using real Postgres.
- [x] Keep legacy suggestions visible and route-compatible; do not let old actions process new-format rows. Fix legacy mention-date-as-met-date behavior.
- [x] Source-backed events retain machine hashes; invalidate insights on evidence changes. Save fingerprint with derived summaries and refuse publication on changed input; hide removed source excerpts.

### 3. Authenticated source endpoints and UI

Files: `src/lib/dating-intake/auth.ts`, `src/app/api/dating/sources/route.ts`, `src/app/api/dating/intake/{pair,records,manifest,status}/route.ts`, middleware, `src/components/dating/{review-inbox,source-status}.tsx`, dating page/home.

- [x] Test hashed expiring single-use pairing, revocation, disabled source, body limits, bearer/session separation and invalid auth.
- [x] Settings create pairing code; paired client exchanges `{code,scope}` for `{token,stateId}`. All connector calls require token and resolve owner server-side. Configure HTTPS same-origin client and reject redirects.
- [x] Build People to review above people cards with evidence expansion, editable Add draft, Link existing, Dismiss, Don't suggest again and Restore. Show source-scoped identity limitations and nearby failures; no optimistic success before server acknowledgment.
- [x] Source row always shows EC Pad/Texts/Granola with actual coverage/backlog/error and last successful scan. Setup offers pairing, pause/disconnect, explicit text discovery opt-in and removal of imported evidence.
- [x] Component tests cover failed actions, duplicate clicks, mobile-width markup, keyboard labels and preserved mounted drafts. Never display payloads/tokens in logs.

### 4. Server and Mac adapters

Files: `src/lib/dating-intake/granola.ts`, existing Granola sync/cron entry points, `scripts/dating-messages-sync.ts`, `src/lib/dating-intake/message-discovery.ts`, message reader helpers, cron intake endpoint.

- [x] Persist Granola enumeration progress before moving cursor; bounded API pages feed durable records. Retry old queued work separately from enumeration; recent edited sweep with canonical meeting identity and honest historical limitation.
- [x] Add opt-in recent 30-day one-to-one Mac discovery alongside exact-profile imports; exclude groups/services and strong excluded aliases. Chunk chronological text, preserve exact thread identity, checkpoint only accepted data. No remote read of unspecified journal paths.
- [x] Test API paging failures, duplicate timestamps, old retries, edited meetings and message discovery filtering with invented fixtures; keep noncandidate raw text transient.
- [x] Add authenticated bounded cron processing and cleanup, leases/retries, and source health. Preserve installed-worker scope until explicit opt-in.

### 5. EC Pad native connector

Files in isolated EC Pad worktree: `apple/ECPad/PersonalOS/*`, focused AppModel/settings integration and native tests. Read EC Pad AGENTS and DESIGN first. Base on finished latest startup work (currently 97259ba); never edit active checkout.

- [x] Implement library/document UUID metadata outside Markdown, selected physical notes/folders, save debounce, unavailable-file preservation, rename/move/duplicate behavior and cancellation on lock/library switch.
- [x] Add pair, Keychain token, source selection, sync/status, pause/disconnect using the server contract; export saved snapshot text only, excluding connected Granola imports.
- [x] Test transport rejection, multipart acknowledgments, edits/deletes/partial manifests and selection using temporary libraries; run native tests/macOS/iOS builds per repository rules. Do not open the user's real library or desktop app.

### 6. Verify and release

- [ ] Independently review implementation against spec, then code quality; resolve all actionable findings.
- [ ] Run relevant integration suites against verified scratch Postgres, full unit suite, typecheck and production build. Browser-check synthetic data and source errors in desktop/mobile layouts.
- [ ] Apply reviewed additive SQL with schema backup, deploy compatible server with intake disabled, verify owner-authenticated reads. Update installed worker only after verified build. Keep actual new source transfer behind setup.
- [ ] Publish personal-os PR and attach it; follow EC Pad's no-push rule unless separately authorized. Report clearly if native build is prepared but not installed, or journal selection is still needed.
- [ ] Update handoff with release evidence and remaining separate reflection/summary/photo follow-ups. Do not claim these broader follow-ups complete.
