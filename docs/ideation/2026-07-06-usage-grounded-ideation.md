---
date: 2026-07-06
topic: usage-grounded-ideation
focus: ideas based on measured solo-user behavior (loop iteration 1)
---

# Ideation: What the Usage Data Says to Build

## Usage Profile (measured from production data, user emcohen@me.com, since 2026-05-19)

- **Todos are the app**: 437 total, 147/30d (~5/day), 77% completed, latest today.
- **Due dates unused**: 8 of 437 (~2%). Deadlines live in his head/calendar.
- **Person-lists = hidden delegation workflow**: EC/Shane 63, EC/Dave 20,
  EC/Obie 16, EC/Nolan 15, EC/Ben 5, EC/JC 4, EC/HG 3 — 126 todos across 7
  colleagues, tracked solo (0 shared lists despite the feature existing).
- **Decay**: of 94 open todos — 43 <7d, 13 7–30d, 37 at 30–60d, 1 >60d.
  Monitor 39 / Later 35 act as parking lots with no return mechanism.
- **Assets**: best-practices 77 (largest), inventory 66, investments 17,
  media 12, places 7 (new).
- **Dead since May setup weekend**: labResult 162 (one import), person 492
  (bulk import, 6 touched/30d), trip 1 + 0 items, pet/vehicle/human ~0
  activity, 0 biometrics/fitness/attachments/shopping/shared-lists.
- Git themes: capture-flow refinements ×4, universal search, HIG polish,
  monochrome reverts — he optimizes the daily loop and the feel.

Process: usage profile from Prisma row counts/recency → 3 framed subagents
(amplify observed workflows / friction+decay / dormant-surface reckoning) →
21 raw ideas → orchestrator filter using prior critic findings.

## Ranked Ideas

