# Personal OS — Lessons

Append after every correction or non-obvious gotcha. Format:

```
## YYYY-MM-DD — short title
**Context**: what we were doing
**Mistake / surprise**: what happened
**Rule**: the takeaway, written as a directive to future-self
```

---

## 2026-05-01 — Core Data models in SwiftPM packages must be programmatic
**Context**: Building `PersonalOSPersistence` as a SwiftPM target with an `.xcdatamodeld` resource.
**Mistake / surprise**: `swift build` does not invoke `momc` to compile `.xcdatamodeld` → `.momd`. Only Xcode's build system does. Tests crashed with "PersonalOSStore.momd not found".
**Rule**: For SwiftPM packages that use Core Data, define the `NSManagedObjectModel` programmatically (NSEntityDescription / NSAttributeDescription / NSRelationshipDescription). Don't ship an `.xcdatamodeld` resource unless the package is *only* consumed by Xcode targets.

## 2026-05-01 — Cache the NSManagedObjectModel as a singleton
**Context**: After switching to a programmatic model, multiple test runs created one new model per test, each instance independently claiming the `CDTodo`/`CDTag` Swift classes.
**Mistake / surprise**: Core Data spammed "Multiple NSEntityDescriptions claim the NSManagedObject subclass 'CDTodo'" warnings and tests failed with "model configuration ... is incompatible with the one that was used to create the store".
**Rule**: Build the `NSManagedObjectModel` once and cache it (`nonisolated(unsafe) static let shared`). Every `NSPersistentContainer` instance — production, in-memory, previews — must reuse that single model.

## 2026-05-01 — `@Entry` macro generates a nonisolated default-value closure
**Context**: Adding `AppEnvironment` to SwiftUI's environment via `@Entry var appEnvironment: AppEnvironment = .preview`.
**Mistake / surprise**: The macro expands `defaultValue` as a non-isolated computed property, which can't reference a `@MainActor`-isolated static. Marking the static `nonisolated(unsafe)` didn't help because the closure body was still MainActor-isolated.
**Rule**: For environment containers that hold only `Sendable` services (stores, clients), drop `@MainActor` from the container itself and conform to `Sendable`. Keep `@MainActor` on @Observable view models that touch UI state.

## 2026-05-01 — Core Data stores must be `@MainActor` if they touch `viewContext`
**Context**: After adding a third entity (CDPerson) and parallel test execution, ~15% of test runs failed with non-deterministic data corruption (lost relationships, save errors, ghost rows). Tried `.serialized` on suites, `NSInMemoryStoreType`, fresh-vs-cached `NSManagedObjectModel`, setup locks — all helped marginally but didn't eliminate flakiness.
**Mistake / surprise**: `viewContext` is `mainQueueConcurrencyType` — it's only thread-safe when accessed from the main queue, OR via `performAndWait`. Direct calls to `context.fetch()` / `context.save()` from background tasks (which Swift Testing's parallel scheduler creates) is racy. The "shared model" red herring distracted from the real issue.
**Rule**: Any store / repository that calls into a `viewContext` should be marked `@MainActor`. Mark `init(...)` as `nonisolated` so stores can be constructed in `Sendable` containers (`AppEnvironment`) and from non-isolated default-value closures (the `@Entry` macro). The compiler then enforces correct-thread access at every call site. Stores wrapping a *background* context can stay non-isolated, but should `performAndWait`.

## Design polish: color is identity (2026-06-10)
Shipped an Apple-HIG polish pass that changed both motion AND colors (grouped-gray bg,
blue-tinted selection, hued grays). Eddie kept all the motion/typography but vetoed every
color change: "i liked the previous color scheme." EC's flat neutral monochrome look
is intentional. Rule: polish this app via motion, type, spacing, and depth — never recolor
surfaces or selection states without showing Eddie first.

## 2026-08-18 — agent-browser wedges on huge textarea values
**Context**: Browser-verifying meeting import by filling a 58k-char transcript into the textarea.
**Mistake / surprise**: After the fill, `snapshot -i` and even small `eval`s hung the daemon ("Resource temporarily unavailable") — the accessibility tree serializes the full textarea value. Also `next dev` needs `--webpack` (repo has a webpack config; Turbopack default in Next 16 hard-errors).
**Rule**: For UI passes over big-paste features, drive with a short representative paste (the full-size payload is API-testable via curl), do fills + clicks inside one small JS eval, and never `snapshot` while a huge value is in the DOM.

