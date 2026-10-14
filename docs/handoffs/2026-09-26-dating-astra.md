# Dating feature — Astra handoff

## Instagram photo completion for Tia and Olivia — September 27

User replied "yes livschiff", confirming Tia @tuna_s_m and specifying Olivia @livschiff. Added one cropped profile-photo screenshot to each existing profile through the app clipboard-paste UI. Instagram @livschiff displays Olivia Schifferli; app name remains Olivia Schiff. Source captions saved for both. Owner-scoped readback verified exactly one photo each, total 19 profiles with photos; Olivia avatar persisted after browser reload. No downloads, new profiles, name changes, follows, or messages. Closed Instagram research tab and kept dating overview open. Remaining blank photos: Rena, Esi Alkutan, Anjoum, Margot Langman.

## Instagram photo follow-up — September 27

User confirmed Margaux, Olivia and Tia are on Instagram. Rechecked the signed-in @ec Following list using its search. Margaux is @margoxf, display name Margaux Forcione (existing app spelling Forciene). Added one profile-photo screenshot through clipboard paste and verified one saved photo; caption includes handle and observed name. Did not rename the profile. Total now 17 photos/profiles.

Tia candidate @tuna_s_m, display name tiA, appears in @ec Following; no surname on profile. Asked user to confirm before attaching. Instagram tab 1407952824 is kept as a handoff at https://www.instagram.com/tuna_s_m/. Olivia searches within Following for Olivia and surname substring sch did not establish her account. Asked user for her handle. Pending async question bundles Tia confirmation and Olivia handle; no answer yet at this note. Browser Chrome id1; result EC tab1407952792 kept open at Margaux profile. Screenshot/paste method remains authorized, no downloads.

## Instagram photos — September 27

User requested images for the saved women, then explicitly chose screenshots instead of downloads. Added exactly one cropped Instagram profile-photo screenshot to each of 16 existing profiles through the app's image-paste UI: Noa Cohen (@noacohen51), Elana Katz (@elanakatz), Paloma Suarez (@_palomasuarez), Natascha Picard (@natipicard), Diana Krantz (@dianakrantz), Lindsey Sagrera (@lindseysagrera), Jordan Gruber (@jordangruber), Alex Zaoui (@alexandrazaoui), Livvie Francis (@livviefrancis), Shana Azria (@shanaazria), Jamie Sutton (@jamiesutt), Katie Kaplan (@katiebkap), Lior Keren (@lior__keren), Maddie Smoot (@maddiesmoot), Jara (@jaracadabra), Sunny Smith (@sunny.s.smith). User explicitly confirmed the Jara and Sunny handles before their uploads. Other matches used exact names/handles, existing Following status and mutual context; Diana's handle was previously verified. No facial-recognition matching performed.

Verified owner-scoped production readback: 16 profiles with 16 photos, no duplicates. Added source captions to these photos: Instagram profile screenshot, handle, and 2026-09-27. Existing Instagram fields were not changed. Production overview verified all four current-person images loaded. No schema/code changes, messages, follows, likes, or story views.

Seven profiles remain blank due to no clear match: Rena, Tia Mearns, Esi Alkutan, Anjoum, Margaux Forciene, Margot Langman, Olivia Schiff. Exact-name search Esi/Margaux returned no results; Margot returned fan/unrelated accounts; Olivia had multiple same-name accounts without mutual evidence; Tia's inspected @tiamearnsx was not followed and unconfirmed; Anjoum/Rena lacked sufficient identity evidence. Do not guess these accounts.

Initial attempt bundled four avatar image assets before user's screenshot preference; all four owned temporary bundle directories were deleted and none used for uploads. File chooser upload failed with Chrome file-access permission; screenshot-to-clipboard paste worked without setting changes. Browser connection later stalled twice and was recovered by resetting CUA; nine existing uploads were verified before continuing. Instagram research tab closed; updated dating overview tab kept open. Saved screenshot photos are low-resolution Instagram avatars, not full-size post images. Automatic Instagram discovery/import is still not implemented.

## Current direction — automatic source intake and approval inbox (September 27)

Eddie clarified that the dating tool should generate itself from texts, journal, and Granola, and suggest newly appearing women for approval/addition or dismissal. New journal writing will be in EC Pad (`/Users/eddie/Code/active/ec-pad`), not an assumed continuing legacy journal-file export. No new source scanning, schema changes, or implementation was performed during this audit.

Verified current setup: Mac message LaunchAgent is loaded, runs every 1800 seconds, last exit code 0, recent log has successful imports/summary refreshes. It only reads approved dating profiles' matched 1:1 iMessage/WhatsApp conversations; it does not discover unknown people. Granola daily cron is configured at 12:00 UTC, scanning ten days with max six qualifying meetings; recent production execution was not independently checked this turn. Granola can file matched people automatically and queue new/ambiguous people for Add her / Add to / Dismiss. Journal organize only processes existing profile notes once, not new journal entries. Existing cross-person patterns do not read full messages or persist the report.

Gaps: no EC Pad connection or text candidate discovery; Granola cron lacks durable catch-up cursor, skips changed already-processed meetings, can miss transcript-only mentions and truncates long material. Dismissal is per source meeting/name, not a durable person-level exclusion. Removing a profile does not prevent future suggestion. Separate suggestions can produce duplicate profiles. Existing approval sets metAt to mention date incorrectly; new approval drafts should leave actual meeting date unknown unless supported.

