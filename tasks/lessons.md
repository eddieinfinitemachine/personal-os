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
