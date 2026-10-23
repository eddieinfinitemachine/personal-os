import SwiftUI
import WidgetKit

struct StepEntry: TimelineEntry {
    let date: Date
    let snapshot: StepSnapshot
    /// True when the app hasn't refreshed in a while, so the number may lag.
    let isStale: Bool
}

struct StepProvider: TimelineProvider {
    private static let staleAfter: TimeInterval = 3 * 60 * 60

    func placeholder(in context: Context) -> StepEntry {
        StepEntry(date: .now, snapshot: .placeholder, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (StepEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StepEntry>) -> Void) {
        let entry = currentEntry()
        // Redraw in 30 minutes, or at midnight if that comes first so the
        // count visibly resets even before the app has refreshed.
        let calendar = Calendar.current
        let now = Date()
        let halfHour = now.addingTimeInterval(30 * 60)
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? halfHour
        completion(Timeline(entries: [entry], policy: .after(min(halfHour, midnight))))
    }

    private func currentEntry() -> StepEntry {
        guard let stored = StepStore.load() else {
            return StepEntry(date: .now, snapshot: .empty, isStale: true)
        }
        let snapshot = stored.rolledForward()
        let stale = Date.now.timeIntervalSince(stored.updatedAt) > Self.staleAfter
        return StepEntry(date: .now, snapshot: snapshot, isStale: stale)
    }
}

struct StepWidget: Widget {
    let kind = "StepWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StepProvider()) { entry in
            StepWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color("WidgetBackground")
                }
        }
        .configurationDisplayName("Steps")
        .description("Today's step count and progress toward your goal.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

struct StepWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StepEntry

    private var snapshot: StepSnapshot { entry.snapshot }
    private var neverSynced: Bool { snapshot.updatedAt == .distantPast }

    var body: some View {
        switch family {
        case .systemMedium: medium
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .accessoryInline: inline
        default: small
        }
    }

    // MARK: Home Screen

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Spacer(minLength: 4)
            HStack(alignment: .bottom) {
                count
                Spacer()
                ProgressRing(progress: snapshot.progress, lineWidth: 7)
                    .frame(width: 44, height: 44)
            }
        }
    }

    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                header
                Spacer(minLength: 4)
                count
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            ZStack {
                ProgressRing(progress: snapshot.progress, lineWidth: 8)
                Text("\(Int((snapshot.progress * 100).rounded()))%")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
            }
            .frame(width: 64, height: 64)
            WeekBars(days: snapshot.week, goal: snapshot.goal)
                .frame(width: 92, height: 56)
        }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Image(systemName: "figure.walk")
            Text("Steps")
            if entry.isStale && !neverSynced {
                Image(systemName: "clock")
                    .accessibilityLabel("May be out of date")
            }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
    }

    private var count: some View {
        Text(neverSynced ? "Open app" : snapshot.today.formatted())
            .font(.system(size: neverSynced ? 20 : 32, weight: .bold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .contentTransition(.numericText())
    }

    private var subtitle: String {
        if neverSynced { return "to connect Health" }
        return snapshot.remaining == 0 ? "Goal reached" : "\(snapshot.remaining.formatted()) to go"
    }

    // MARK: Lock Screen

    private var circular: some View {
        Gauge(value: snapshot.progress) {
            Image(systemName: "figure.walk")
        } currentValueLabel: {
            Text(compact(snapshot.today))
                .font(.system(.body, design: .rounded).weight(.semibold))
                .minimumScaleFactor(0.6)
        }
        .gaugeStyle(.accessoryCircularCapacity)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            header
            Text(neverSynced ? "Open app" : snapshot.today.formatted())
                .font(.system(.title2, design: .rounded).weight(.bold))
                .monospacedDigit()
            Gauge(value: snapshot.progress) { EmptyView() }
                .gaugeStyle(.accessoryLinearCapacity)
        }
    }

    private var inline: some View {
        Label(neverSynced ? "Steps: open app" : "\(snapshot.today.formatted()) steps", systemImage: "figure.walk")
    }

    private func compact(_ value: Int) -> String {
        value >= 10_000
            ? String(format: "%.1fk", Double(value) / 1_000)
            : value.formatted()
    }
}

#Preview("Small", as: .systemSmall) {
    StepWidget()
} timeline: {
    StepEntry(date: .now, snapshot: .placeholder, isStale: false)
}

#Preview("Medium", as: .systemMedium) {
    StepWidget()
} timeline: {
    StepEntry(date: .now, snapshot: .placeholder, isStale: true)
}