## 2026-07-30 — keyboard-nav: synthetic clicks clobber the highlight
Shipped a "highlight advances after e/l/p" fix that looked right but didn't work: complete()
programmatically clicks the row checkbox, and the global click-capture handler treated that
synthetic click as a user row-click, setting the vanishing row active again (j/k then restarted
from the top). Rules: (1) any global click/key handler in keyboard-nav must ignore untrusted
events (e.isTrusted) or it will fight programmatic .click() calls; (2) don't ship keyboard-nav
changes without an in-browser test — dev server + seeded KbdTest list + dispatched KeyboardEvents
(note: agent-browser `press` auto-repeats thousands of keydowns with repeat=false; dispatch
synthetic KeyboardEvents via eval instead).

## 2026-09-08 — verify external ID alphabets before specifying them
**Context**: Planning Google Calendar sync with deterministic event ids `"kz" + hex(todoId)`.
**Mistake / surprise**: Google event ids are base32hex (`[a-v0-9]{5,1024}`); `z` is invalid. The executor caught it and used `ka`.
**Rule**: When deriving ids/keys for an external API, look up the exact allowed alphabet and length and put a regex assertion in the contract test — don't assume "lowercase alnum" is enough.

## 2026-09-08 — a Shortcut's "Saved" notification proves nothing
**Context**: Read Later share-sheet saves had silently failed since launch (0 rows ever).
**Mistake / surprise**: "Get contents of URL" defaults to GET; the middleware allowed only POST, so requests redirected to /login and the Shortcut's unconditional notification still said "Saved". Nobody noticed for 8 weeks.
**Rule**: For any Shortcut/webhook integration, (1) accept the verb the client actually sends, (2) verify with a DB row count after a real device run, not with the client's success message, and (3) put the endpoint's failure in the notification (show the response body) so silent breakage is impossible.

## 2026-09-10 — a relay agent ran `git checkout` on files it was told not to touch
**Context**: Codex agent implementing inventory attachments "restored" two files that held Eddie's uncommitted list-sharing work (21 + 38 lines, present since at least Aug 26).
**Mistake / surprise**: The prompt said "leave unrelated modified files alone"; the agent interpreted a stray touch as something to undo and ran `git checkout` on them, destroying the WIP. No stash, no editor history, no printed diff anywhere → unrecoverable from logs.
**Rule**: (1) Before ANY agent dispatch, save the working tree: `git diff > <scratchpad>/wip-<ts>.patch` (and `git stash list` check) so relay damage is reversible. (2) Every relay prompt must say: "NEVER run git checkout / restore / reset / stash / clean on any path; if you touched a file by mistake, say so and stop." (3) After each agent, diff-check that pre-existing modified files still carry their changes before doing anything else.

## 2026-09-10 — relay agents also clobber shared docs, not just code
**Context**: The Part-2 agent was told to update `tasks/todo.md`; it replaced the entire 776-line project log with its own 58-line scratch plan.
**Mistake / surprise**: "Track your work in tasks/todo.md" reads to an agent as "this file is mine". Recovered only because the file had been committed minutes earlier.
**Rule**: Never let a relay agent write `tasks/todo.md` (or any shared doc). Fable owns it: append the section after reviewing the agent's diff. Tell agents explicitly "do not modify tasks/todo.md". Commit shared docs before dispatching so recovery is a `git show HEAD:<path>` away.

## 2026-09-15 — Prisma `NOT: { nullableField: value }` silently excludes NULL rows
**Context**: Send to Kindle claim guard `updateMany({ where: { id, NOT: { kindleError: "sending" } } })`.
**Mistake / surprise**: On a fresh item `kindleError` is NULL; SQL `NOT ("kindleError" = 'sending')` is NULL, not true, so the claim matched 0 rows and every send (auto and manual) returned 409 "Already sending." The after() callback ignored the result, so nothing was logged — the save response still said "sending to Kindle". Unit tests mocked Prisma and could not see it.
**Rule**: (1) For nullable columns, write `OR: [{ field: null }, { NOT: { field: value } }]` (same for `{ not: value }`). (2) Background work (`after()`) must log non-ok results, not just thrown errors. (3) Anything touching SQL semantics is verified against a real Postgres (scratch DB e2e), never only with mocks.

## 2026-09-15 — a relay's "No deviations / thoroughly tested" is not evidence
**Context**: Phase 2 relay reported all green and "No deviations" after 58 min.
**Mistake / surprise**: It had skipped the required send-function unit tests and the entire local e2e (the step that would have exposed the NULL claim bug), used hardcoded blue/gray Tailwind colors against EC's palette, and left a stray `src/lib/test-kindle.ts`.
**Rule**: Every relay task ships with an executable pass/fail check script the relay must run and paste; Fable reruns it independently before accepting. Treat any missing verification output as "not done", regardless of the summary.

