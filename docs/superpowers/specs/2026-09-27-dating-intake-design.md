# Automatic dating intake and People to review

Status: product direction approved by Eddie's “do it”; concrete database proposal awaiting approval. This is the first delivery of the approved improvement list. No schema or source-data changes have been made.

## Outcome and scope

The dating page maintains profiles from new evidence and presents new or ambiguous people in one People to review inbox. Sources are the user's selected EC Pad journal notes/folders, Granola, and recent one-to-one iMessage/WhatsApp conversations. Nobody new is added automatically. Existing profile edits made by the user take precedence over extraction. The page shows honest source health, progress and coverage.

Deliver this intake/review foundation first. The previously designed full-history reflection report, richer per-person summary layout, and explicit main-photo selection remain subsequent parts of the approved improvement list. They are not silently declared complete by this release. The existing reflection proposal requires its own two-table schema approval; the approval below does not include it.

## Options and chosen architecture

1. Recommended: a shared server-side intake, evidence and review pipeline, fed by source-specific adapters. It gives durable retries, common approval actions and cross-source identity decisions.
2. Reuse Granola's current meeting/name rows for everything. Smaller initially, but forces journal/text identity into meeting fields and cannot reliably remember person-level exclusions or changed source revisions.
3. Put all extraction in EC Pad. Simpler journal setup, but couples message/Granola processing to the writing app and leaves hosted status/review fragmented.

Use option 1. The app remains the review surface; EC Pad is a source, not a second dating app. Keep the existing neutral cards, Dating/Pursuing groups, and collapsible Lessons.

## Source selection and operation

### EC Pad

Expose a Dating connection in native EC Pad settings with journal note/folder selection, status, pause/disconnect and Sync now. Select through LibraryStore's existing snapshot, using library-scoped relative identities; never hard-code the library's filesystem path or read the whole library by default. Source selection is a setup step, not an unanswered prerequisite for building the feature. Plain Markdown files remain unchanged. Folder selections include Markdown descendants except Trash, hidden/internal files and notes explicitly connected to Granola; disclose that inclusion rule.

Read saved source content through LibraryStore's coordinated code path. Debounce autosaves, process a stable saved version, cancel work on library switch/lock/disconnect, and retry after unlock. The connector operates while the Mac app is running and unlocked; do not describe it as always-on. iPhone changes join after their files sync to the Mac. Source status reports that dependency.

Persist a local library UUID and stable document UUIDs, source selections, acknowledged revisions and pending withdrawals in library-scoped Application Support metadata outside the Markdown. Follow in-app renames/moves; duplication gets a new identity. External renames without reliable identity remain unresolved rather than merging by name. Acknowledgments include exact document revision and segment identity; only accepted revisions advance the local export checkpoint.

Pair to the authenticated owner's personal-os account through a short-lived one-time pairing code. The issued long-lived token is scoped to dating intake/status, revocable and stored in EC Pad Keychain. Store only its hash server-side in the source-state record; never reuse a broad app password as a connector credential. Pairing-code hash, expiry, one-use claim, failed-attempt throttling and rotating device-token hash fit the same record. A new pairing invalidates the prior device token for this single-library first version. No tokens or note content in logs. Require HTTPS to the configured Personal OS origin; reject off-origin redirects so an intake token or journal payload cannot be forwarded elsewhere.

Prefer a small independent export controller/client/selection store. The active EC Pad task is modifying AppModel and app startup for Library AI activation. Integration edits must be based on that task's finished work or isolated and reconciled; do not overwrite its working tree. EC Pad's no-desktop/no-real-writing-library verification rules apply; synthetic LibraryStore fixtures only. Source enablement and private-content transfer happen through explicit in-app selection/pairing.

### Granola

Keep direct Granola API ingestion. Replace the ten-day-only repeating scan with a durable cursor and retry queue: enumerate bounded pages, persist received records before advancing enumeration, process records independently, and keep failed work retryable even after it leaves the lookback window. Use an overlap/update sweep for edited meetings where the API supports changed timestamps; if it does not, periodically refetch the recent window and expose the historical-update limitation. A no-result note must still have a processed revision, so it does not consume repeated model calls.

Preserve canonical Granola meeting IDs. A collected EC Pad therapy transcript with the same meeting ID is the same evidence family, not a second witness. Imported Granola files/connected notes should stay on the Granola path. A mixed journal containing a quoted meeting is segmented: the copied meeting portion is linked/deduplicated; original journal commentary is separate evidence. Unclear lineage cannot strengthen a claim.