EC Pad read-only code review: plain Markdown library shared by native/web clients, default ~/Documents/Writing. Its Therapy Notes collection is implemented separately; tasks/todo.md explicitly leaves Personal OS journal extraction pending. No EC Pad files or its active Codex task were modified. Avoid counting EC Pad copies of Granola transcripts as independent evidence. Exact journal note/folder selection should be an explicit source setting, not the entire writing library by default.

Recommended next design: one People to review inbox, with dated evidence from source texts/EC Pad journal/Granola. Add opens a prefilled grounded profile; Link existing resolves duplicates; Dismiss hides a suggestion; Don't suggest again persists a reversible identity-level exclusion. Existing approved profiles update from new source evidence; manual corrections retain precedence. Candidate identification should use explicit dating context, not names/gender/message frequency alone. Source health, last successful scan, backlog and errors visible. Full-history reflection remains a separate pending design. Durable source progress, cross-source identities, and exclusions need a concrete schema proposal and approval under /Users/eddie/AGENTS.md before schema work.

## Latest release — separate dating groups and collapsible lessons (September 27)

PR #24 is merged and live: https://github.com/eddieinfinitemachine/personal-os/pull/24. Feature commit `1ff8e9f5cfbff9207161228406c66627828716fa`; main `e617308991198ae6db35872640d7657e7c079de3`. EC production `dpl_7Djk1okT3jC6iFhPhAncFkKbCFcZ` is Ready with both internal.eddiecohen.com and kaizen.eddiecohen.com aliases confirmed.

Current people are grouped into Dating (including exclusive), Pursuing, and Paused, showing only nonempty groups. Simple cards, search, and Past relationships remain. Lessons starts collapsed and remembers the browser preference under `personalos:dating-lessons-open`. Collapsing preserves pending pattern requests and generated results; unavailable browser storage is handled safely.

Verification: focused 33 tests and full 506 tests passed; 41 opt-in integration tests skipped. Typecheck and production build passed. Independent review approved. Authenticated production checks verified separate Dating/Pursuing sections, lesson expansion/collapse and persistence after reload, and 390px layout without overflow. Unauthenticated dating page/API still redirect to login on both domains. One React hydration #418 warning appeared during rollout on an existing tab; a fresh post-rollout tab had no warning/error logs. Its cause was not established; no speculative fix was made. Existing build warnings remain. Real iPhone/VoiceOver untested.

No schema, production data, or sync-worker changes. Live Mac sync checkout stays at `3c1dbd3`. Original tracked workspace unchanged. Feature worktree `/Users/eddie/Code/.worktrees/personal-os-dating-sections`; temporary dependency symlink removed, debug browser tab closed, viewport reset, updated result tab kept open. The broader dating-reflection design still awaits explicit schema approval; this UI request does not authorize its two new tables.

## Latest release — paragraph add, automatic summaries, WhatsApp identity fix (September 27)

PR #23 is merged and live: https://github.com/eddieinfinitemachine/personal-os/pull/23. Main `3c1dbd37da2b0a634d1b49f1b9650954ae6af3b8`; EC production `dpl_3gJDTSxs946XJcys6Qeb9tRa2Rn1` is Ready and both domains are confirmed. Authenticated production browser verified paragraph entry and Diana's coverage; the user's original open editor tab was untouched.

Add person now accepts a paragraph, prepares a grounded editable draft, keeps the original paragraph, checks exact full-name owner-scoped CRM contacts, and leaves unknown dates/details blank. Pursuing replaces Talking everywhere displayed. New profiles with notes generate a summary after save; saved results poll into open pages. Mac imports refresh derived summaries automatically without overwriting manual notes. Coverage explicitly lists analyzed iMessage/WhatsApp counts, notes/timeline, and truncation.

Diana Krantz: saved user-supplied +447590108584 and verified @dianakrantz from the personal @ec Instagram account (already followed). Initial normal sync found 15 iMessages and no WhatsApp. Fixed the reader to resolve WhatsApp privacy IDs through unambiguous ContactsV2 phone/LID mappings: production now has 3,254 WhatsApp texts +15 iMessages. Refreshed summary at 2026-09-27T06:18:09Z used newest1,541 messages (1,537 WhatsApp +4 iMessage), 3timeline entries and existing notes. All3,269 messages are saved, but analysis remains newest3,000/80,000chars; UI is honest about this. No audio/media transcriptions were imported.

Operations: live sync worktree is now clean at main3c1dbd3. The original LaunchAgent plist was restored byte-for-byte and its30-minute interval verified. A temporary targeted dry-run was used; an earlier setup assertion failed before argument modification, allowing one normal run which backfilled other already-saved people's mapped WhatsApp histories as well. Eddie was told. No OS privacy permissions changed. The normal job resumed and successful automatic summary refreshes were observed after production deploy. Local terminal database reads remain blocked by Full Disk Access; existing background sync has its established access.

Mac contact lookup uses the existing saved Contacts export (September9), checks exact full names and duplicate dating profiles, and serializes automatic handle assignment. It does not refresh the export; newly added Mac contacts may require refresh of that source. Newly mapped WhatsApp history backfills once, then uses private hash-only atomic checkpoints. Failed checkpoints retry without skipping history.

Remaining actual limitation: there is no persistent personal Instagram connection to the hosted app. Signed-in browser lookups work within this task, but the app's automatic profile draft only uses paragraph handles and saved CRM Instagram records. Do not describe Instagram auto-search as implemented. Earlier historical no-Instagram-lookups instructions are superseded by Eddie's current explicit request, within relevant profiles only. No other browser Instagram data or DMs were imported.

