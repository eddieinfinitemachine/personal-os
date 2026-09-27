# Dating overview usability

User asks to choose improvements and implement them. Preserve the approved simple people cards and existing EC styling.

PeopleBoard: add a name search with clear/Escape, case/accent-insensitive Unicode support, all query words matched regardless of order. Search both current and past; show matching past cards automatically without mutating the stored open/closed preference. Show result counts and a recoverable no-results message. Past ordering uses explicit ended/met dates before creation/import times. Optimistic status state stores only changed fields so refreshed names/photos are not hidden by stale snapshots.

DatingHome: name the main action Add person. Keep Dictate and pending review visible; combine Granola imports and Mac setup under a collapsed Imports and sync disclosure. Keep controls mounted so hiding the section does not discard an in-progress operation. Recover failed add/dismiss/link actions and release pending state; prevent duplicate requests and show errors in the review section. Pending review count reflects visible suggestions.

Owners: parent owns PeopleBoard, helpers, tests and shared documentation. Home agent owns dating-home and dating-suggestion-review tests. Independent review checks combined changes. Verify full tests/typecheck/build and synthetic-data browser behavior. No production imports or schema changes.
