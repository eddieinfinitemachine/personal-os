# Daily Call Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship five stable, useful daily CRM recommendations with direct-message context and durable actions.
**Architecture:** Owner-scoped daily selection and preference records power a shared Home/Friends card. A local hourly connector sends bounded evidence for exact CRM identities; AI extracts cited conversation cues while deterministic rules choose people.
**Tech Stack:** Next.js16, React19, Prisma6/PostgreSQL, Vitest, local Node/SQLite readers, existing Claude provider.

User approval: September28 “great - start with teh call sheet” follows the explicit three-table proposal and approval question. Proceed with those additive tables; do not ask again. NewCRM total798 after separately authorized import.

## Ownership and interfaces

Server worker owns schema, SQL, src/lib/call-sheet/{types,policy,service,capture}.ts and API routes. UI worker owns src/components/call-sheet.tsx, component tests and Home/Friends integration. Mac worker owns scripts/call-sheet-sync.ts and its tests. Parent owns extraction helper/tests, scratch DB setup, integration/release checks, plan/spec/todo changes.

Use the following JSON contract (server exports types; ISO timestamps everywhere):
- GET /api/call-sheet => { day:{id,localDate,version}, entries:CallSheetEntry[], sources:{imessage:SourceHealth,whatsapp:SourceHealth}, timezone, hidden:[{personId,name}] }.
- Entry: {id,personId,name,imageUrl,phone,email,reason,topic:null|string,lastContactAt:null|string,lastContactSource:null|string,status:'pending'|'done'|'contacted',cues:EvidenceCue[],cadenceDays:number,interactionId?:string}. EvidenceCue:{kind:'topic'|'follow_up',text,evidence:[{source:'imessage'|'whatsapp',messageId,sentAt,excerpt}]}.
- SourceHealth:{enabled:boolean,status:'not_connected'|'ready'|'error'|'syncing',lastSuccessAt:null|string,error:null|string}.
- POST /api/call-sheet => {dayId,version,entryId,action:'done'|'undo'|'snooze'|'replace'|'hide',days?:number}. Return fresh same GET shape. Undo applies to latest mutation through a returned undo token (undoToken optional on GET/mutation response), not arbitrary earlier history; use {dayId,version,action:'undo',undoToken}.
- POST /api/call-sheet/settings => {source?,enabled?,restorePersonId?,personId?,cadenceDays?,timezone?}. Strict allowlist and scoped validation, fresh sheet response.
- GET /api/capture/call-sheet (resolveCaptureUser auth) => {sources:{imessage:boolean,whatsapp:boolean},people:[{id,name,phone,email,identityKey}],blockedHandles:string[]}. Return no people if both disabled. identityKey hashes stable name/phone/email fields, not lastInteractionAt.
- POST same capture endpoint: {type:'person',personId,identityKey,handles:string[],source,capturedAt,coverageStart,lastContactAt:null|string,messageCount:number,messages:[{guid,sentAt,fromMe,text}]} OR {type:'health',source,status:'ready'|'error'|'syncing',capturedAt,error?:string}. Validate all limits/dates, source enabled and current identity before applying.
- Person POST response {ok:true,extracted:boolean}. Global ready only after all requested people in that source processed successfully. No source ready update on partial failure.
- Parent extractor: export extractCallSheetCues(messages:{guid,sentAt,fromMe,text}[],source:'imessage'|'whatsapp',now?:Date):Promise<EvidenceCue[]> from extract.ts. Server must preserve stats on model error, mark/retry cue extraction separately, and never manufacture evidence. No model call under DB lock. Persist only cues/aggregates, not submitted transcript.

## Task1 — Records and deterministic selection
Files: prisma/schema.prisma; prisma/changes/20260928_call_sheet.sql; src/lib/call-sheet/types.ts; policy.ts; policy.test.ts.
- [x] Add exactly Settings(unique user), Contact(unique user/person, indexed snooze), Day(unique user/date) models from approved spec. Add relations to User/Person; no edits to existing data or columns.
- [x] Write tests for stable ranking, per-user timezone/DST dates, unknown/stale source handling, recent-contact exclusion, cadence overrides, birthday priority and balanced circles.
- [x] Implement policy pure functions with explicit as-of time; no AI ranking. Max5, stable IDs, first-day independent of query order.
- [x] Generate additive SQL by Prisma diff from prior main schema; inspect for exactly3 new tables. Apply to scratch, regenerate client, run policy tests.

