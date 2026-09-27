# Simple Dating Overview Implementation Plan

**Goal:** Replace the confusing dating kanban with the simple cards Eddie selected.
**Architecture:** Keep PeopleBoard's existing data contract and mutations, replace its two layouts with one responsive grid plus a past disclosure. Retain existing style tokens and API ownership checks.
**Tech Stack:** Next.js, React, Tailwind, Vitest.

- [ ] Simplify `src/components/dating/people-board.tsx`: one card grid; status/date line; collapsible past; existing overflow/delete; pending-stage protection; empty states. Remove view state, matchMedia, drag handlers and metric presentation.
- [ ] Add a concise date label in `src/lib/dating-board.ts` using explicit known relationship dates. Avoid presenting an import timestamp as a relationship's start/end. Preserve helpers consumed by the detail page.
- [ ] Adapt `src/components/dating/people-board.test.tsx` to verify current/past transitions and failed mutations, rather than removed layout choices. Retain deletion regression coverage.
- [ ] Verify desktop/mobile render with synthetic fixtures and no production database connection. Run targeted tests, then `pnpm test`, `pnpm typecheck`, `pnpm build`.
- [ ] Review diff, publish PR, verify correct EC deployment and merge/deploy. Update task record and handoff.