Verification:523tests passed (including real scratch-Postgres owner/auth/concurrency/insight tests);22unrelated opt-in tests skipped. Typecheck/build passed. Browser tests with invented people covered explicit/unknown fields, dates, retry protections, original context, Pursuing, mobile390px/nooverflow, save/navigation and automatic initial summary. Review caught/fixed stale contact transfer when switching to manual entry, duplicate-name/racing contact resolution, empty targeted-sync IDs, and older newly accessible WhatsApp history. Local preview fixtures removed, preview tabs closed, viewport reset, local preview server and scratch PostgreSQL stopped. Diana's production page was left open as the result. No database schema changes. Source/implementation notes: feature worktree docs/handoffs/2026-09-27-dating-natural-add.md.


## Latest release — overview usability, September 26

Eddie asked to choose improvements and implement them. PR #22 is merged and live: https://github.com/eddieinfinitemachine/personal-os/pull/22. Main `26f4c528a6ba2b2c3a8bc6776563767c5e721f16`; EC production `dpl_4zQiqA3WdRkkN79xwb7fthqnw7gy` is Ready with both app domains confirmed and unauthenticated dating routes gated.

Added name search across current and past people with accent/Unicode/word-order handling, automatic past matches, clear/Escape and saved-disclosure restoration. Past cards follow ended/met dates instead of new import timestamps. Refreshed names/photos remain visible after status changes. The main action says Add person; imports/sync live in a collapsed native disclosure that preserves mounted work. Pending reviews show counts and nearby errors; add/dismiss/link requests recover from failures and block duplicate/stale callbacks. Review controls have 44px targets. Picker copy now correctly describes only the selected note being filed.

Verification: 412 tests passed, typecheck/build passed, independent review approved. Synthetic local browser checks confirmed search, collapsed-view restoration, preserved draft/import date, 390px fit, 44px review targets and clean console logs. Tests verify import progress survives closing/reopening the tools. Fixtures removed, preview closed, viewport reset, local server/PostgreSQL stopped. No schema or production data changes, no real imports/AI calls, and Mac sync untouched. Real iPhone/VoiceOver remain untested.

Worktree `/Users/eddie/Code/.worktrees/personal-os-dating-overview-usability` is clean at `6750059`. Remaining real-data import/journal attribution checks are still conditional on Eddie triggering those operations.


## Latest release — simple people cards, September 26, 22:56 EDT

Eddie found the board confusing and explicitly chose simple cards. PR #21 is merged and deployed: https://github.com/eddieinfinitemachine/personal-os/pull/21. Main `a064531b7b0c0fe47309947a0a9b1b7b6f148242`; EC production `dpl_9tiU1yW8bXu5YHmY4mrBdL2SoSHK` Ready with kaizen.eddiecohen.com and internal.eddiecohen.com aliases confirmed.

The dating overview now uses a responsive current-people grid and a collapsed Past relationships section. Cards show name, private avatar/initials, status and recorded dates. Columns, drag-and-drop, Board/Rows switching, ratings and activity snippets are gone. The menu retains status changes and confirmed deletion, blocks duplicate pending actions, and restores failed changes. No schema changes, production data writes, or sync-script changes.

Verified: 394 tests passed, typecheck/build passed, independent review approved. Browser testing used six invented profiles in a local scratch database: desktop and 390px layout, no horizontal overflow, 44px action targets, persisted status changes, past disclosure and profile navigation. No console errors. Fixtures deleted; local server and scratch PostgreSQL stopped. Real iPhone/VoiceOver untested. Worktree `/Users/eddie/Code/.worktrees/personal-os-dating-simple-overview` is clean at `5327bbe`.


## Latest release — date-aware identity matching, September 26, 22:42 EDT

PR #20 is merged and deployed: https://github.com/eddieinfinitemachine/personal-os/pull/20. Main commit `c541ce32bd84c70ef05cf6393018f84c4a3d26eb`; EC production deployment `dpl_BAEre3kbQTgkTVuocFvraUTQd2sc` is Ready and serves both app domains. Unauthenticated `/dating` and `/api/dating` redirect to login on both domains.

The updated handoff's first priority is fixed: Granola receives each person's relationship/activity dates, and similar-name matches must have supporting source/date evidence. Ambiguous matches remain suggestions instead of being reattached by name. Manual Add her / Add to… files only the selected note and prevents concurrent double attribution. Review cards include the year. Earlier card-delete and reliability/privacy findings shipped in PR #19; PR #18 already simplified the detail page.

Verification: 387 tests passed (including 9 real-PostgreSQL identity tests), plus six existing Granola transaction tests separately; typecheck and build passed. Three live Claude checks used invented people/notes and passed contemporary, historical, and ambiguous examples. All database writes for verification were on isolated local PostgreSQL; test rows were removed and the scratch server stopped. No schema changes or production data repair/import/organization ran. Synthetic model checks are not a complete evaluation of real notes.

Implementation and limits: `/Users/eddie/Code/.worktrees/personal-os-dating-person-matching/docs/handoffs/2026-09-26-dating-identity.md`. Worktree branch `codex/dating-person-matching` is clean at `07f6eb6`; remote main is `c541ce3`. Original `claude/board-tags` checkout and live sync checkout/job remain untouched; sync script did not change.

