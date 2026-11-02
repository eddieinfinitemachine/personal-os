# Capture Inbox on Home — proposed design

Status: user approved the CaptureReview table/index/User foreign key and requested implementation (2026-11-01).

## User intent

Every new capture from ec iPhone, web capture, Mac Quick Todo, and Chrome should
be visible in one persistent review list while also being saved to its actual
destination. Eddie confirmed that this is a section on Home, between Projects
and Lists, rather than a navigation entry.

## Experience

Home order: Projects → Capture Inbox → Lists. Keep the existing mobile list
pager; show the Inbox above it where the desktop-only project cards are absent.
No new sidebar item is required. Show a compact empty state when there is
nothing to review, and a count plus the newest ten rows when items are pending.
A Show all link opens a paginated review view without adding navigation clutter.

Example row (fictional):

> Read The Creative Act · from ec · just now
> Placed in Media → Books; companion task in Later
> Open · Correct · Dismiss

Rows include title, original text/link/file summary, time, source, primary
placement, and any supporting task placement. Resolve labels and links against
the current destination (including ordinary list moves/renames), not just a
cached original label. Open leads to the current saved record. Dismiss clears only the review entry, leaving all saved records intact.
Offer Undo and access to dismissed entries. Correct edits the captured item or
moves it to another supported destination and updates the placement shown in
the row; it does not create an untracked second active copy. Keep corrected rows visible
until explicitly dismissed so the new placement remains visible.

Refresh the section on focus and while the page is visible. A new capture or
correction should also refresh Home's destination lists, so a user sees both the
review row and the actual placement. Avoid reloading the whole page on every poll.

## Capture coverage

Required: `/api/capture/mobile`, `/api/capture/smart/auto`,
`/api/capture/smart/commit`, and legacy `/api/capture/todo`. These cover the
four confirmed capture sources and Shortcuts using the old endpoint. The existing
web proposal editor may still be used before Save; a review row appears only
when the record is actually committed.

Include manual Board/Read Later saves made through the Mac/Chrome capture
controls as reviewable placements as well. Treat deduped existing-record saves
as merges, not newly created records. Do not turn scheduled imports, background
syncs, or unrelated edits into new capture rows. Begin tracking new captures;
do not infer unknown original inputs or undo provenance from old business rows.

Accurate source labels need an optional source marker from Mac/Chrome clients;
older clients remain supported with a neutral Quick capture label. Do not infer
source from user-agent. Web and ec routes know their source server-side. Preserve
existing response fields and token/session authentication.

## Persistent review record — database proposal only

Add one user-owned `CaptureReview` table with these fields:

| Field | Purpose |
| --- | --- |
| id | Primary key; deterministic user-scoped request key where available |
| userId | Foreign key to User, cascading on account deletion |
| source | ec, web, mac, chrome, or a truthful legacy/source fallback |
| requestHash (nullable) | Detect content conflicts for idempotent clients |
| input JSON | Original text, URL, and bounded file metadata/references; no raw binary/base64 |
| proposal JSON (nullable) | Validated structured capture or correction |
| placement JSON | Current type, record ID, label/path and linked supporting records |
| effects JSON | Attributable created IDs and before/after field snapshots, with revision history |
| dismissedAt (nullable timestamp) | Review dismissal; independent of saved-record deletion |
| createdAt, updatedAt | Timestamps |
| revision (integer, default 1) | Reject stale concurrent corrections/dismissals |

Add the primary key, one `(userId, dismissedAt, createdAt)` index, and the User
foreign-key constraint. Add only a relation field to the Prisma User model; it
creates no User database column. No existing table columns or business records
need migration. Do not apply Prisma schema changes, SQL, indexes, or constraints
before explicit user approval.

Migration: apply only the reviewed additive SQL and inspect the resulting
columns/constraints/index. Do not run a broad `prisma db push`. Rollback: revert
the feature code and leave the table unused; existing saved items remain in
place. Dropping the table would discard review/provenance history and is a
separate decision, so retaining it is the safe rollback.

## Save and retry behavior

Write the review row in the same transaction as destination changes. Unify or
adapt the existing three capture commit paths without changing their supported
business behavior. Keep AI/network/blob work outside database transactions.
Review creation failure rolls back the destination write instead of silently
leaving a saved item without a review entry.

The mobile receipt and request hash remain the source of idempotency. For a
request with a stable key, retries must not produce another saved item or review
row, including after dismissal or correction. Updated web/Mac/Chrome clients
must generate one persistent request ID per explicit capture action and reuse it
on retry. Legacy clients without a key retain their existing per-request save
behavior; content hashes alone must not deduplicate intentional repeated captures.
After correction, keyed replay resolves the current review placement rather than
recreating the previous target. Keep old mobile receipts without review
provenance compatible.

## Correction scope

