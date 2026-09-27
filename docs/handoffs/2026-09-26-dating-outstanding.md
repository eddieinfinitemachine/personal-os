# Dating outstanding-work handoff

Base: origin/main b5ba3e6 (PR18 simpler person page). Implementation branch: codex/dating-outstanding. Worktree: /Users/eddie/Code/.worktrees/personal-os-dating-outstanding.

PR19 https://github.com/eddieinfinitemachine/personal-os/pull/19 merged as fcc41618cd86aa9ecf0896f13ca00127fcb01ca8. Production deployment dpl_B3ap4Z9BHaEf9MMwd8nv9yRu991U verified Ready on both domains, with new menus confirmed on a fresh signed-in page.

## Changes

- PeopleBoard now has an Actions menu with stage moves and confirmed Delete person. Failed requests preserve the card; successful deletion refreshes parent data.
- Granola writes suggestions, existing-person updates and a hidden dismissed completion marker in one transaction. Legacy partial records can be revisited while existing per-person idempotency keys prevent repeats. The first replay of a historical import without a completion marker incurs one reanalysis.
- Granola pagination carries since + afterId. Failures do not move the cursor past the failed meeting. Stop and the batch cap preserve a Continue point.
- Message pagination carries before + beforeId throughout initial load, API and UI. Re-pasting an identical undated transcript uses stable transcript/position IDs; real timestamped IDs retain their previous format. Existing legacy undated imports and edited/overlapping undated transcripts remain ambiguous.
- useDatingPerson serializes saves, maintains confirmed data plus pending edits, and rolls back failed edits. Analysis, organization, timeline, messages, person deletion and Find patterns recover after network rejection.
- Dating photos use private Blob storage and authenticated /api/dating/photos/[photoId]/content URLs. Responses require a valid session and matching user, with private, no-store. New local images live in .private-uploads, outside public. Mood-board image behavior remains unchanged.

## Configuration

EC scope ec-efed32ac, personal-os project prj_d0q7ulDo91YB4PFfkXltH6XSHwYT. Private store personal-os-dating-private (store_SL7XCyGGviqdlXp1), iad1. Vercel connection prefix DATING provides DATING_READ_WRITE_TOKEN in Production, Preview and Development. The existing BLOB_READ_WRITE_TOKEN is unchanged. No secrets belong in this document or source control.

No schema changes. A read-only audit on 2026-09-26 found zero production DatingPhoto rows, so nothing required migration. For any legacy rows in another environment, scripts/migrate-dating-photos-private.ts is dry-run by default; its header documents explicit environment selection and apply with a restricted resumable manifest. Deploy private-read support before migrating existing records. Never roll back to public-photo-only code after private uploads exist.

## Verification

Final local checks: 372 tests across 32 files passed, including 13 real-PostgreSQL integration tests; typecheck and production build passed. Build retains existing middleware deprecation and jose Edge-runtime warnings.

New committed tests cover rendered UI requests/save queues, transcript identity, pagination, Granola cursors and transactions, private files, signed-session image delivery, and migration recovery. PostgreSQL integration tests opt in using:

```
RUN_DATING_MESSAGE_INTEGRATION=1 DATING_GRANOLA_INTEGRATION=1 RUN_DATING_PHOTO_INTEGRATION=1 DATABASE_URL=postgresql://dating_test@127.0.0.1:55439/dating_outstanding pnpm test
```

The named database is an isolated local scratch database with the existing schema. Never run these against the normal .env: it points to production Neon. Real Vercel private-store synthetic upload/read/delete passed; anonymous direct URL was denied. Running-app HTTP tests covered private upload, DTO/avatar URLs, ownership, no-store, spoofed headers and deletion cascades. Synthetic remote files were deleted.

Browser confirmed the board Actions menu; native confirmation stalled the in-app automation. Confirmation and cancellation are covered by rendered component tests; deletion was checked against the actual HTTP server/database. A real-device touch/VoiceOver pass and real Claude/Granola quality evaluation remain unverified.

## Preserve

The original workspace at /Users/eddie/Code/active/personal-os belongs to another session. The live 30-minute message sync uses /Users/eddie/Code/.worktrees/personal-os-sync and was not changed. Granola routines remain as previously configured; no production backfill/organize action was triggered by this work.
