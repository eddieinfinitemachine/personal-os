# Personal OS — Sprint 1 Plan

**Goal**: Foundation that proves the core architecture works end to end. Three-list todo CRUD on Mac and iOS with CloudKit sync, before any AI / Dropbox / Vault complexity lands on top.

Confirmed decisions (2026-05-01):
- Location: `~/Code/active/personal-os/`
- Bundle prefix: `com.zelig.*`
- Targets: macOS 15, iOS 18 (latest)

Pending decisions to confirm before code:
- [ ] Persistence: **Core Data + CloudKit** (recommended) vs SwiftData
- [ ] Vault crypto spec (deferred to Sprint 5, but locking the data model now)
- [ ] Single Apple Developer team / signing identity to use

---

## 1. Repo + workspace layout

```
~/Code/active/personal-os/
├── PersonalOS.xcworkspace
├── apps/
│   ├── PersonalOS-Mac/         # macOS 15 SwiftUI app
│   │   ├── PersonalOSApp.swift
│   │   ├── Info.plist
│   │   └── PersonalOS.entitlements   # iCloud, CloudKit, Keychain Sharing
│   └── PersonalOS-iOS/         # iOS 18 SwiftUI app
│       ├── PersonalOSApp.swift
│       ├── Info.plist
│       └── PersonalOS.entitlements
├── packages/
│   └── PersonalOSKit/          # SwiftPM package — models, services, AI client, sync
│       ├── Package.swift
│       └── Sources/
│           ├── PersonalOSModels/
│           ├── PersonalOSPersistence/
│           ├── PersonalOSServices/
│           └── PersonalOSUI/         # shared SwiftUI views + design tokens
├── Prompts/                    # versioned LLM prompts (used in Sprint 3)
├── tasks/
│   ├── todo.md                 # this file
│   └── lessons.md              # captured after corrections
└── README.md
```

Bundle IDs:
- Mac app: `com.zelig.PersonalOS.mac`
- iOS app: `com.zelig.PersonalOS.ios`
- (Future) widgets / share ext: `com.zelig.PersonalOS.ios.widgets`, `…shareextension`
- iCloud container: `iCloud.com.zelig.PersonalOS` (shared across both apps)
- Keychain access group: `$(AppIdentifierPrefix)com.zelig.PersonalOS.shared`

Why one shared CloudKit container: same private DB on both platforms, no awkward cross-container sync.

### Tasks
- [ ] Create empty Xcode workspace at `personal-os/PersonalOS.xcworkspace`
- [ ] Init `PersonalOSKit` as a local SwiftPM package with the 4 module targets above
- [ ] Create the two app targets, add the package as a local dependency
- [ ] Configure shared scheme that builds Mac + iOS in one shot
- [ ] Wire up entitlements (iCloud + CloudKit + Keychain Sharing) on both apps
- [ ] Add `.gitignore` for Xcode/derived data, init git, first commit on `main`

---

## 2. Persistence: Core Data + CloudKit (recommended over SwiftData)

**Why diverge from the brief here**: SwiftData on macOS 15 / iOS 18 has shipped fixes but still has rough edges with relationships, custom value types, and CloudKit's `NSPersistentCloudKitContainer` integration — exactly the surface area we'll exercise heavily (polymorphic `ReminderRule.config`, `Field.value` as a typed union, `Project.values` keyed by fieldId). Core Data + `NSPersistentCloudKitContainer` is the production-hardened path; we get @Observable wrapper objects to keep SwiftUI ergonomics close to SwiftData.

If the call ever needs to flip back to SwiftData later, the abstraction in `PersonalOSPersistence` keeps it confined.

### Sprint 1 schema (subset of the full data model)

Ship only what the three-list UI needs. Every entity gets `id: UUID`, `createdAt: Date`, `updatedAt: Date`, plus a CloudKit-friendly `recordName` mirror.

