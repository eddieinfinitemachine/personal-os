# Dating identity matching handoff

Base: main fcc4161 (PR19). Branch: codex/dating-person-matching. Worktree: /Users/eddie/Code/.worktrees/personal-os-dating-person-matching.

## What changed

Granola previously matched similar names without relationship dates. The filer now supplies met/ended dates, stage, and first/last non-note activity across the full timeline (not just the latest ten events). Imported note timestamps never extend a relationship window. Queries remain scoped to the owner.

The prompt distinguishes contemporary notes from dated recollections and asks for uncertainty instead of a guessed ID. A separate guard rejects unsupported choices among similar first names before parser deduplication. It accepts a unique source-explicit full name or a supported date with one supported active candidate and all rivals excluded by explicit bounds. Unknown bounds remain plausible. Multiple competing full names, mixed dates, unsupported dates, and recognized vague historical periods become suggestions. The parser preserves these unmatched entries instead of recovering an ID by name. Forced-person journal/dictation attribution remains intact.

Manual Add her / Add to… now handles only the selected suggestion. Previously these actions silently consumed all pending notes with the same name, which could undo the matching fix. An atomic pending-status claim prevents two simultaneous actions from filing the same suggestion twice. The review list says Review from Granola and includes the year.

## Verification

- 387 tests passed, including 18 identity unit cases, one rendered review UI test, and 9 real-PostgreSQL identity tests. The 13 unrelated opt-in database tests were skipped in this run; six existing Granola transaction tests also passed separately.
- Typecheck and production build passed. Existing middleware deprecation warning remains. The existing broken lint command was not used.
- A live Claude check using only invented people/notes passed current, explicitly historical, and vague-recollection cases. This exercised fileDatingNote without database reads or writes; it did not send Eddie's notes.
- Independent review caught source-date conflicts, competing full names and vague historical periods. Regression tests reproduced them before the fixes.

Database tests used only local scratch PostgreSQL on port 55441: dating_matching for identity tests, dating_outstanding for existing Granola transaction tests. No schema changes, production data repair, real Granola import, or journal organization was run. The handoff says previously misfiled data was already repaired manually.

## Limits and remaining work

The guard intentionally prefers manual review; name similarity and historical-language recognition are conservative heuristics, not proof that every identity can be resolved. Mixed-person or mixed-date notes can require manual matching. Synthetic model checks do not validate Eddie's real imported notes or all future model outputs.

After Eddie runs Import since… or Organize everyone's notes, inspect the resulting attribution and journal event dates. Leave disabled Claude routines disabled, and do not trigger a backfill merely to test. iPhone/touch/VoiceOver remain unverified. PR18 already simplified the person page; PR19 already added card-level deletion and reliability/privacy fixes. Mac sync and the original claude/board-tags checkout remain untouched.