Remaining: after Eddie invokes journal organization or Import since…, inspect real attribution and event dates. Keep disabled Claude routines off. No Instagram lookup/scraping. This release deliberately prefers manual review where dates or identity remain uncertain. Real iPhone/VoiceOver remain unverified.

Earlier sections below are historical and superseded by these releases where they describe outstanding fixes.

## Update after receiving the prior session's handoff — 22:03 EDT

The supplied handoff was read and reconciled with live state. Its in-flight person-page simplification is now complete:

- [PR #18](https://github.com/eddieinfinitemachine/personal-os/pull/18), `feat(dating): simpler person page with an editable name`, was already merged at 21:59:53 EDT. Merge commit: `b5ba3e6db7b6c774b4fc1d324cf23b6dbb17c2c6`; reviewed feature head: `5205af0de7f8c344c0e3bc4ef09ecf0cd9c93ffb`.
- Feature checkout: `/Users/eddie/Code/.worktrees/personal-os-dating-simple`. No source edits were made there in this verification pass.
- Independently reran `pnpm typecheck`, `pnpm test`, and `pnpm build`: all passed; **23 test files / 321 tests**. The build emits the existing Next.js middleware-convention deprecation warning.
- Vercel production deployment `dpl_EyVAS4cD2F2hoZR58LXGHqHiZENZ` is Ready in team `ec-efed32ac`; its aliases include both `kaizen.eddiecohen.com` and `internal.eddiecohen.com`.
- A fresh authenticated browser tab visibly showed the Rename control, one-line dates, Dictate → Summary → Timeline, and collapsed More. The existing user tab still had the older loaded version and an event editor open, so it was neither reloaded nor changed. No rename or other production write was performed for verification.
- A limited read-only journal sanity check on the visible profile found its three dated journal events matched the explicit dates in the journal text observed earlier. This does not validate organizing every profile or the full Granola backfill.

Additional operational context **reported by the supplied handoff**, not independently reverified here:

- The sync worktree is used by the active launchd job `com.personal-os.dating-messages-sync` every 30 minutes. Its `.env` is linked to the main checkout's production configuration. Treat this worktree as an operational dependency, not an implementation scratch area.
- Previous successful import counts were 7,474 iMessages and 288 WhatsApp messages; the handoff reported 22 profiles and 11 with saved handles. Do not treat these as current counts.
- The real Vercel project is team EC (`ec-efed32ac`); the Infinite Machine duplicate project is empty.
- Prior Granola cloud routines were deliberately disabled. Leave them off; use the existing API integration.
- Photos are manually added. No Instagram scraping/name-based lookup was requested for this takeover.
- Local `.env` points to production Neon. Future write testing must use a separate verified scratch database.

Next work remains conditional: sanity-check the complete journal organization/backfill after Eddie runs them, and resolve the requested-but-unbuilt board-card delete feature with the user. The supplied handoff explicitly lists card-level delete as an open question. The message sync script did not change in PR #18, so no scheduled-job checkout update was necessary. The earlier review findings below remain outstanding; this follow-up did not fix them.

The remainder records the earlier **af4d991** analysis. Its code links target the sync checkout, which may later advance; use the recorded commit when comparing exact line references. The latest person-page layout supersedes the earlier UI description.

Prepared September 26, 2026. Scope: understand the new dating feature and prepare a takeover; no application fixes, database changes, deployments, sync jobs, or AI calls were performed.

## Start with the right checkout

The task workspace is **behind the newer dating implementation**:

- Task workspace: `/Users/eddie/Code/active/personal-os`, branch `claude/board-tags`, commit `1ba7700a2929935a0b4c891ddb82a817a331134d`.
- Reviewed newer baseline: `/Users/eddie/Code/.worktrees/personal-os-sync`, detached HEAD `af4d99176df9127aab2b0d59982645e3b84ecac9`.
- That commit equals the locally available `origin/main` and merges the WhatsApp sync work. Remote freshness was not checked with a fetch.
- The newer checkout was clean before and after checks. The task workspace already contained untracked `.claude/` and a `.textClipping` file; they were left alone. This handoff is newly added and uncommitted.
- Other existing worktrees cover dating photos, board view, one-page layout, suggestion linking/quick add, WhatsApp sync, dictation, and Granola API. Do not independently reimplement or blindly cherry-pick those already merged features.

The authenticated app was accessible at [Dating](https://internal.eddiecohen.com/dating). Its observed profile page had photos and the one-page layout; the original task checkout still had tabs. The observed UI is consistent with the newer work, but the precise deployed commit was not verified. The README's Vercel URL opened a separate, unauthenticated session.

Before implementation, check current remote/main and worktree ownership, then use an isolated branch based on the intended current baseline. Do not reset or switch the user's original workspace to make it match this report.

## Product behavior now implemented

- **People overview:** board or row view, grouped into talking/dating/exclusive/paused/ended; search, stage movement, activity/date summaries, photo avatars, and a quick-add sheet.
- **Person page:** one scrolling page containing key dates, photos, dictation, saved AI insights, remember/flag lists, relationship charts, editable timeline, notes, details/Instagram, and collapsed message history.
- **Message ingestion:** paste timestamped WhatsApp exports or simple speaker-prefixed lines; a Mac script also imports matching one-to-one iMessage and WhatsApp Desktop text threads. No messages are sent to contacts.
- **Dictation:** browser speech recognition or typed text becomes a proposed set of changes. The user can deselect proposed fields/events before saving.
- **Granola:** founder-only API sync screens meetings, auto-files onto existing dating profiles, and creates suggestions for unknown people. Suggestions can be added as new profiles, linked to an existing profile, or dismissed.
- **Organize notes:** AI converts an existing journal into dated events, flags, details and lessons. This is automatically applied after invoking the action, unlike reviewed dictation. It preserves the original notes.
- **Insights:** a per-person thread read is stored on the profile. Cross-person patterns and a photo-assisted “Your taste” result are returned to the page but not persisted.

## Code map

All links below target the **newer reviewed checkout**.

| Area | Main files | Responsibility |
| --- | --- | --- |
| Server page loading | [Overview](/Users/eddie/Code/.worktrees/personal-os-sync/src/app/dating/page.tsx), [detail](/Users/eddie/Code/.worktrees/personal-os-sync/src/app/dating/[id]/page.tsx) | Session gate, scoped Prisma reads, serializable DTOs; detail loads latest 200 message bodies plus all message timing/direction metadata. |
| UI | [Dating home](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/dating-home.tsx), [person detail](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/dating-detail.tsx), [people board](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/people-board.tsx) | React local state, fetch mutations, router refresh/navigation. Detail remains a large component with several embedded sections. |
| Supporting UI | [Quick add](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/quick-add.tsx), [link picker](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/link-picker.tsx), [photos](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/photo-strip.tsx), [dictation](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/dictate-card.tsx), [sync controls](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/granola-sync.tsx) | Entry forms, fuzzy match selection, uploads, proposal review, bounded sync/organize loops. |
| Pure domain logic | [dating.ts](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating.ts), [board helpers](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-board.ts), [name matching](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-match.ts), [photo helpers](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-photos.ts) | Normalization, transcript parsing, statistics, dates, proposal validation, matching and display calculations. |
| Persistence and filing | [Server helpers](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-server.ts), [filer](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-filer.ts), [organizer](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-organize.ts) | Editable-field allowlists, DTOs, message ingest, AI proposals, per-person transactions, suggestion add/link. |
| Integrations | [Granola sync](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-granola.ts), [Granola client](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/granola.ts), [Mac script](/Users/eddie/Code/.worktrees/personal-os-sync/scripts/dating-messages-sync.ts), [message readers](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-message-readers.ts) | External reads and capture ingestion. Mac readers query temporary SQLite snapshots. |
| Shared infrastructure | [Claude transport](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/claude.ts), [user image storage](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/user-image.ts), [schema](/Users/eddie/Code/.worktrees/personal-os-sync/prisma/schema.prisma:1152) | Anthropic calls, image conversion/storage, PostgreSQL models. |

## Data and API contracts

Next.js App Router + React + Prisma/PostgreSQL. Every dating model carries `userId`:

- `DatingPerson`: stage, normalized phone/email handles, Instagram, dates, notes, arrays of facts/flags, lessons, cached insights, last-message timestamp.
- `DatingEvent`: dated timeline entry, kind, notes, optional vibe, source and external ID. Unique `(userId, externalId)` supplies import markers.
- `DatingMessage`: text, direction, timestamp and source (`imessage`, `whatsapp`, `paste`). Unique `(userId, externalId)`; WhatsApp IDs use a `wa:` prefix.
- `DatingSuggestion`: meeting/name summary, status, optional linked person ID. Unique `(userId, meetingId, name)`; name uniqueness is database case-sensitive even though matching helpers normalize names.
- `DatingPhoto`: person/user, URL, caption, creation time. Deleting a person cascades database children; its route also attempts Blob cleanup.

Session endpoints under `/api/dating`:

| Endpoint suffix | Methods and effect |
| --- | --- |
| `/` and `/[id]` | GET collection; POST profile; PATCH/DELETE person. |
| `/[id]/events`, `/events/[eventId]` | POST event; PATCH/DELETE event. |
| `/[id]/messages`, `/[id]/messages/meta` | GET/search/paginate and POST pasted chat; GET chart metadata. |
| `/dictate`, `/dictate/apply` | POST AI proposal without writes; POST selected proposal, revalidated against owned people. |
| `/[id]/insights`, `/patterns` | POST individual cached analysis; POST transient cross-person text/photo analysis. |
| `/[id]/organize`, `/organize-all` | POST one journal; GET pending count / POST a batch of three. |
| `/granola/sync` | POST one founder-only batch; UI loops using `nextSince` and `remaining`. |
| `/suggestions/[id]/{add,link,dismiss}` | POST each action; add/link gather pending suggestions with the same name. |
| `/[id]/photos`, `/photos/[photoId]` | GET/POST photos; PATCH caption / DELETE photo. |

Bearer endpoints `/api/capture/dating` (GET targets/cursors, POST messages) and `/api/capture/dating/notes` (POST up to 20 meetings) resolve capture credentials to a user. The daily `/api/cron/dating-granola` job uses cron authentication, a 10-day lookback, and at most six candidate meetings per invocation. UI sync defaults to four candidate meetings per batch and a 200-second budget before starting another call.

Middleware removes caller-supplied `x-user-id`, verifies the session and supplies its own user ID. Bearer/cron routes do their own authentication. Profile ownership is generally checked before related queries; some internal helpers intentionally rely on the caller's prior ownership check. Preserve that contract during refactors.

## Findings to prioritize

These are analysis findings, not implemented fixes. Except for the pasted-chat reproduction below, the failure scenarios were established by reading code and have not been exercised against production.

### 1. P1 — Dating photo bytes use public storage URLs

[user-image.ts:105](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/user-image.ts:105) writes Blob objects with `access: "public"`. The photo API verifies ownership, but the image URL itself is a public resource: possession of the URL bypasses the application session gate. Random names are not authorization. Local fallback writes under `public/uploads`; production Blob access is the main finding.

Recommended next step: establish private object serving or authenticated image delivery, including existing uploaded objects and the vision-reading path. This is a blocker to describing dating photos as access-controlled under the repository's authentication requirement. No actual private photo URL was fetched to test exposure.

### 2. P1 — Partial Granola filing can become permanently “done”

[dating-filer.ts:286](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-filer.ts:286) treats any suggestion or imported event as completion of the entire meeting. [fileGranolaMeeting:336](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-filer.ts:336) persists suggestions before applying each known person in separate transactions. If a later write fails, retry sees the earlier row and skips the whole meeting, losing the unfiled work.

Recommended next step: separate meeting completion from partial results, or make the meeting's apply phase atomic. Preserve per-person idempotency. Add failure-injection tests where a suggestion or first person succeeds and a later person fails, then retry. A new completion table/column would require the schema-change approval described below.

### 3. P2 — Timestamp-only cursors can omit records

[dating-granola.ts:71](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-granola.ts:71) filters strictly after `since`, while [line 146](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating-granola.ts:146) returns only the last processed timestamp. If two notes share `created_at` and a batch ends between them, the next batch excludes the unprocessed note too. Historical backfills are particularly affected; daily lookback may not recover old omissions.

The [message endpoint:25](/Users/eddie/Code/.worktrees/personal-os-sync/src/app/api/dating/[id]/messages/route.ts:25) similarly paginates by strict `sentAt < before`, without an ID tie-breaker. Equal-time messages straddling a 200-row boundary can disappear from pagination.

Recommended next step: compound time/ID cursors or an inclusive boundary with durable deduplication. Test more same-timestamp records than fit in a batch/page.

### 4. P2 — Re-pasting timestamp-free chats creates duplicates

[dating.ts:144](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating.ts:144) assigns the current import time to plain `Name: text` lines. [pasteExternalId:177](/Users/eddie/Code/.worktrees/personal-os-sync/src/lib/dating.ts:177) hashes that timestamp. Thus identical pasted text imported later gets different IDs, despite the UI's deduplication promise.

Reproduced locally using the actual parser and hashing helper with `Ana: hello` / `Me: hi`, the same person ID, and fallback times one minute apart. The IDs differed and `dedupes` was false. No database writes were made.

Recommended next step: define a stable import identity for undated transcripts while retaining distinct repeated messages within a conversation. Test two imports of the same content at different times, and repeated identical lines within one import.

### 5. P2 — Failed requests can leave misleading UI state

[dating-detail.tsx:79](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/dating-detail.tsx:79) optimistically patches the entire person state with no rollback; response bodies replace the whole object. Failed saves can leave unsaved values visible, and out-of-order responses can overwrite newer displayed state. Several other paths, including [dictation:107](/Users/eddie/Code/.worktrees/personal-os-sync/src/components/dating/dictate-card.tsx:107), set `busy` before fetch and only clear it after resolution, so a network rejection can leave controls disabled.

Recommended next step: consistent try/catch/finally handling plus field-aware reconciliation or serialized mutations. Verify rejected network requests and deliberately reordered responses in component/browser tests.

## Additional limits and decisions for follow-up

- Journal organization uses a single `journal:<personId>` marker. Editing notes afterwards does not make them eligible for another organization pass. This is deliberate current behavior; decide whether future incremental organization is wanted before changing it.
- Granola suggestions retain summary/note, not the full structured proposal. Add/link files those notes; it does not recreate all originally proposed flags/events automatically.
- `addSuggestion` reads pending status, creates a person and updates suggestions without a conditional claim or explicit serialization. Concurrent add/add or add/link requests deserve a database-backed concurrency test before calling this idempotent.
- Photo count checking (60 per person) and row creation are separate, and Blob upload precedes database insertion. Check quota enforcement, concurrent uploads and orphan cleanup. The shared image helper does not enforce the README's general per-user storage quota.
- AI input is bounded in some places (40,000-character filing note; 80,000-character thread excerpt; at most 24 photos, three per person). Rosters, timelines and total cross-person text are not globally bounded. The plain Claude transport has no explicit timeout; the batch deadline only stops starting another call.
- WhatsApp sync intentionally skips group chats, broadcasts, non-text messages and phone-less `@lid` identities. Full Disk Access, the installed Desktop database schema, and actual scheduled-job status were not verified.
- Mac SQLite snapshots copy the live database and WAL files separately; tests cover fixture reads, not concurrent live database writes during copying.
- There is no need to replace the current architecture to continue. Keep pure helpers testable, keep auth/tenant checks at route boundaries, and improve import correctness before adding another ingestion path.

## Verification completed

Run from `/Users/eddie/Code/.worktrees/personal-os-sync` at `af4d991`:

```sh
pnpm exec vitest run src/lib/dating src/lib/granola.test.ts
pnpm typecheck
```

- 10 test files passed, **154 tests passed**, process exit 0.
- TypeScript check passed, process exit 0.
- Separate executable reproduction confirmed unstable IDs for re-imported undated transcripts.
- Existing coverage includes pure helpers, mocked Granola batching, photo/matching/organize helpers, request-body normalization and synthetic SQLite message-reader fixtures. It does not establish real PostgreSQL transaction concurrency, production Blob privacy, route authorization end-to-end, or successful live AI/Granola calls.
- No production write tests, sync invocation, build, deployment, or database schema push was run. No application source was changed.

## Operating constraints for Astra

Read `/Users/eddie/AGENTS.md` and the newer checkout's `tasks/lessons.md`. In particular:

- Local development may point at the production Neon database. Use a verified scratch database for write/concurrency tests.
- Preserve all existing worktrees and user changes. Never use checkout/restore/reset/stash/clean to discard unrelated work.
- Do not replace shared task/lesson logs. This analysis uses a dedicated handoff document.
- Database design/structure changes require explaining the change and migration/rollback implications, then obtaining approval under `AGENTS.md`.
- Environment variable names relevant here: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `CAPTURE_TOKEN`, optional `CAPTURE_TOKENS`, `FOUNDER_EMAIL`, `CRON_SECRET`, `GRANOLA_API_KEY`, optional `GRANOLA_OWNER_EMAIL`, and Mac `DATING_SYNC_URL`/`APP_URL`. No secret values were inspected for this handoff.

## Suggested takeover prompt

Read `/Users/eddie/Code/active/personal-os/docs/handoffs/2026-09-26-dating-astra.md`. The current task checkout is older than the reviewed dating implementation. Verify the intended latest main baseline before editing, preserve existing work, and use an isolated branch for changes. Continue from the user's next requested priority. The handoff includes architecture, API/data contracts, five prioritized findings, test evidence and operational constraints; it does not itself authorize a production data migration or deployment.


## Outstanding-work release — 2026-09-26 22:23 EDT

PR19 https://github.com/eddieinfinitemachine/personal-os/pull/19 merged at 02:21:53 UTC, merge commit fcc41618cd86aa9ecf0896f13ca00127fcb01ca8. Production deployment dpl_B3ap4Z9BHaEf9MMwd8nv9yRu991U is Ready on internal.eddiecohen.com and kaizen.eddiecohen.com; a fresh signed-in browser load verified the new Actions/Delete person menus.

Shipped board/rows deletion, atomic Granola filing with retry-safe compound cursors, complete message pagination, stable repeated-paste deduplication, failed-save recovery, and private dating photos served through an owner-checked session route. Created/configured private store personal-os-dating-private with server-only DATING_READ_WRITE_TOKEN. Read-only production audit found zero photos, so no data migration was needed. No schema changes or production data imports were run. Mac sync checkout remains af4d991 and the job is unchanged.

Final validation: 372 tests across 32 files including 13 real-PostgreSQL integration tests, typecheck and production build passed. Real private Blob and running-app HTTP tests passed with synthetic files cleaned up. Independent review found no actionable issues. Native browser confirmation stalled local automation; confirmation/cancel/failure paths were exercised by rendered-component tests instead. Real Claude/Granola quality/backfill and real-device touch/VoiceOver remain unverified.

Current code handoff: /Users/eddie/Code/.worktrees/personal-os-dating-outstanding/docs/handoffs/2026-09-26-dating-outstanding.md. This supersedes the earlier five prioritized code findings. Old/overlapping undated imports remain ambiguous; historical Granola meetings without completion markers need one reanalysis when revisited.


## September 27 — Lindsey history recovery

User asked about Lindsey Segrara, from the South, met at a photoshoot. Existing production profile is Lindsey Sagrera, cmujye3pp0001js04lhhnph8r, stage ended, metVia Photoshoot, zero messages and initially zero events. Read-only journal search across local Writing markdown/text and old Journal.txt found only an ambiguous Lindsay hike mention on April12; not attributed. Granola API listed1,288 notes;31 likely relevant sessions fetched with transcripts, no errors. March30 session explicitly names Lindsay and matches both Olto photoshoot and grew-up-in-the-South clues. April20, April27 and June8 sessions discuss the same ongoing relationship. Excluded the unrelated February9 job interview, ambiguous April13 material and unnamed March16 photoshoot account.

Recovered four source-linked Granola timeline notes into the existing owned profile, one per confirmed session; deterministic granola:<noteId>:<personId> keys prevent duplicates. Summaries explicitly attribute observations to Eddie and dates to discussion dates; no inferred met/end date, diagnosis or other people's private material added. Original notes/stage/contact handles unchanged. Authenticated production insight refresh returned200 and verified4timeline entries, notes,0messages; insightsAt2026-09-27T15:26:05.115Z. Temporary Granola index and matched transcripts deleted after completion. No schema/code/worker changes.

Cross-person reflection feature remains at reviewed design in worktree personal-os-dating-reflection, branch codex/dating-reflection, commitba46fd8. User has not yet approved the two-table schema proposal; this Lindsey investigation is not approval.

## September 27 — Automatic intake and shared review inbox

User approved the improvement direction with “do it.” First delivery is selected EC Pad journal intake, Granola/text discovery, a shared People to review inbox, manual-edit preservation and honest source health. Worktree: `/Users/eddie/Code/.worktrees/personal-os-dating-intake`, branch `codex/dating-intake`, based on main `e617308`. Design: `docs/superpowers/specs/2026-09-27-dating-intake-design.md`. Independent design review found undated compatibility, overlapping identity concurrency and retention details; those have been addressed and sent for final review.

Concrete database approval is still required under `/Users/eddie/AGENTS.md`: three new tables (DatingSourceState, DatingSourceRecord, DatingCandidate), additive source/evidence fields on DatingSuggestion and DatingEvent. No schema/code/production/installed-worker changes made during this preparation. Existing profile/message/photo data remains intact; rollback disables intake and retains additive data. The separate reflection schema is not included in this proposal.

EC Pad checkout `/Users/eddie/Code/active/ec-pad` is actively edited by the task “Open EC Pad in Codex”; do not overwrite its changes. Implement its connector in isolation and reconcile finished startup/AppModel changes. Verification must use synthetic temporary libraries, never the real Writing library or desktop automation. Connector exports explicitly selected saved notes/folders while the Mac app is running and unlocked; it is not connected yet. Text discovery is separately opt-in; the installed worker currently imports only approved exact handles.


## September 28 — Automatic dating intake release

- User approved the three-table/additive-column schema in this task. Reviewed SQL `prisma/changes/20260928_dating_intake.sql` applied transactionally after a private schema-only backup; live schema diff reports no difference. No new source transfer was enabled.
- PR25 merged as `8cec2ac80e012206e35d2e2efe2c003355df216c`: https://github.com/eddieinfinitemachine/personal-os/pull/25. Final feature head `6614cab95cb12a8140abb50470e8bbff8799d6ef`; worktree `/Users/eddie/Code/.worktrees/personal-os-dating-intake`.
- People to review supports editable Add, Link existing, Dismiss, Don’t suggest again and Restore. Source-backed notes and summary refreshes preserve manual edits. Verified alias closure includes all linked handles; source identity mappings survive updates. Disconnect revokes unused EC Pad pairing codes as well as active tokens.
- Granola has durable enumeration/retry queues, bounded processing, manual historical imports and recent edit rescans. Optional message discovery reads recent30-day one-to-one conversations on the Mac; default off. It uses lossless message timestamp cursors and metadata-only local checkpoints. Existing approved conversations retain their separate import.
- EC Pad selected-note/folder connector is built in `/Users/eddie/Code/.worktrees/ec-pad-dating-intake`, native commit `1684299f0411e6b5801854240a41d89d5281aaff` includes latest3fd073c.209 tests, macOS build and iOS Simulator build passed. No native install, pairing, journal selection or actual transfer performed here. Existing task01a0e16a-0a57-7e12-900e-01b369af53cc has the integration handoff and is active; preserve its ongoing uncommitted work.
- Final web validation: frozen pnpm lockfile;575 passing unit/new intake integration tests and26 additional legacy filer/contact/insight tests; production build/typecheck passed. Synthetic browser passed add/edit/unknown date/dismiss/exclude/source opt-in/source evidence/390px/no page errors. Existing lint setup unavailable; real iPhone/VoiceOver and live source transfer not tested.
- Broader full-history reflection report, redesigned summaries and primary photo selection remain separate follow-ups. Their additional schema was not part of this approval.

Release verified: EC production deployment `dpl_GzHXWmZ6TJLF3xwofPdsFW3KQxsf` / `https://personal-3ijdqkeiv-ec-efed32ac.vercel.app` Ready, serving both internal.eddiecohen.com and kaizen.eddiecohen.com. Authenticated source/review/page reads passed on both domains and unauthenticated access remained gated. New source states are disabled. Installed Mac sync checkout fast-forwarded cleanly from3c1dbd3 to8cec2ac; discovery module loads under its actual runtime without starting a scan. LaunchAgent timing unchanged; no immediate private-source scan was triggered.

Native delivery confirmed: existing EC Pad task merged connector as c3124f5, preserved its additional Granola summary work, passed212 combined native tests and macOS/iOS builds, and installed signed build8 under its existing installation authorization. Read-only verification here confirmed installed CFBundleVersion8 and valid code signature. EC Pad Settings > Dating · Personal OS is available. Pairing and selected journals remain user setup; no transfer claimed.


## September 28 — Automatic Contacts and message lookup released

User request:adding a woman by name should find her Contacts/iMessage identity without requiring a number. PR26 https://github.com/eddieinfinitemachine/personal-os/pull/26 merged as `0eaf6fcea2ac3894a31c467e96f8868f345d19c7`. No schema changes. New per-person progress/retry/ambiguous choices; phone optional. Unique complete-name match auto-attaches, partial names require selection; manual edits and excluded/shared identities protected. Contacts directory stays local and refreshes from Mac Contacts for new requests or after24h.

`scripts/dating-contact-sync.ts` polls every60seconds via `com.personal-os.dating-contact-sync`; installed from `/Users/eddie/Code/.worktrees/personal-os-sync`, cleanly advanced to0eaf6fc. Uses existing targeted message/summary importer, durable metadata-only checkpoints, and owner-scoped contact request metadata in existing source config. Separate broad text discovery remains disabled. Background first run completed with exit0, one automatic match, and no message-access errors. Existing30-minute message sync retained. Live Contacts cache refresh succeeded with6648 entries.

Verification:621 tests passed with scratch PostgreSQL,42 unrelated opt-in skipped;9 legacy contact tests passed; build/typecheck passed; independent review no blockers. Synthetic390px browser added by name without phone, resolved contact through real HTTP capture route, and imported only its matching fixture iMessage thread. Existing WAL test transiently timed out under unlimited parallelism, passed alone and full suite with4workers. Production deployment `dpl_A6TTXh2NEbukCJB6KtHKwHdcN6tM` Ready on internal.eddiecohen.com/kaizen.eddiecohen.com; private authenticated lookup and capture routes verified, unauthenticated gated. No synthetic production profiles. Worktree `/Users/eddie/Code/.worktrees/personal-os-dating-auto-contacts`.