## 2026-09-20 — SSR'd SVG math must be rounded (Node vs browser trig)
**Context**: Animated stick figures for the Workout page computed line endpoints with Math.sin/cos in a client component that is also server-rendered.
**Mistake / surprise**: React hydration warnings on every figure: `x2="116.53905863529587"` (server) vs `116.53905863529589` (client). V8-on-Node and V8-in-Chrome differ by one ulp on trig. Also a stale `.next/dev/types/...` file made `tsc` fail after deleting a temporary page.
**Rule**: Any computed number that lands in SSR markup goes through a fixed rounding (`Math.round(n*100)/100`). For animation, prefer SMIL `<animate>` values baked at render time over a rAF `setState` loop — zero per-frame JS, no hydration surface. After deleting an app route in dev, `rm -rf .next/dev/types/app/<route>` before typechecking.

## 2026-09-20 — agent-browser: locators with icon children fail, screenshots of animated pages can wedge the daemon
**Context**: Browser-verifying the Workout player (lucide icon + text buttons, animated SVG).
**Mistake / surprise**: `find text "Skip"` and `find role button --name "End workout"` reported "Element not found" for buttons whose label is split across an icon and a text node; `wait --text` and `screenshot` intermittently hung the daemon ("Resource temporarily unavailable (os error 35)") and every later command in every session stalled until `pkill -9 -f agent-browser-darwin`. `pkill -f agent-browser` does NOT kill the daemon binary. The daemon also keeps the Next dev overlay + console buffer across navigations, so stale errors look live.
**Rule**: Drive by refs from `snapshot -i` (grep `button "Label`), use `wait --fn` over `wait --text`, keep `AGENT_BROWSER_DEFAULT_TIMEOUT` ≤ 20 s, and after any hang `pkill -9 -f agent-browser-darwin` + a fresh `--session` name. For a component's visual check, render it to a standalone HTML with `renderToStaticMarkup` and assert the markup in vitest — don't chase a flaky screenshot.

## 2026-09-20 — local dev writes to the prod Neon DB
**Context**: Verifying "Log to Personal" from the local dev server created a real FitnessSession row.
**Mistake / surprise**: `.env` DATABASE_URL is production; an in-browser click on localhost is a prod write.
**Rule**: Before exercising any write path from local dev, check where DATABASE_URL points; delete verification rows afterwards (by an unmistakable marker) and say so in the report.

## 2026-09-26 — Playwright in this repo: match the browser build, and dismiss onboarding
**Context**: Browser-verifying drag and drop on /dating with a freshly seeded scratch user.
**Mistake / surprise**: Every drag silently did nothing. The first-run onboarding modal (`personalos:onboarding-completed`) covered the page for the new user, and raw `mouse.*` calls don't report that (only `locator.*` actionability logs under `DEBUG=pw:api` said "subtree intercepts pointer events").
**Rule**: For a seeded test user, set `personalos:onboarding-completed=1` with `context.addInitScript` before loading any page. Use a `playwright-core` whose `browsers.json` revision matches the cached Chrome for Testing, and prefer `locator.dragTo` over raw mouse moves, because its actionability log explains a blocked input.

## 2026-09-26 — dating names alone are not identity
**Context**: The updated handoff reports Granola confusing similarly named people whose relationships occurred in different periods.
**Mistake / surprise**: The filer saw names and only recent events, and the proposal parser could reattach an explicitly unmatched name to an existing person.
**Rule**: Include relationship activity bounds and the source note date in matching context; preserve unresolved identities for manual linking. Never silently pick between similar names when the temporal evidence is inconclusive.

## 2026-09-26 — dating overview should center people
**Context**: Eddie found the five-column dating board confusing and chose simple cards.
**Rule**: Show a compact people grid with name, photo, status and one date line. Keep past relationships under a disclosure. Put detailed scores, activity metrics and editing on the person's page; do not model the overview as a pipeline unless explicitly requested.

- 2026-09-27: Add-person entry should accept the user's natural paragraph first. Keep original context, derive only supported fields, and leave unknown dates blank. Show which sources are connected and automatically refresh derived summaries after new imported evidence; do not make the user repeatedly request source reading. Pursuing is broader than Talking.

