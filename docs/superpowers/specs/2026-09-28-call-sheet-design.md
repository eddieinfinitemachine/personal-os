# Daily Call Sheet

Status: product direction approved by Eddie; read-only message access verified after his Full Disk Access change. Database additions still await approval. No feature implementation, schema mutation, cloud message import or new scheduled job has occurred.

## Purpose and approved scope

Eddie wants five people to check in with each day, inspired by a call sheet. Include friends, family and professional relationships from his existing personal CRM. He approved using iMessage and WhatsApp to make the recommendations relevant. The prior proposed product is a Home section with a reason, last contact, conversation topic, Call/Text, Done, Remind me later and Replace.

## Findings from the current app

Person already contains name, phone/email, relationship strength, circles, starred flag, birthday, notes and lastInteractionAt. Interaction records encounters and check-ins. Home is authenticated; all new queries/actions must be owner-scoped. Existing dating readers can safely select matching direct iMessage and WhatsApp threads, including verified WhatsApp LID mappings. Reuse the readers, not the dating tables or discovery switch.

Read-only CRM audit September28:510 active people;262 have usable nonshared identities after stored phone/email plus exact full-name matching against the current local Contacts cache.28 handle values mapped to multiple CRM people and were excluded. This is identity coverage, not confirmed conversation coverage.

Initial message reads were denied. After Eddie confirmed enabling Full Disk Access, the same execution context successfully read temporary copies of both databases. Direct-thread activity matches179 CRM people on iMessage and29 on WhatsApp (overlap not counted as unique people).26 matched contacts had activity in the past7days;179 had message activity more than a day newer than their stored CRM date or a missing CRM date. Both sources include September28 activity. Reviewed bounded conversation excerpts for8 initial contacts and a4-contact WhatsApp-focused sample; this was not a full semantic review of all conversations. No personal excerpts are stored in this spec or git. Temporary database copies were removed. Installed-worker permissions still require verification during release.

The legacy imessage-stats script can count group chat activity as personal contact, so its cached lastInteractionAt is not reliable direct-conversation evidence. Do not run that script as the new connector.

## Recommended approach

Use transparent rules to select people, with an AI pass restricted to extracting useful, source-backed conversation cues. A simple oldest-contact list would overpromote missing history; a wholly AI-selected list would be difficult to explain and unstable. The hybrid gives understandable recommendations plus relevant context.

Show a compact Today’s Call Sheet section on Home and the Friends page. Five rows, stable for the user’s local day, with progress. Default timezone America/New_York for Eddie; store an IANA timezone so date boundaries and snoozes remain correct. Generate when first opened each day; the Mac worker refreshes source evidence hourly while awake. No push/email reminder or Codex automation in this release.

Each row:person/photo, a one-sentence reason, last known direct contact and source, and an optional concrete topic with dated evidence behind a disclosure. Do not invent a topic when evidence is absent. Hide message snippets until requested. Fewer than five is acceptable if insufficient eligible people exist.

Actions:Call/Text open the contact channel and do not mark a conversation complete. Done explicitly logs a check-in through the existing Interaction flow; atomically mark the row done. Remind me later defaults to7days; Replace rotates the current slot and puts that person on a7-day recommendation cooldown; Don’t suggest hides until restored from call-sheet settings. Undo restores the prior call-sheet action and only the exact check-in created by that action, never other interactions. Done stays visible that day. The other four slots stay fixed. A new conversation after generation suppresses outdated prompts for that person rather than continuing to claim they are overdue.

## Message evidence and matching

Start with existing active CRM people only. Use normalized stored contact handles and unique exact full-name Contacts matches; never fuzzy or first-name auto matching. Any handle shared by multiple people is excluded from evidence. Revalidate person ownership, current name/handle fingerprint and archive state before saving async results. WhatsApp LIDs require the existing conflict-free ContactsV2 mapping; never match WhatsApp display names alone. Directory and raw SQLite snapshots stay on the Mac.

Read direct threads only. On initial connection obtain up to12months of activity timestamps for matched contacts and up to90days of text context, bounded to the latest200 messages/person and an explicit text-size budget. Subsequent hourly runs rescan recent text with overlap and deduplicate by source+message identifier. Track per-source completeness, last-success time and coverage start. A partial/failed run must not advance completeness or erase earlier successful evidence. Ensure temporary snapshots are removed on every exit path.