| Placement | Editable in Inbox | Cross-type correction |
| --- | --- | --- |
| Todo | title, notes, due date, owned/accessible list and project | to/from core capture types when attributable effects can be safely reversed |
| Asset | kind (inventory/investment/media/place/practice), title, URL, notes, project and existing proposal fields | core capture types under the same safeguards |
| Person | existing name/contact/location/circle/notes proposal fields | reverse only attributable merged fields; never delete an existing person |
| Trip | name, destination, dates and existing trip proposal fields | core types only when later trip/packing items or edits do not make reversal unsafe |
| Interaction | title, date, kind, location, notes, people and project | core types with derived-person-date reconciliation |
| Call sheet | person resolution, reminder date and note | clear only the capture-attributable unchanged reminder; preserve the person |
| Board | title, note and Board kind | in-place only; retain original image URL, dimensions and Blob |
| Reader | title/byline/excerpt and read/archive state | in-place only; retain source URL, extracted content, highlights and Kindle history |

Core capture types are Todo, Asset, Person, Trip and Interaction. Missing fields
for a newly chosen type require explicit editable inputs and validation before
Save. Board/Reader cross-type moves are outside this version; the UI must make
available corrections explicit and offer Open instead of an unsafe move. Files
may move between supported owners or to an explicitly linked companion Todo
for Person/Trip/Interaction. Never silently drop their metadata or original bytes.

## Safe corrections

Record every attributable effect at initial save: primary record, companion
tasks, file ownership, newly created support people, and fields merged into an
existing person or call-sheet reminder. Capture files use Todo/Asset/Project
attachments today, so person/trip/interaction files may belong to a companion
task. Track those IDs explicitly rather than parsing links from prose notes.

A correction is an authenticated, user-scoped transaction with a review revision
check AND atomic guards for the affected destination data. Lock affected rows in
a deterministic order, then compare/mutate under those locks or conditional
writes. Ordinary destination edits do not know the review revision; test those
races explicitly. Relationship guards must also protect concurrent attachments,
comments, subtasks and references. Do not hard-delete Person/support-contact rows
where array references have no foreign-key protection. Preserve or archive
capture-created records where appropriate; never erase unrelated later work.
Do not absorb unrelated outside changes into this capture's provenance when
editing a field in the Inbox.

1. Validate destination and editable fields; validate ownership/access of every
   referenced list/project/record and preflight any related data.
2. Compare current affected fields/rows to the saved effect snapshots.
3. Reverse only this capture's attributable changes. Never delete an existing
   merged person or overwrite later edits. Refuse destructive reversal when
   comments, subtasks, attachments, references, or later edits make it unsafe.
   Derived `Person.lastInteractionAt` must be recomputed from surviving
   interactions plus any preserved prior baseline under concurrency protection;
   restoring a before snapshot is not sufficient. Test a later interaction with
   an older date that did not change the stored maximum.
4. Commit the corrected destination and transfer original file ownership safely.
   Do not use the existing todo-to-tracker create/delete path, which cascades
   attachment metadata. Do not delete shared list/project infrastructure.
5. Update placement/proposal/effects and increment revision atomically.

If later changes prevent a safe move, show a clear conflict and Open to edit the
existing record; do not silently duplicate or erase data. Existing after-commit
calendar and reader/Kindle behavior must be handled without external calls
inside a transaction. After a correction, explicitly delete obsolete todo calendar
events and sync/reconcile surviving/new tasks through existing helpers; external
failure is reported/logged and must not create a duplicate database capture on
retry. Retain enough hook state in review effects to retry reconciliation safely.
Dismiss, Undo and correction never automatically trigger Kindle delivery again.
Keep delivery state/history untouched for Reader in-place edits. A document
already delivered cannot be recalled; exactly-once external delivery is not part
of the database transaction guarantee.

Dismiss/Undo updates only review state. A deleted destination is shown as removed
and can still be dismissed; do not automatically restore deleted records.

## Validation

- Unit/service tests: correct placement summaries; all supported types and
  companion records; dismissal preserves target; Undo; ownership; stale
  revisions; exact file preservation; same-type and cross-type corrections;
  merges and later edits; transaction rollback; keyed replay after changes;
  legacy unkeyed behavior; truthful source fallback labels.
- Integration: isolated scratch Postgres for real transaction/NULL/concurrency
  semantics, not the local production DATABASE_URL. Include capture→correction→
  replay, and verify no duplicates or orphan uploads. Race correction against
  ordinary destination edits/relationship writes, verify current placement labels
  after outside moves/renames, and test derived interaction-date recomputation.
  Cover Board image and Reader content/highlight preservation and no repeated
  Kindle deliveries.
- Routes: anonymous/wrong-user reads and mutations rejected; every manual capture
  entrypoint creates exactly one review row only on successful save; legacy
  clients retain response compatibility.
- UI: Home section ordering, pending/empty/error/dismissed states, original and
  corrected placement labels, file summaries, keyboard controls, mobile pager,
  responsive layout, and light/dark presentation.
- Prisma generation, typecheck, focused/full tests, safe Next production build.
- After approval and rollout: verify a clearly marked end-to-end capture and
  review flow; remove only synthetic verification records/uploads.

## Current evidence

The current browser capture queue is localStorage-only and removes successful
items after 900 ms. Mobile receipts omit original inputs, companion IDs, and
merge provenance, so they cannot alone support safe correction. The current
Home renders list tiles before its desktop By project section; the requested
order requires moving that existing project block above the new review section.
All source changes will stay isolated in `codex/capture-review` worktree.
