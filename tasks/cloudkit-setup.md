# CloudKit setup — Task #6

This task requires an Apple Developer account + iCloud-signed devices/simulators. Cannot be completed by tooling alone. Steps below.

## 1. Set the development team

Find your team ID at <https://developer.apple.com/account> → Membership → Team ID (10-character string like `ABCD12EFGH`).

```sh
export DEVELOPMENT_TEAM=ABCD12EFGH
cd ~/Code/active/personal-os
xcodegen generate
```

Confirm by opening `PersonalOS.xcodeproj` → Signing & Capabilities → both targets show your team.

## 2. Create the iCloud container

1. <https://developer.apple.com/account/resources/identifiers/list/cloudContainer>
2. New Identifier → iCloud Containers
3. Description: `PersonalOS`
4. Identifier: **`iCloud.com.zelig.PersonalOS`** (must match exactly — already wired into entitlements)

Then in Xcode → both targets → Signing & Capabilities → iCloud → tick `iCloud.com.zelig.PersonalOS` so each target is associated with the container.

## 3. Verify on Mac

```sh
cd ~/Code/active/personal-os
xcodebuild -project PersonalOS.xcodeproj -scheme PersonalOS-Mac \
  -configuration Debug -destination 'platform=macOS' build
```

(no `CODE_SIGNING_ALLOWED=NO` this time — we need real signing)

Run from Xcode. Sign into iCloud in System Settings if not already. Create a few todos.

## 4. Verify on iOS Simulator

The simulator must be signed into iCloud:
- Simulator → Settings → Sign in to your Apple Account → use the same iCloud account as your Mac
- Wait ~30s for sync after signing in

Run PersonalOS-iOS in the simulator from Xcode. Todos created on Mac should appear on iOS within ~30s, and vice versa.

## 5. Verify in CloudKit Console

<https://icloud.developer.apple.com/dashboard/> → Container → Schema → confirm `CDTodo` and `CDTag` record types exist with the expected fields.

Records appear under `Data` → Private Database → Default Zone, scoped to your iCloud account.

## 6. Edge cases worth poking at

- Sign out of iCloud on iOS → app stays usable, queues writes locally
- Airplane mode → writes still local, sync resumes on reconnect
- Edit same todo on both devices simultaneously → last write wins via `updatedAt`
- Quit and relaunch on both → state matches

## 7. Promote to production

Once dev works:

CloudKit Console → Schema → **Promote Schema to Production**. Required before App Store / TestFlight builds will sync.

## Notes

- `usedWithCloudKit="YES"` flag isn't set anywhere because we use a programmatic model. CloudKit sync is enabled per-store via `cloudKitContainerOptions` on the persistent store description (`PersistenceController.swift:41-43`).
- All entity attributes are `optional=YES` — required by CloudKit. Required-ness is enforced in the value-type layer (`Todo.swift`).
- Soft-delete via `deletedAt` is intentional; CloudKit hates hard deletes when there are pending uploads.