Send only bounded matched context to the authenticated owner-scoped call-sheet extraction endpoint using the existing AI provider. Treat message text as untrusted content, never instructions. The model may propose a topic, explicit promise or question, with supporting source message IDs/dates and short excerpts. Verify evidence IDs against the submitted context before saving. Do not store full message bodies as a new archive. Persist aggregates and at most3 brief evidence snippets/person, each capped at240characters; expire message-derived cues after90days and replace on re-extraction. Deleting a CRM person cascades their insights; disabling a source stops transfer and removes its stored excerpts/cues.

The latest inbound message alone does not mean Eddie owes a reply. Require an explicit unresolved question or commitment in the supplied exchange; when resolution is unclear, phrase as a possible follow-up. Do not label reciprocity, friendship quality or someone’s feelings from message counts. No calls/texts are sent automatically.

## Recommendation rules

Eligible:active, not excluded, not snoozed, no cooldown, no verified direct conversation or explicitly logged check-in within7days. An explicit user-set due follow-up may override the cooldown but must show its reason. Never infer an overdue interval from unknown or stale history.

Priority tiers:explicit overdue follow-up; imminent birthday; important relationship beyond its cadence; other established relationships beyond cadence; occasional reconnect where the last known exchange is documented. Initial editable cadences:starred/close30days, strong60days, casual90days, weak180days. Unspecified strength defaults90days only if prior contact is documented. Age-relative score within tiers; stable person ID as final tie-break.

Use existing explicit circles/tags to promote a balanced mix of friends/family/professional contacts when enough eligible people exist. Do not infer relationship categories from message content. Unknown categories stay eligible; no rigid category quotas or pressure to call distant contacts merely to fill slots. At most two of five from one category when alternative eligible categories exist, with explicit due follow-ups exempt.

Source health is visible. Message-based selection requires a successful scan within48hours; otherwise show recommendations from independently verified manual encounters with a warning that messages are out of date. Legacy lastInteractionAt can display as an imported CRM date but cannot alone support “you have not spoken since” or suppress a manually known more recent encounter. Source failure must not make unknown-history people rise in rank.

## Proposed additive database changes — approval required

Three new owner-scoped records; no changes to or deletion of current CRM/message data:

1. CallSheetSettings:unique userId; timezone, enabled-source flags and source health/checkpoints in validated bounded JSON, updatedAt. Source failure and success states tracked separately.
2. CallSheetContact:unique(userId,personId), foreign keys to user and Person with cascade; identity fingerprint, validated per-source activity/cues JSON, cadence override, snoozedUntil, excludedAt, lastSuggestedAt, lastCompletedAt, updatedAt. Index(userId,snoozedUntil). This is also the durable preference record; a source refresh must not overwrite preferences.
3. CallSheetDay:unique(userId,localDate), timezone snapshot, version, bounded entries JSON (maximum5 visible slots plus bounded replacements/action history), createdAt/updatedAt. Each entry stores stable ID, personId, dated reason/evidence snapshot, status and optional exact Interaction ID. Read joins must recheck person ownership/archive/exclusion, and suppress entries for deleted people. No cross-user reads through JSON IDs.

Persist one daily sheet under a user-scoped transaction lock. Actions use version+entryID and return conflict rather than overwriting newer changes. Done and its Interaction write are atomic and idempotent. Contact evidence saves preserve user preference fields. Authenticated capture endpoint validates source timestamps, message counts, size and identity version. No unauthenticated endpoint, broad message discovery or shared-list exposure.

Migration adds only these tables, relations and indexes; apply first to scratch PostgreSQL. Production backup and transactional migration follow approval. Rollback disables call-sheet UI/worker and retains new tables so choices/history are not lost; dropping new tables is a separate destructive action. No schema file or production migration changes until Eddie approves.

## Verification and delivery

Test source matching, conflicting handles and WhatsApp LIDs, group exclusion, Apple timestamp units, stale/unavailable sources, evidence validation and prompt injection handling. Test daily determinism/timezone midnight/DST, category balancing, unknown history and cooldowns. Scratch PostgreSQL covers owner boundaries, concurrent generation, idempotent Done/Undo, stale action versions and person deletion. Browser tests cover five-row flow, replacing/snoozing, evidence disclosure, mobile layout, and failure/retry.

Read-only live coverage was verified after the user corrected Mac access. Verify the installed worker runtime during release and report access failures explicitly. Release authenticated web UI, install the hourly connector and verify a real run and a grounded sheet. No personal message samples in git or general logs; retain only aggregate audit findings in this document.
