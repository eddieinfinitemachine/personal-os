import Foundation

/// What the widget renders: today's total, the daily goal, and a short history
/// of previous days. The app writes it (from HealthKit) into the shared App
/// Group container; the widget extension reads it from there. Widget
/// extensions cannot query HealthKit themselves, so this hand-off is the whole
/// design.
struct StepSnapshot: Codable, Equatable {
    struct Day: Codable, Equatable, Identifiable {
        /// Local start-of-day.
        let date: Date
        let steps: Int
        var id: Date { date }
    }

    /// Steps so far today.
    var today: Int
    /// Daily goal, used for the progress ring.
    var goal: Int
    /// Previous days, oldest first. Does not include today.
    var history: [Day]
    /// When the app last read HealthKit.
    var updatedAt: Date

    static let defaultGoal = 10_000

    /// Progress toward the goal, clamped to 0...1 for ring drawing.
    var progress: Double {
        guard goal > 0 else { return 0 }
        return min(1, max(0, Double(today) / Double(goal)))
    }

    var remaining: Int { max(0, goal - today) }

    /// History plus today, oldest first. Handy for bar charts.
    var week: [Day] {
        history + [Day(date: Calendar.current.startOfDay(for: updatedAt), steps: today)]
    }

    /// Shown before the app has ever written a snapshot.
    static let empty = StepSnapshot(today: 0, goal: defaultGoal, history: [], updatedAt: .distantPast)

    /// Shown in the widget gallery and while redacted.
    static var placeholder: StepSnapshot {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)
        let sample = [4_200, 8_100, 11_050, 7_300, 9_800, 5_600]
        let history = sample.enumerated().map { offset, steps in
            Day(date: calendar.date(byAdding: .day, value: offset - sample.count, to: startOfToday) ?? startOfToday, steps: steps)
        }
        return StepSnapshot(today: 6_240, goal: defaultGoal, history: history, updatedAt: .now)
    }

    /// If this snapshot was written on an earlier day, roll yesterday's total
    /// into history and show zero for today instead of a stale number.
    func rolledForward(to now: Date = .now, calendar: Calendar = .current) -> StepSnapshot {
        guard updatedAt != .distantPast, !calendar.isDate(updatedAt, inSameDayAs: now) else { return self }
        var next = self
        next.history.append(Day(date: calendar.startOfDay(for: updatedAt), steps: today))
        next.history = Array(next.history.suffix(StepStore.historyDays))
        next.today = 0
        return next
    }
}

/// Shared storage. Both targets must have the same App Group entitlement.
enum StepStore {
    static let appGroup = "group.com.eddie.stepcounter"
    /// Days of history kept (excluding today).
    static let historyDays = 6

    private static let snapshotKey = "snapshot.v1"
    private static let goalKey = "goal.v1"
    private static let authRequestedKey = "healthkit.requested.v1"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    static func load() -> StepSnapshot? {
        guard let data = defaults.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(StepSnapshot.self, from: data)
    }

    static func save(_ snapshot: StepSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
    }

    static var goal: Int {
        get {
            let value = defaults.integer(forKey: goalKey)
            return value > 0 ? value : StepSnapshot.defaultGoal
        }
        set { defaults.set(max(500, newValue), forKey: goalKey) }
    }

    /// We can't ask HealthKit whether read access was granted (it hides denials
    /// on purpose), so remember that we asked and just try to read.
    static var healthAuthorizationRequested: Bool {
        get { defaults.bool(forKey: authRequestedKey) }
        set { defaults.set(newValue, forKey: authRequestedKey) }
    }
}
