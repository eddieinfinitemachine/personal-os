import BackgroundTasks
import Foundation
import HealthKit
import WidgetKit

/// Reads step counts from HealthKit and publishes a snapshot for the widget.
///
/// Refresh paths, most to least reliable:
/// 1. The app is opened (foreground refresh).
/// 2. HealthKit background delivery wakes the app when new step samples land.
/// 3. A BGAppRefreshTask as a safety net, roughly hourly at iOS's discretion.
@MainActor
final class HealthStore: ObservableObject {
    static let shared = HealthStore()
    static let refreshTaskIdentifier = "com.eddie.stepcounter.refresh"

    @Published private(set) var snapshot: StepSnapshot? = StepStore.load()
    @Published private(set) var isRefreshing = false
    @Published var errorMessage: String?

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }
    var hasRequestedAuthorization: Bool { StepStore.healthAuthorizationRequested }

    private let store = HKHealthStore()
    private let stepType = HKQuantityType(.stepCount)
    private var observerQuery: HKObserverQuery?

    private init() {}

    // MARK: Authorization

    func requestAuthorization() async {
        guard isAvailable else {
            errorMessage = "Health data is not available on this device."
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: [stepType])
            StepStore.healthAuthorizationRequested = true
            errorMessage = nil
            await refresh()
            await startBackgroundDelivery()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Refresh

    /// Re-read HealthKit, persist to the App Group, and ask WidgetKit to redraw.
    func refresh() async {
        guard isAvailable, hasRequestedAuthorization else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let next = try await StepReader.snapshot(from: store, type: stepType, goal: StepStore.goal)
            snapshot = next
            StepStore.save(next)
            WidgetCenter.shared.reloadAllTimelines()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func updateGoal(_ goal: Int) {
        StepStore.goal = goal
        if var current = snapshot {
            current.goal = StepStore.goal
            snapshot = current
            StepStore.save(current)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    // MARK: Background delivery

    /// Called at every launch (including background launches by HealthKit).
    /// The observer query must be re-registered each time the process starts.
    func startBackgroundDeliveryIfAuthorized() {
        guard isAvailable, hasRequestedAuthorization else { return }
        Task { await startBackgroundDelivery() }
    }

    private func startBackgroundDelivery() async {
        do {
            try await store.enableBackgroundDelivery(for: stepType, frequency: .hourly)
        } catch {
            // Non-fatal (and expected on the simulator): the foreground and
            // BGAppRefresh paths still work, so don't alarm the user.
        }
        guard observerQuery == nil else { return }
        let query = HKObserverQuery(sampleType: stepType, predicate: nil) { _, completionHandler, _ in
            Task { @MainActor in
                await HealthStore.shared.refresh()
                completionHandler()
            }
        }
        store.execute(query)
        observerQuery = query
    }

    // MARK: BGAppRefresh safety net

    nonisolated static func registerBackgroundTask() {
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskIdentifier, using: nil) { task in
            Task { @MainActor in
                await HealthStore.shared.refresh()
                HealthStore.scheduleBackgroundRefresh()
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = {
                task.setTaskCompleted(success: false)
            }
        }
    }

    nonisolated static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

/// Pure HealthKit read, isolated from the main actor so the query can run
/// wherever HealthKit wants to call back.
enum StepReader {
    static func snapshot(from store: HKHealthStore, type: HKQuantityType, goal: Int) async throws -> StepSnapshot {
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        guard
            let start = calendar.date(byAdding: .day, value: -StepStore.historyDays, to: startOfToday),
            let end = calendar.date(byAdding: .day, value: 1, to: startOfToday)
        else { return StepSnapshot(today: 0, goal: goal, history: [], updatedAt: now) }

        let samples = HKSamplePredicate.quantitySample(
            type: type,
            predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        )
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: samples,
            options: .cumulativeSum,
            anchorDate: startOfToday,
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await descriptor.result(for: store)

        var days: [StepSnapshot.Day] = []
        collection.enumerateStatistics(from: start, to: end) { statistics, _ in
            let steps = statistics.sumQuantity()?.doubleValue(for: .count()) ?? 0
            days.append(StepSnapshot.Day(date: statistics.startDate, steps: Int(steps.rounded())))
        }

        let today = days.first(where: { calendar.isDate($0.date, inSameDayAs: now) })?.steps ?? 0
        let history = days.filter { $0.date < startOfToday }.suffix(StepStore.historyDays)
        return StepSnapshot(today: today, goal: goal, history: Array(history), updatedAt: now)
    }
}