### Texts

Keep the established 30-minute Mac worker and existing exact-handle imports for approved profiles. Add a separate discovery pass over recent one-to-one conversations (initial default 30 days), including contacts not yet on dating. Exclude group chats, broadcasts, service messages and identities explicitly excluded from discovery. Do not guess gender or dating relevance from names, photos, frequency or response time. A candidate needs explicit dating/pursuit context from the conversation; work/family/friend interaction alone is insufficient.

Process bounded chronological chunks with overlap and a resumable per-thread cursor. Cap model requests per run; show remaining work and date coverage. Discovery may miss subtle context and is a suggestion mechanism, not an assertion that a contact is a romantic partner. Use the existing server-side model provider, with source text treated as untrusted data. Do not import all unknown conversations into DatingMessage. Retain only pending bounded source chunks needed for classification/retry, then minimal supporting excerpts and hashes for suggestions; purge noncandidate raw chunks when classified. Approval enables the existing full thread import for the verified exact handles. A separate explicit backfill can extend beyond 30 days later.

Discovery is opt-in in the source settings and clearly describes the one-to-one scope. The user's requested feature authorizes building it; never silently widen the existing installed worker's scope before the setting is enabled. Unknown phone-to-name mappings remain unresolved; never attach a whole thread using first-name similarity.

## Shared records and processing

Each adapter emits owner-scoped source identity, stable external ID, content hash/revision, actual source timestamp when available, title, safe source link, source kind, canonical evidence-family keys and bounded content segments. Source occurrence date is not an inferred meeting date. Undated journal paragraphs stay undated in the evidence UI; extraction cannot substitute upload time for when something happened.

For compatibility with the existing required DatingSuggestion.occurredAt field, an undated new-format suggestion stores observedAt there; new readers/actions must use the nullable source date and display “Date unknown,” never that compatibility timestamp. Undated evidence remains attached evidence and creates no DatingEvent (whose occurredAt is also required) until an actual event date is supplied. This does not change legacy dated rows or infer metAt.

Record progress before returning acceptance. Intake requests and worker claims are idempotent and transactionally owner-scoped. Cap request and record sizes, split long documents into segments with a declared count/manifest, and do not publish an extraction until all expected segments exist. Segment identities include document revision/hash and index. Every accepted segment is processed, or the source is visibly incomplete. No silent prompt truncation. Deterministic source keys deduplicate retries. Expiring leases, attempt counts, sanitized failures and bounded work deadlines allow recovery; a stale worker cannot publish over a newer revision.

A source-state record stores enumeration/manifest checkpoints; source-record rows store immutable revision segments and processing state. Complete current manifests reconcile edits/deletions; never infer deletion from a failed/partial scan or temporarily unavailable iCloud file. Scope removal/disconnect stops new intake without pretending that existing saved evidence has been deleted. Provide a separate explicit remove-imported-evidence operation, preserving manual edits and person records.

Edited/deleted source revisions invalidate pending suggestions and affected derived summaries immediately after reconciliation. Cache reads validate referenced record revision/status and ownership; do not continue serving removed excerpts from old model output. Reprocess current revisions and replace derived content only after successful validation. Source records are purged when no longer needed: retain current candidate evidence and required retry input, not indefinite full copies of every journal revision. Declared retention limits and cleanup are tested.

Configurable defaults: purge pending raw classification chunks and failed retry payloads after 7 days; abandon incomplete segment manifests after 24 hours; purge superseded raw revisions within 24 hours of invalidation. Cleanup runs daily and at intake, so these are eligibility limits with at most one cleanup interval of delay. Expiration becomes a visible re-fetch-required state, never a successful checkpoint. Once classified, retain only minimal supporting excerpts needed for pending/approved evidence, removing noncandidate raw text immediately. Durable identity mappings, approval/dismissal/exclusion decisions and fingerprints survive payload cleanup; source withdrawal explicitly invalidates retained excerpts and derived output. Test boundary times, failed cleanup retries and reconstruction without resurfacing dismissed evidence.

## Identity and review actions

