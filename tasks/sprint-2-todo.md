# Personal OS — Sprint 2 Plan

**Goal**: Bring People, Projects/Dashboards, and File attachments online. Bridge from "todo app" → "context-aware OS" by letting todos reference people and dashboards.

Sprint 2 builds on Sprint 1's data layer and UI patterns — same `Sendable` stores, same `@Observable` view models, same `NavigationSplitView` / `TabView` shells.

---

## 1. People

### Model
- `Person` value type: id, name, role (`report` | `peer` | `family` | `other`), team?, contactRef?, notes?, birthday?, createdAt, updatedAt
- Defer `customFields` until there's UI to edit them
- `CDPerson` Core Data entity, all attributes optional (CloudKit rule)
- `PersonStore` mirrors `TodoStore` shape — sync CRUD on viewContext

### Linking todos to people
- `Todo.personIDs: Set<UUID>` (mirrors `tagIDs`)
- Many-to-many relationship `CDTodo.people <-> CDPerson.todos`
- `TodoStore.fetch(personID:)` for the per-person todo lists

### UI
- **Mac**: People sidebar entry → grid of person tiles → tap into profile (todos linked, notes, birthday, role)
- **iOS**: People tab → grid → drilldown profile
- Tile content: initials avatar, name, role badge, count of open linked todos
- Defer "next 1-2 todos" and "days since last touchpoint" (needs Interaction model — Sprint 3+)

---

## 2. Projects / Dashboards (the architectural piece — needs review)

This is the hardest data modeling decision in the project. Three viable shapes:

**Option A — strict typed schema per dashboard "type"**: define `VehicleDashboard`, `PetDashboard`, etc. as concrete entities. Pro: typesafe, no parsing. Con: every new dashboard type is a code change + migration.

**Option B — flexible schema with typed Field union**: `Dashboard` has an array of `Field` defs (label, type, value), where `value` is an `enum FieldValue` with cases `.text(String)`, `.number(Double)`, `.date(Date)`, `.currency(Decimal)`, `.url(URL)`, `.select(String)`, `.multiselect([String])`, `.file(AttachmentRef)`, `.person(UUID)`. Pro: matches the brief, no code changes for new dashboard types. Con: more Core Data plumbing (probably a separate `CDFieldValue` entity per value, or a JSON blob with custom transformer).

**Option C — JSON blob in a single `data` field**: store the entire dashboard payload as JSON in one Core Data attribute. Pro: dead simple. Con: no per-field queryability, no CloudKit per-field conflict resolution.

**Recommendation: Option B**. It matches the brief, allows querying ("all dashboards with `lastService` field older than 6 months"), and CloudKit handles per-field merges correctly. Cost is one extra Core Data entity (`CDFieldValue`) and a custom transformer for the multi-select / attachment cases.

**This needs your sign-off before I touch any code.**

---

## 3. File attachments

- `Attachment` value type: id, name, mime, size, source (`local` | `dropbox`), localFileRef (CloudKit asset URL), dropboxPath, thumbnailRef, addedAt
- For Sprint 2, **local imports only** (Dropbox is Sprint 3)
- Storage: `CDAttachment` with `Binary Data` attribute marked "Allows External Storage" so Core Data offloads big blobs to disk and CloudKit handles them as `CKAsset`s automatically
- Upload paths:
  - Mac: drag-and-drop onto a dashboard, or `+` button → `NSOpenPanel`
  - iOS: `+` button → `PhotosPicker` for images, `fileImporter` for everything else
- Thumbnails: generate via `QLThumbnailGenerator` (same on both platforms), cached as a separate small `Data` field
- Inline preview: `QuickLookPreview` for images / PDFs, fall back to a name + open-in-app row for everything else

---

## Suggested execution order

1. **People** — self-contained, no architectural decisions
2. **People ↔ Todo linking** — mechanical extension of existing patterns
3. **Mac + iOS People UI** — reuses Sprint 1 view-model pattern
4. → **CHECKPOINT**: Get sign-off on Dashboard architecture (Option B above)
5. Dashboard model + store
6. Dashboard UI (Mac sidebar entry + iOS tab) — minimum viable: list of dashboards, one detail view with editable fields
7. Todo ↔ Project linking
8. **Attachments** as the last piece — easy to bolt on after Dashboard exists

---

## Pending decisions (to surface before implementation)

- [ ] Dashboard schema strategy: confirm Option B
- [ ] When to store `CDPerson.contactRef` — opaque string Apple Contacts identifier? Defer Contacts integration to Sprint 3?
- [ ] Initial seed of dashboards — should the Mac app ship with templates ("vehicle", "pet", "home") that the user can clone, or start empty?
- [ ] Should Things importer learn about people / projects / tags in a follow-up pass?

## Sprint 2 review (2026-05-01)

**All four sprint-2 chunks done:**
- People (model, store, Todo↔Person linking, Mac+iOS UI, person picker in todo editor)
- Dashboards (Option B confirmed: kind-discriminated CDFieldValue. Model+store+8 tests. Mac sidebar + iOS tab UI. Field editor handles text/number/date/currency/url. Add-field sheet + remove-field button.)
- Attachments (local imports only, Sprint 2 scope. Soft-FK CDAttachment with Allows External Storage. AttachmentStore + 5 tests including dashboard-delete cascade. Mac NSOpenPanel + iOS fileImporter glue.)
- @MainActor stores fix (lessons.md) — found while debugging post-Person flakiness

**Test count**: 39 passing (was 20 at end of Sprint 1)
**Stability**: 10/10 stable runs after the @MainActor refactor

**Architectural decisions made:**
- Option B (kind-discriminated columns) for FieldValue — confirmed by user, implemented
- Soft FK for Attachment.dashboardID instead of Core Data relationship — simpler, manual cascade in DashboardStore.delete
- Currency stored as `decimalAttributeType` / `NSDecimalNumber` to avoid Double precision loss
- Reserved kinds (select, multiselect, attachment, person) declared in `FieldKind` but not yet pickable in the editor — future-proofs the schema

## Out of scope for Sprint 2 (deferred)

- Anthropic NL capture (Sprint 3)
- Dropbox OAuth + folder sync (Sprint 3)
- Reminder rules (Sprint 4)
- Vault, birthdays-as-todos, polish (Sprint 5)
- Apple Contacts integration (Sprint 3)