## Task2 — Sheet service, actions and capture
Files: service.ts; capture.ts; integration.test.ts; app/api/call-sheet/route.ts; settings/route.ts; app/api/capture/call-sheet/route.ts.
- [x] Write scratch integration tests for ownership, concurrent generation, stale versions, idempotent Done, latest-action Undo and source disable cleanup.
- [x] Owner advisory lock serializes daily sheet writes. Done writes one explicit Interaction and updates Person.lastInteractionAt; Undo deletes only that exact Interaction and recomputes cached time safely without erasing later activity.
- [x] Snooze/Replace/Hide replace only the relevant slot, update preference, and record a bounded undo snapshot. Suppress stale prompts after newer contact evidence arrives. Stable day survives refresh.
- [x] Filter entries whose Person was deleted/archived or identity changed; source disable removes cues in contact state AND daily snapshots, keeping manual preferences.
- [x] Strict capture payload limits, date validation, matched handle checks, identity version and owner revalidation after AI. Preserve preferences during evidence refresh.
- [x] Use private/no-store and existing auth/readJSON/failure patterns; disabled sources reject ingestion. Fresh per-person completeness required, not just source-global status.

## Task3 — Grounded cue extraction (parent)
Files: src/lib/call-sheet/extract.ts; extract.test.ts.
- [x] Mock provider in tests: fabricated IDs/dates/excerpts rejected; source supplied by caller; cap3 cues/240-char excerpts; no medical/psychological inference or instructions obeyed from messages.
- [x] Use existing callClaudeJSON with bounded input and output; derive evidence excerpts from validated input IDs rather than generated quotes; drop stale evidence beyond90days.
- [x] Phrase uncertain open loops as optional topics; a final inbound message is not automatically an unanswered question. No sending or auto-writing personal judgments.

## Task4 — Shared interface
Files: src/components/call-sheet.tsx; call-sheet.test.tsx; src/app/page.tsx; src/app/friends/page.tsx.
- [x] Render compact5-person list with reason, optional topic, dated hidden evidence, Call/Text links, Done/Snooze/Replace/more actions.
- [x] Loading/error/empty/source health states are honest, collapsed settings includes source toggles/timezone/restore/cadence. Pending actions disable repeats;409 refreshes rather than silently replays; Undo uses server token.
- [x] One component on Home and Friends; mounted client fetch avoids making Home fail if sync unavailable. No full transcript UI.
- [x] Component tests cover action recovery,401/409, switching stale requests, phone/email links, evidence hidden until opened and narrow layout semantics.

## Task5 — Local connector
Files: scripts/call-sheet-sync.ts; scripts/call-sheet-sync.test.ts.
- [x] Use existing snapshotDb/direct-reader/WhatsApp-LID helpers. Execution-only CLI guard prevents import side effects.
- [x] GET configured identities first; no enabled sources => do not open databases. Names require exact complete unique Contacts match; exclude handles shared with another person/archived record.
- [x] Aggregate12month direct activity; clip latest90day text to200 messages/person and20k characters. Never include group membership as direct contact. Return last-contact metadata even if no text.
- [x] Send each enabled source/person with identityKey and matched handles. Data checkpoints include digest/version only, are written0600, and failed sends remain retryable. Success metadata resends at least daily even when no new messages.
- [x] Per-source health from actual completed scan; unavailable and empty are distinct. Capture failures and model-pending retries must not be silently checkpointed as complete.
- [ ] Install hourly LaunchAgent from stable sync checkout only after verified deployment, while preserving existing dating jobs. Log counts/status only; delete temporary snapshots even after exceptions. Do not run against production before release.

## Task6 — Verification and release (parent)
- [x] Review agent diffs, run scoped unit/component tests and real scratch SQL concurrency tests.
- [x] Production build/typecheck, full suite with4workers. Synthetic browser verifies stable5 rows, Done/Undo, Snooze/Replace, evidence, source failure and390px.
- [ ] Read-only code/security review; fix material findings and rerun affected checks.
- [x] Private schema-only production backup; apply reviewed approved additive SQL transactionally; verify no Prisma diff.
- [ ] PR, attach artifact, pass preview check, merge exact tested head, verify EC production aliases/auth.
- [ ] Enable both sources for Eddie (already authorized), advance clean stable sync checkout, install hourly job, and verify actual background run. First run may be batched but complete evidence must be available for generated sheet.
- [ ] Verify five live recommendations with supported evidence, record aggregate outcomes privately, no synthetic production people/messages.
