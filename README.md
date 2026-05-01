# Personal OS

Native macOS + iOS app: todos, people, project dashboards, birthdays, vault, with Claude as the always-on capture/prioritization layer. Local-first, iCloud-synced.

## Layout

```
apps/
  PersonalOS-Mac/        macOS 15 SwiftUI app
  PersonalOS-iOS/        iOS 18 SwiftUI app
packages/
  PersonalOSKit/         shared SwiftPM package
    PersonalOSModels       value types (Todo, Tag, ...)
    PersonalOSPersistence  Core Data + CloudKit
    PersonalOSServices     AI client, sync, reminders engine
    PersonalOSUI           shared SwiftUI views
Prompts/                 versioned LLM prompts
tasks/                   plan + lessons
```

## Build

```sh
# Build + test the shared package from CLI
cd packages/PersonalOSKit
swift build
swift test

# Generate Xcode workspace (regenerable from project.yml)
cd ../..
xcodegen generate
open PersonalOS.xcworkspace
```

`PersonalOS.xcworkspace` and the generated `.xcodeproj`s are gitignored — `project.yml` is the source of truth.

## Configuration

Before signing/CloudKit:
- Apple Developer team ID needed (sets `DEVELOPMENT_TEAM` in `project.yml`)
- iCloud container `iCloud.com.zelig.PersonalOS` must exist in the dev portal

## Status

Sprint 1 in progress — see `tasks/todo.md`.