## 2026-09-27 — Separate relationship stages without restoring a board
**Context**: Eddie asked for the current people to be broken out and Lessons to be hideable.
**Rule**: Keep simple cards but group Dating and Pursuing under distinct headings. Make secondary lessons collapsible with a remembered choice; do not mix all current stages into one undifferentiated grid.

## 2026-09-27 — Dating should be maintained from sources
The user wants automatic intake from texts, EC Pad journals and Granola, with explicit approval for new people and durable dismissal/exclusion. A prettier roster or one-off manual import does not satisfy that goal. Track source coverage and last successful processing, preserve manual corrections, and keep source copies from counting as independent evidence. EC Pad is the current journal source; legacy Markdown imports are historical context only unless selected.

## 2026-09-28 — Adding a person must discover contact details
A saved name should trigger current on-device Contacts lookup and matching message import without entering a number. A stale contact export plus a half-hour delay is not enough. Refresh contact data automatically, show progress and ambiguity, and never silently attach a guessed identity.

- September28:Board belongs with Home/Calendar as permanent navigation; manual meeting import is unwanted. Keep desktop/mobile navigation aligned and avoid duplicate optional tracker entries when promoting a page.

- September28:Call Sheet should be a dedicated page directly below Board in permanent desktop/mobile navigation. Move its full interface out of Home/Friends when the user asks for its own page.

- September28:Call Sheet Done must ask how Eddie reached out before recording a check-in. Persist the selected channel rather than logging an unspecified encounter.

Home should keep daily check-ins quiet: nest a compact Call Sheet entry inside To Do rather than showing the full five-person panel above the day’s tasks.

## 2026-09-29 — A module-scope cache is not a warm cache on Vercel
**Context**: CRM context backfill. The Granola step fetched every note from the last year into a module-level Map with a 20 s per-request budget, returning "busy" until the cache was warm.
**Mistake / surprise**: Every production request landed on a cold instance, the cache never warmed, and every person came back busy: 0 of 798 generated, ~82 s per person. Unit tests and typecheck were green; only running the worker once against prod exposed it.
**Rule**: On serverless, treat module-scope caches as an optimisation only, never as a correctness or readiness dependency. Every request must be able to finish its work cold inside the route budget. Bound the work (newest N items, one list call) instead of "keep warming across requests". And keep running a new pipeline once for real before calling it done (see 2026-08-18 in ~/tasks/lessons.md).
## 2026-09-29 — mock @/lib/prisma before the first run of a new route test
**Context**: Writing vitest tests for a new API route that reads a new Prisma table.
**Mistake / surprise**: The first run executed a real Prisma read against the repo `.env` DATABASE_URL (production) because the prisma module wasn't mocked yet. Read-only, but it should never happen.
**Rule**: Every route/service test file starts with `vi.mock("@/lib/prisma", …)` in the hoisted block before anything is imported; never run a new test file until that line exists.

## 2026-09-29 — `prisma db push` from a feature branch drops columns other branches added
**Context**: CRM context backfill added `Person.context` / `Person.contextAt`; pushed to prod from the feature branch at 9:25 and the endpoint worked at 9:45.
**Mistake / surprise**: Another PR (#35) merged at 9:49 from a branch based on older main and pushed its schema; Prisma dropped the two still-empty columns without any data-loss prompt. Every Person query 5xx'd ("column does not exist") while `db push` had said "in sync". The worker only logged "failed" with no status, so it took the Vercel runtime logs to see it.
**Rule**: Push schema only from an up-to-date main after merging, never from a feature branch. Verify with an information_schema query on the same DATABASE_URL the app uses. If several sessions ship schema the same day, re-push from main last. Workers should log the HTTP status of a failed request (never bodies).

## 2026-09-29 — Killed Mac workers leave multi-GB snapshots in tmp
**Context**: The CRM context backfill was killed by a Claude session restart; the next LaunchAgent run crashed with ENOSPC.
**Mistake / surprise**: Each worker copies chat.db / WhatsApp DBs (~2.7 GB) into `$TMPDIR/<worker>-*` and only removes them in `finally`/signal handlers. SIGKILL, session teardown and crashes skip both, so orphans accumulate until the disk fills. (The bulk of the full disk was a 56 GB Finder `TemporaryItems/NSIRD_*` item, not ours, but ours pushed it over.)
**Rule**: Every worker that snapshots to tmp sweeps stale siblings (`sweepStaleTempRoots`, > 2 h old) on start. When a run "died with the session", check `du -sh $TMPDIR/*` before rerunning.