### 1. 1:1 Agenda Mode for person-lists
**Description:** "Start 1:1" on any EC/* list → full-screen meeting runner
(reusing triage primitives): step through open items, mark **discussed**
(≠ done; stamps a session log + "raised 3×" counter for survivors),
done / defer / quick-add live; "since last meeting" divider; ends with a
copyable plaintext recap (agenda + closed-since-last-time).
**Rationale:** Second-biggest measured workflow (126 todos, 7 people) served
by generic list UI today. Two ideation agents converged on this independently.
**Downsides:** Needs small schema additions (lastDiscussedAt / session log) —
flag before migrating. **Confidence:** 90% · **Complexity:** Medium · **Status:** Unexplored

### 2. Date-free decay system (age chips · Dropped · fuzzy snooze · stale sweep)
**Description:** Respect the 2%-due-date reality: age chip on open todos +
oldest-first sort; one-key **Dropped** terminal state ("decided not to do",
searchable, keeps completion honest); snooze with only relative options
(next week / in a month / someday-90d) that resurfaces items to the TOP of
their list; triage gains a stale queue (open >30d, oldest first) behind a
"38 stale" badge. All user-initiated.
**Rationale:** 40% of open todos are a month+ old; Monitor/Later hoard with
no re-entry mechanism; the only exit today is completion.
**Downsides:** droppedAt/snoozeUntil columns — flag before migrating.
**Confidence:** 85% · **Complexity:** Medium · **Status:** Unexplored

### 3. @person capture routing
**Description:** Deterministic token in Smart Capture: "@shane follow up on
container email" strips the token and files verbatim to EC/Shane (alias map,
no AI). Unknown @tokens fall through to Inbox untouched.
**Rationale:** His most common manual re-file hop (Inbox → person-list) made
zero-cost; user-directed routing, not AI sorting, so it honors the standing
capture rules. **Downsides:** Token syntax to remember; alias upkeep.
**Confidence:** 85% · **Complexity:** Low · **Status:** Unexplored

### 4. Usage-diet home + nav (archive the dead 80%)
**Description:** Home rebuilt around the four earners: Inbox/triage count,
today's todos, delegation boards w/ per-person open counts, best-practices —
compact stat lines for inventory/investments. Nav shows live sections only;
labs/contacts/trips/pets/vehicles/health collapse into an Archive drawer and
remain fully reachable via command palette ("type it, find it"). Zero data
loss, UI demotion only.
**Rationale:** 11 of 15 sections are dead weight he scrolls past ~150×/month;
he demonstrably cares that the app feels tight (3 rebrands, polish passes).
**Downsides:** Archive discoverability; palette must index the demoted models.
**Confidence:** 80% · **Complexity:** Medium · **Status:** Unexplored

### 5. Today pins (manual, self-clearing daily focus)
**Description:** One-key "pin to Today" (cap ~5) lifts a todo into a Today
strip; pins auto-expire back to their lane at midnight, todo untouched.
**Rationale:** He will never date tasks (8/437) — a pull-based, zero-commitment
daily working set matches how he actually operates.
**Downsides:** pinnedAt column — flag; overlaps conceptually with snooze
resurfacing (keep both simple). **Confidence:** 75% · **Complexity:** Low ·
**Status:** Unexplored

**Bonus (below the line):** best-practices daily resurface card ("from your
commonplace book", read-only, one per day) — cheap and pleasant; Monitor
check-in cadence (last-checked heartbeat) — fold into idea #2 later.

## Rejection Summary

| Idea | Reason |
|------|--------|
| iPhone Web Share Target | iOS Safari doesn't support it (established 2026-07-02 critique) — capture-first second home-screen icon is the salvageable kernel |
| Delete sharing/shopping/attachments outright | Same win via Archive demotion without burning the option; deletion needs separate approval anyway |
| Merge trips/pets/vehicles/media into generic Records | Big refactor, 17 combined rows — Archive demotion (idea #4) gets the payoff without touching working code |
| Sunset health UI to read-only vault | Absorbed into idea #4 (palette-only access) |
| Convert /friends into delegation boards | Right instinct, but the boards are lists — idea #4's home surfaces them; contacts stay palette-searchable |

## Iteration 2 — Content Analysis (2026-07-06)

Measured from todo/practice text (aggregated, not stored here):
- **Stale todos are the tersest**: completed avg 3.4 words, stale (>30d) 2.6 —
  the rot cohort is context-free fragments ("Uber", "IG", "Tom Brady",
  "Ibiza"). Todos die of CONTEXT LOSS, not time. Only 27/437 have notes —
  typed context at capture is a proven dead end.
- **Completion cliff at ~2 weeks**: done in p50 2.0d / p75 5.9d / p90 14.9d.
  Stale threshold should be ~14d, not 30d.
- **Names are the router**: top first-words of completed todos are people
  (jake 8, obie 8, addy 6, joe 5, shane 5, + "follow"/"review"/"reply to X").
  ~half of todos are person-referencing; many sit unfiled in Inbox despite
  matching EC/* lists existing.
- **Non-tasks squat in the todo lifecycle**: literal reference strings parked
  in Monitor (e.g. an ID number) can never "complete".
- **Verb-ness predicts survival**: "reply to ben" completes; "Uber" rots.
- **Restaurant knowledge forked**: 11 Restaurant best-practices vs 7 Places
  rows — same domain, two tables. BP library is really Parental 27 /
  Travel 15 / Restaurant 11 / Dating 6 / Dinner Party 4, nearly all with notes.

### Revised Consolidated Ranking (v2)

1. **Names route everywhere** (merges iter-1 #3 + Name-Trigger Triage):
   `@shane` token at capture files verbatim to EC/Shane; during triage, a
   known alias in the title surfaces a highlighted single-key default
   ("S → EC/Shane"). Deterministic alias map, no AI, title untouched.
   Low complexity, highest confidence (~90%).
2. **1:1 Agenda Mode** (unchanged from iter 1) — discussed-state, raised-count,
   session log, copyable recap. (~90%, Medium)
3. **Date-free decay system v2**: age chips + oldest-first; one-key **Dropped**;
   fuzzy snooze (resurface to top); one-key **Reference** state (exits the todo
   lifecycle into a searchable drawer, excluded from counts/sweeps); stale
   sweep threshold **14d** per measured p90. (~85%, Medium)
4. **Triage context strip** (new): collapsed "On capture: Tue Jun 3, 4:12pm ·
   between 'reply to ben' and 'colin follow up'" — same-day capture neighbors
   reconstruct what a fragment meant, read-only, createdAt already exists.
   (~75%, Low)
5. **Usage-diet home/nav** (iter 1 #4) + quick win: **merge the 11 Restaurant
   best-practices into Places** (explicit-confirm, 11 rows, one home for
   eating knowledge). (~80%, Medium)

Bonus shelf: Today pins · BP daily resurface card · "create EC/Colin?"
threshold prompt · Person Lens (/people/jake computed view) · Two-Week
Interrogation (explicit-confirm AI "did you mean…" cards at day 13) ·
Echo voice breadcrumb · Threads (Ibiza/Ferrari cross-list strands).

Killed: Riddle Score capture nudges (fights capture speed ethos — the verb
insight is served by the context strip instead).

## Final Build Order (loop wind-down, 2026-07-07)

Sequenced by dependency and effort — each step ships alone:

1. **Names route everywhere** (S) — alias map + `@token` capture routing +
   triage single-key default. No schema change (alias map can live in
   NavSettings-style JSON or a tiny table — flag if table).
2. **Triage context strip** (S) — read-only capture-neighborhood panel;
   pure query over createdAt. Immediately makes triaging old fragments viable.
3. **Decay system v2** (M) — droppedAt + snoozeUntil + reference flag columns
   (⚠️ schema — needs approval), age chips, 14d stale sweep as a triage queue.
   Steps 1+2 make the sweep effective; that's why it's third.
4. **1:1 Agenda Mode** (M) — lastDiscussedAt + session-log storage (⚠️ schema),
   meeting runner UI reusing triage primitives, copyable recap.
5. **Usage-diet home/nav** (M) — home rebuilt on the four earners, Archive
   drawer, palette indexing for demoted sections. Do last: by then the new
   surfaces (triage/1:1) define what home should feature.
   Quick-win rider: merge 11 Restaurant BPs into Places (one-off script,
   explicit confirm).

## Session Log
- 2026-07-06: Loop iteration 1 — usage profile measured (row counts, recency, todo habits, list/project distribution, git themes); 3 framed subagents → 21 raw → 5 survivors + 2 bonus.
- 2026-07-06: Loop iteration 2 — content analysis (title patterns, completion-speed percentiles, stale-cohort forensics, BP categories); 2 framed subagents → 12 raw → ranking revised to v2 (names-routing promoted to #1, decay tuned to 14d + Reference state, context strip added, Places/BP merge quick-win).
