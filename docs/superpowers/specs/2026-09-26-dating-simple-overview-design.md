# Simple dating overview

Eddie finds the board confusing and explicitly chose simple cards over a list or retained columns.

Replace five kanban columns and the Board/Rows switch with one responsive card grid. Current people include talking, dating, exclusive and paused; each card shows the existing private photo or initials, name, status, and one clear date line. Past relationships live in a collapsed disclosure below with a count. Cards open the existing person page. The overflow menu retains stage changes and confirmed deletion. Remove dragging, horizontal card strips, vibe indicators, message/date metrics, remember snippets and Instagram shortcuts from overview cards. Use the existing EC theme and typography.

Keep ownership/API behavior and saved records unchanged. Ignore the obsolete view preference; preserve the past-disclosure preference. Current and past cards retain stable activity ordering. Status requests disable repeat actions while pending, recover visibly on failure, and move cards between sections. Empty states distinguish no people from no current relationships.

Verify component transitions, confirmed/cancelled/failed deletion, no duplicate requests, past disclosure and old preferences. Inspect rendered desktop/mobile views with synthetic data; run full tests/typecheck/build. No schema change or production data mutation is needed.