One candidate can have multiple dated mentions from multiple sources. Strong identity keys are verified normalized phones/emails, explicit account IDs, or a user-approved link. A model-suggested name alone cannot merge candidates or create a global exclusion. Without a strong key, identity is source-scoped and shown as uncertain; possible matches appear for user review. Key comparison remains owner-scoped; hashed keys are not public IDs.

Review cards show name, why it was suggested, date, source badges, short exact evidence excerpts and a link to the underlying owned evidence. A model may summarize but cannot invent quotes/source IDs. All references and quoted substrings are validated before publication. Escape source content and accept only safe source-link schemes. A user-approved journal selection is not permission to execute instructions within its text.

- Add: open a grounded editable draft, then atomically create the person, attach the reviewed evidence and record approved identity mappings. Unknown metAt/endedAt stay null; a mention date never becomes a meeting date. Reuse exact-contact lookup and post-save summary refresh.
- Link existing: explicitly choose an owned profile, add reviewed evidence and record the approved identity. Do not infer that every same-name legacy suggestion belongs to this person.
- Dismiss: suppress these reviewed mentions/revisions. Future materially different evidence may create a new review item.
- Don't suggest again: reversible exclusion for the confirmed source identity and any identities the user explicitly links. Explain source-scoped limitations when identity is unresolved. Provide a small excluded-people list with Restore.
- Removing an existing profile offers a separate choice to stop future suggestions; deletion alone must not secretly infer a global identity exclusion.

Duplicate and concurrent clicks are guarded in both UI and database transaction. Approving two candidates sharing a strong identity resolves to the existing approved person, or returns a reviewable conflict; it never creates two new profiles. Source revision changes during review return a refresh-required response without partial writes.

Serialize all candidate identity mutations for an owner using a transaction-scoped database lock, then resolve every verified alias against that owner's candidates and existing profile handles before writing. Intake, approve, link, exclude, restore and profile-handle changes use the same lock and resolution service; locking just the candidate's primary key is insufficient. Conflicting approved mappings require review rather than automatic merging. Test concurrent candidates with different primary keys but overlapping verified aliases, including approval versus exclusion and handle edits.

## Automatic updates and preserving corrections

New confidently attributed evidence on approved profiles updates source-backed timeline entries and marks derived summaries stale. Refresh from notes/timeline/text changes, not only new message timestamps. Save a source fingerprint with derived insights; coalesce refreshes and compare-and-swap against the source revision/analysis version so old jobs cannot overwrite new work.

Do not let automatic extraction replace the user's name, stage, dates, notes, lessons, flags, remembered facts or handles. Fill only an empty contact field from a verified exact match; uncertain values and substantive changes are suggested. Newly generated lessons/flags are derived suggestions until accepted. Historical generated lists with uncertain origin are left intact and labeled as legacy where relevant.

Track each newly imported timeline event's source and the hash of its last machine-written content. Reprocessing may replace or remove only an unchanged machine-owned event. If the user edited it, retain the edit and flag a source conflict. Manual events and untraceable legacy data are never automatically deleted. Acceptance/dismissal of proposed facts is durable and not undone by refresh.

## UI and source health

Put People to review near the top of Dating when there are pending items. Preserve simple cards and avoid a second kanban board. Keep detailed setup in Imports and sync. Use a compact status row for Texts, EC Pad and Granola, with last successful scan and states: not connected, waiting for Mac, checking, up to date for displayed range, backlog, or needs attention. Separate last attempt from last successful scan and last new data. A source with zero new items can still be healthy; a failed run cannot move lastSuccessAt.

Evidence can be expanded without leaving the inbox. Mobile actions have touch-sized targets and keyboard focus/accessible labels. Pending actions remain mounted during collapse and show nearby recoverable errors. No notification automation or outgoing messages is part of this feature.

## Concrete database proposal — approval required

Add three tables and extend existing dating tables. Exact Prisma implementation follows this contract after approval:

