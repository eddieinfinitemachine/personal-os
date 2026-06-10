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
color change: "i liked the previous color scheme." Kaizen's flat neutral monochrome look
is intentional. Rule: polish this app via motion, type, spacing, and depth — never recolor
surfaces or selection states without showing Eddie first.
