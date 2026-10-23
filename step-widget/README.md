# Steps (iOS widget)

Native iPhone app plus WidgetKit extension that puts today's step count on the
Home Screen and Lock Screen. It reads from HealthKit, so it works with the
iPhone's own motion data or an Apple Watch, with nothing to install on the
watch.

Why native: a PWA can't register a Home Screen widget and Safari can't read
HealthKit, so this is the only way to get a live step number onto the Home
Screen from personal-os. The app is deliberately tiny and keeps everything on
the phone. See `quick-todo/` for the macOS sibling.

## How it works

```
HealthKit ──▶ StepCounter app ──▶ App Group (UserDefaults) ──▶ StepWidget
             reads today + 6 days   JSON StepSnapshot            draws ring,
             on open, on HK push,                                bars, count
             on BGAppRefresh
```

- Widget extensions can't query HealthKit directly. The app does the read and
  writes a `StepSnapshot` to the shared App Group; the widget just renders it.
- Refresh paths, most to least reliable: opening the app; HealthKit background
  delivery (`enableBackgroundDelivery`, hourly, re-registered on every launch
  via `AppDelegate`); a `BGAppRefreshTask` safety net iOS runs when it feels
  like it. The widget's own timeline asks for a redraw every 30 minutes and at
  midnight so the count rolls over to 0 even before the app refreshes.
- If the snapshot is more than 3 hours old the widget shows a small clock icon.
  Opening the app once fixes it. Expect the number to lag a bit when you
  haven't unlocked the phone in a while; that is iOS budgeting, not a bug.

Files:

```
Shared/
  StepSnapshot.swift     model + App Group store (both targets)
  StepViews.swift        ProgressRing + WeekBars (both targets)
StepCounter/             app target
  StepCounterApp.swift   entry point, scene phase, AppDelegate launch hooks
  HealthStore.swift      HealthKit auth, read, background delivery, BG task
  ContentView.swift      ring, 7-day bars, goal stepper, widget instructions
StepWidget/              widget extension target
  StepWidget.swift       TimelineProvider + small / medium / Lock Screen views
project.yml              XcodeGen spec (the .xcodeproj is generated, gitignored)
```

## Build and install

Needs a Mac with Xcode 16 or newer, an iPhone on iOS 17 or newer, and an Apple
ID signed into Xcode. A free Apple ID works but the install expires after
7 days; a paid developer account gives a year, or TestFlight.

```bash
brew install xcodegen
cd step-widget
DEVELOPMENT_TEAM=ABCDE12345 ./build.sh     # generates StepCounter.xcodeproj and opens Xcode
```

Team id: Xcode > Settings > Accounts > your team, or developer.apple.com under
Membership. If you skip the env var, set the team in Signing & Capabilities for
both targets after the project opens.

Then in Xcode:

1. Plug in the iPhone, pick it as the run destination, press Run.
2. First run: tap **Allow access** and grant Steps read access in the Health
   sheet. (iOS only reports that you were asked, not what you chose, so if the
   number stays at 0 check Settings > Health > Data Access & Devices > Steps.)
3. On the iPhone, long-press the Home Screen > Edit > Add Widget > Steps.
   Lock Screen: long-press the Lock Screen > Customize > tap the widget area.

Automatic signing will create the App ID with HealthKit and App Groups
enabled from the entitlements files. If Xcode complains about the App Group,
open Signing & Capabilities on either target and tick
`group.com.eddie.stepcounter` once; it only needs registering with Apple once.

Building a copy for someone else: change `bundleIdPrefix` in `project.yml` and
the `group.` id in both entitlements files and `StepStore.appGroup` so the
identifiers don't collide with yours, then follow the steps above with their
team.

## Widget sizes

| Family | Shows |
| --- | --- |
| Small | count, mini ring |
| Medium | count, remaining, percent ring, 7-day bars |
| Lock Screen circular | gauge with compact count |
| Lock Screen rectangular | count, linear gauge |
| Lock Screen inline | "6,240 steps" |

Daily goal is set in the app (500-step increments, default 10,000) and drives
every ring and gauge.

## Not done here

This container has no Swift toolchain, so the sources have not been compiled.
Plist and project spec files were validated; expect at most small compiler
nits on first build in Xcode.

Next step if wanted: have `HealthStore.refresh()` also POST the snapshot to a
personal-os capture endpoint with the bearer token, the same way quick-todo
does, so the Personal dashboard keeps step history alongside workouts.