1. **DatingSourceState**: id, owner relation, source kind, library/device scope, enabled/config JSON, cursor/manifest JSON, pairing-token and connector-token hashes/expiry, run/lease/version fields, lastAttemptAt/lastSuccessAt/lastNewDataAt, coverage/backlog counters, sanitized error, timestamps. Unique owner/source/scope; owner/status work-selection index. Owner cascade. No raw credentials in JSON.
2. **DatingSourceRecord**: id, owner relation, source-state relation, source kind, external document/thread ID, revision hash, segment index/count, source date (nullable), observed date, title/link, canonical evidence-family keys, bounded payload/excerpt JSON, extraction result/checkpoint JSON, status/attempt/lease/version fields, timestamps. Unique owner/source-state/external-ID/revision/segment; indexes for source-state/status and current source identity. Owner/state cascade. Complete manifest and current-revision state determine publishability.
3. **DatingCandidate**: id, owner relation, normalized strong identity key or source-scoped key, display name, verified identity JSON, status (pending/approved/dismissed/excluded), nullable approved person relation, reviewed revision/fingerprint, timestamps. Unique owner/identity key and owner/status index. Owner cascade; person deletion sets link null while retaining an explicitly chosen exclusion.

Extend **DatingSuggestion** with source kind (default granola), optional sourceRecordId and candidateId relations, evidence/draft JSON, and source fingerprint. Keep meetingId and legacy rows compatible; new intake uses stable source IDs in the legacy required key only as a compatibility field, never as source semantics. Add indexes on new foreign keys. A candidate can have many evidence suggestions. Source-record deletion cascades only its derived suggestions; candidate deletion clears its reference without deleting legacy evidence. Source owners must agree on all relations, enforced inside every transactional write and verified with tenant-isolation tests; IDs from clients never bypass ownership checks.

Extend **DatingEvent** with optional sourceRecordId and machineContentHash to preserve provenance and user changes (source deletion sets the reference null; processing first reconciles eligible machine-owned derivatives transactionally). Existing manual/legacy rows retain nulls. Add the foreign-key lookup index.

No changes to existing person/message/photo columns, no renamed/dropped tables, no deletion or rewriting of existing profiles/messages/photos. Derived insight freshness can use the existing insights JSON. The schema is three new tables plus additive nullable/defaulted columns, foreign keys, unique constraints and indexes. The separate two reflection tables and avatar selection are not included in this first approval.

### Migration and rollback

The repository currently uses Prisma schema/db-push rather than a migrations directory. After approval, prepare a reviewed additive SQL change and matching Prisma schema; verify the SQL diff and apply on scratch Postgres first. On production, back up schema, apply additive structures, deploy compatible code with new ingestion disabled, then enable selected sources through setup and verify source health. Never use accept-data-loss or force-reset. Existing profile routes remain usable throughout.

Before enabling new intake, adapt old Granola add/link routes to the shared review service; keep unprocessed legacy suggestions visible without guessing identity. Existing per-meeting dismissal stays effective. Avoid a forced historical reimport during rollout. New-source suggestions are only created after compatible readers/actions are deployed.

Rollback: disable new workers/connectors first, pause pending new-format suggestions so an older Granola-only handler cannot process them incorrectly, and revert UI/handlers while retaining added tables/columns and already-approved profile data. No routine rollback drops data. Reenable only after a fixed deployment understands the new records. Any later removal of schema needs separate approval.

## Implementation order and verification

1. Approve the schema contract; implement pure source envelopes, identity/evidence validation, manifest/cursor logic and regression tests with invented data.
2. Persistence and intake authentication, pairing/revocation, job claims, race/failure recovery and source health. Test with real scratch Postgres, never the production .env.
3. Shared review UI/actions and compatibility with legacy Granola suggestions; enforce unknown meeting dates and manual-field precedence.
4. Incremental Granola adapter and Mac text discovery; test no skipped backlogs, no duplicate evidence and honest coverage.
5. EC Pad selection/export adapter in an isolated checkout after reconciling the active task, plus native tests, macOS/iOS builds and temporary library fixtures. Do not alter or activate the owner's live writing library during verification.
6. Browser verification with synthetic profiles: add/link/dismiss/exclude/restore, failure/retry, concurrent review, source edits/deletions, narrow mobile layout and keyboard use.
7. Independent code review, full relevant tests/typecheck/build, then release with source setup clearly labeled. Do not claim the journal is connected until selected and a real accepted source is verified under the user's authorization.

Acceptance requires: a new eligible person from each source enters review exactly once; approval creates one profile with original evidence; exclusion stays excluded across later mentions of the verified identity; manual corrections survive updates; failed/partial scans never claim completion; source removal cannot leave stale private excerpts in visible derived output; EC Pad and Granola copies of a meeting count once. Tests explicitly cover ambiguous same-first-name contacts, shared timestamps, old backfills, changed/deleted notes, iCloud placeholders, token revocation and two-owner isolation.