- **Todo**
  - title: String
  - notes: String?
  - list: enum `todoList` (`todo` | `monitor` | `later`) — stored as Int16
  - dueDate: Date?
  - snoozedUntil: Date?
  - completedAt: Date?
  - source: enum (`manual` | `nl` | `siri` | `share` | `ai` | `reminder`) — Int16, default `manual`
  - tags: many-to-many → Tag
  - (later sprints: projectIds, peopleIds)
- **Tag**
  - name: String (unique within store)
  - color: String (hex)
  - todos: many-to-many → Todo (inverse)

CloudKit notes:
- Use `NSPersistentCloudKitContainer` with `cloudKitContainerOptions` set to the shared container ID
- All attributes optional in the model file (Apple's CloudKit requirement) — enforce required-ness in the wrapper layer
- No to-many relationship deletes without explicit cascade rules
- Tombstone via `completedAt` rather than hard-deleting in Sprint 1 (simpler conflict resolution)

### Tasks
- [ ] Add `PersonalOSModels` types: `TodoList` enum, `TodoSource` enum, plain Swift `Todo` and `Tag` value types for view layer
- [ ] Add `.xcdatamodeld` to `PersonalOSPersistence` with `CDTodo`, `CDTag`
- [ ] `PersistenceController` actor: opens `NSPersistentCloudKitContainer`, exposes a `MainActor` view context + a background context
- [ ] CRUD repository: `TodoRepository` with `create`, `update`, `delete (soft)`, `fetchByList(_:)`, observable via `@Observable` snapshots
- [ ] Same pattern for `TagRepository`
- [ ] Unit tests with in-memory store (no CloudKit) for repo behavior
- [ ] One smoke test that opens the real container against an iCloud sandbox account

---

## 3. CloudKit sync end-to-end

### Tasks
- [ ] Confirm the chosen Apple Developer team has CloudKit enabled
- [ ] Create the `iCloud.com.zelig.PersonalOS` container in the developer portal
- [ ] Both apps signed into the same iCloud account in dev: verify a Todo created on Mac shows up on the iOS sim within ~30s
- [ ] Verify CloudKit Console shows the records under the private database
- [ ] Document the deployment promotion step (Development → Production) in `tasks/lessons.md`

Edge cases to verify before declaring sync "done":
- [ ] iCloud account signed out → app stays usable, queues local changes
- [ ] Network offline at launch → local-first reads work, writes flush on reconnect
- [ ] Conflicting edits across devices → last-writer-wins via `updatedAt`, no data loss
- [ ] Schema migration when we add a field in Sprint 2 — confirm CloudKit accepts new optional fields without a destructive deploy

---

## 4. UI — three-list todo MVP

### Mac (PersonalOS-Mac)
- Three-pane `NavigationSplitView`
- Sidebar: "To Do", "Monitor", "Later" rows + a future-stub "Smart Filters" disclosure group
- Middle: list of todos for the selected list, sorted by dueDate (asc, nulls last) then createdAt
- Detail: editable form for the selected todo — title, notes, list picker, due date, tag chips
- Toolbar: ⌘N new todo, ⌘D mark done, ⌘⌫ delete (soft)
- No menu bar quick-add yet (Sprint 3)

### iOS (PersonalOS-iOS)
- TabView: Today / Lists / People (placeholder) / Dashboards (placeholder) / More
- "Lists" tab: `NavigationStack` with the 3 lists, drill into list → list of todos → detail
- "Today" tab: union of todos with `dueDate <= endOfToday` plus overdue, grouped (Overdue, Today)
- Swipe actions: complete, snooze 1d, delete (soft)
- Pull to refresh forces a CloudKit fetch

### Shared SwiftUI in `PersonalOSUI`
- `TodoRow` view used on both platforms
- `TodoEditor` form — adapts via size class
- `ListPicker` enum-driven menu

### Tasks
- [ ] Build Mac three-pane shell against mock data first, then wire repo
- [ ] Build iOS tab shell against mock data, then wire repo
- [ ] Verify create-on-Mac shows on iOS within 30s and vice versa
- [ ] Soft-delete UX: deleted todos disappear from lists but remain in store with a `deletedAt` (add this field)

---

## 5. Verification gate — Sprint 1 done means

- [ ] Both apps build clean for Release on their respective platforms
- [ ] All `PersonalOSKit` unit tests green
- [ ] Demo loop recorded: create on Mac → appears on iOS → edit on iOS → updates on Mac → mark done → both stay in sync
- [ ] Cold launch on iOS < 1.5s on a current device
- [ ] No print() in committed code; logging via `os.Logger` only
- [ ] `tasks/lessons.md` updated with anything that bit us during sync setup

---

## Out of scope for Sprint 1 (deferred)

- People model + tiles (Sprint 2)
- Dashboards / projects / fields (Sprint 2)
- File uploads + Dropbox (Sprint 2/3)
- Anthropic client + NL capture (Sprint 3)
- Reminder engine (Sprint 4)
- Vault (Sprint 5)
- Widgets, share sheet, Action Button intent (Sprint 4)

---

## Open questions for Eddie before I start coding

1. Confirm Core Data + CloudKit over SwiftData — or stay with SwiftData per the brief?
2. Which Apple Developer team / signing identity? (affects bundle prefix availability and CloudKit container ownership)
3. Do you want me to use `eddie@infinitemachine.com` as the git identity here, same as the IM repos? Personal OS is a personal project so it could plausibly be a different identity — your call.
4. Worth a one-time Things importer in Sprint 1, or wait until v1 polish (Sprint 5)? I'd lean toward Sprint 1 so dogfooding starts immediately.

## Review (filled in at end of sprint)

### 2026-05-01 progress

**Done:**
- Repo scaffold at `~/Code/active/personal-os/`, git initialized as `eddie@infinitemachine.com`
- `PersonalOSKit` SwiftPM package, 4 modules, builds clean from CLI
- Core Data + CloudKit persistence with programmatic `NSManagedObjectModel` (had to drop the `.xcdatamodeld` because SwiftPM doesn't run `momc` — see lessons)
- `TodoStore` + `TagStore` with full CRUD, soft-delete, complete/uncomplete, fetchToday
- 15 unit tests, all green
- `XcodeGen project.yml` declares both app targets, regenerable
- Mac three-pane `NavigationSplitView` UI with sidebar / list / detail, ⌘N / ⌘D / ⌘⌫ shortcuts
- iOS TabView UI with Today (overdue + due-today) / Lists / placeholder People / Dashboards / More
- Both apps build clean against macOS 15 / iOS 18 (without code signing)
- 3 lessons captured in `tasks/lessons.md`

**Blocked on user setup (Task #6 — CloudKit sync verification):**
- Need Apple Developer team ID for `DEVELOPMENT_TEAM` env var
- Need iCloud container `iCloud.com.zelig.PersonalOS` created in dev portal
- Need iCloud-signed-in simulator + device to verify cross-device sync

**Done since checkpoint:**
- Task #7 — Things importer
  - `Todo.externalID` field added (CloudKit-friendly opaque dedupe key)
  - `TodoStore.upsertByExternalID(_:)` for idempotent bulk writes
  - `SQLiteReader` (read-only `sqlite3` C-API wrapper, no third-party deps)
  - `ThingsImporter` — reads `TMTask`, maps active+completed → `.todo` list, `things:<UUID>` external key
  - `File → Import from Things…` Mac menu command, `NSOpenPanel`-based, sandbox-safe
  - 5 importer tests against synthetic SQLite databases (idempotency proven)

**Total tests**: 20 passing (was 15)

### Architecture decisions made along the way
- Programmatic Core Data model instead of `.xcdatamodeld` (SwiftPM CLI compatibility)
- `AppEnvironment` is `Sendable`, not `@MainActor` (Swift 6 + `@Entry` macro)
- Stores are sync structs operating on `viewContext`; will revisit async if profiling shows blocking
- Soft-delete via `deletedAt` (CloudKit-friendly tombstones)
- @Observable view models live in `PersonalOSUI`, shared between platforms
