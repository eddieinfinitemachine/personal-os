import Foundation
import os
import PersonalOSModels
import PersonalOSPersistence

public struct ReminderEngineResult: Sendable {
    public let firedRuleIDs: [UUID]
    public let createdTodoIDs: [UUID]
}

@MainActor
public struct ReminderEngine: Sendable {
    public let reminders: ReminderStore
    public let dashboards: DashboardStore
    public let todos: TodoStore

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "ReminderEngine")

    public init(
        reminders: ReminderStore,
        dashboards: DashboardStore,
        todos: TodoStore
    ) {
        self.reminders = reminders
        self.dashboards = dashboards
        self.todos = todos
    }

    /// Recompute `nextFireAt` for every rule on the dashboard. Called after
    /// any field-value or rule write — cheap because rules per dashboard are
    /// small in cardinality.
    public func recomputeRules(forDashboardID dashboardID: UUID, now: Date = .now) throws {
        guard let dashboard = try dashboards.fetch(id: dashboardID) else { return }
        let existing = try reminders.fetch(dashboardID: dashboardID)
        for rule in existing {
            let nextFire = Self.computeNextFire(
                rule: rule,
                dashboard: dashboard,
                now: now
            )
            if nextFire != rule.nextFireAt {
                var updated = rule
                updated.nextFireAt = nextFire
                try reminders.update(updated)
            }
        }
    }

    /// Recompute and fire any rule whose nextFireAt is at or before `now`.
    /// Returns IDs of fired rules and any auto-created todos.
    @discardableResult
    public func tick(now: Date = .now) throws -> ReminderEngineResult {
        let due = try reminders.fetchDue(by: now)
        var firedIDs: [UUID] = []
        var createdTodoIDs: [UUID] = []

        for rule in due {
            guard let dashboard = try dashboards.fetch(id: rule.dashboardID) else {
                Self.logger.warning("Dashboard for rule \(rule.id) is gone — skipping")
                continue
            }

            switch rule.action {
            case .createTodo:
                let title = Self.todoTitle(for: rule, dashboard: dashboard)
                let todo = Todo(
                    title: title,
                    notes: dashboard.name,
                    list: .todo,
                    source: .reminder
                )
                try todos.create(todo)
                createdTodoIDs.append(todo.id)
            case .notify, .inboxPrompt:
                // Reserved kinds — not yet wired. Treat as fire-and-forget for
                // bookkeeping so we don't loop on the same rule.
                break
            }

            // Mark fired and schedule next iteration (or clear, for one-shots).
            var updated = rule
            updated.lastFiredAt = now
            updated.nextFireAt = Self.computeNextFire(
                rule: updated,
                dashboard: dashboard,
                now: now,
                afterFiring: true
            )
            try reminders.update(updated)
            firedIDs.append(rule.id)
        }

        return ReminderEngineResult(firedRuleIDs: firedIDs, createdTodoIDs: createdTodoIDs)
    }

    // MARK: - Pure scheduling logic (covered by tests)

    /// Computes when a rule should next fire, given the current dashboard
    /// state. Returns nil if the rule has nothing to fire (e.g. before-date
    /// pointing at a missing date field).
    static func computeNextFire(
        rule: ReminderRule,
        dashboard: Dashboard,
        now: Date,
        afterFiring: Bool = false
    ) -> Date? {
        guard rule.enabled else { return nil }

        switch rule.kind {
        case .beforeDate:
            return beforeDateFire(rule: rule, dashboard: dashboard, now: now)
        case .afterDate:
            return afterDateFire(rule: rule, dashboard: dashboard, now: now)
        case .recurring:
            return recurringFire(rule: rule, now: now, afterFiring: afterFiring)
        case .threshold:
            return nil // reserved
        }
    }

    private static func beforeDateFire(
        rule: ReminderRule,
        dashboard: Dashboard,
        now: Date
    ) -> Date? {
        guard let fieldID = rule.fieldID,
              let target = dashboard.field(id: fieldID)?.dateValue,
              let daysBefore = rule.config.daysBefore else { return nil }
        guard let fire = Calendar.current.date(byAdding: .day, value: -daysBefore, to: target) else {
            return nil
        }
        // If we already fired for this anchor (lastFiredAt ≥ fire) don't refire
        // unless the underlying date changed.
        if let last = rule.lastFiredAt, last >= fire {
            return nil
        }
        // Even if "fire" is in the past, return it — tick() will pick it up
        // and fire immediately. That's correct: the user just configured a
        // reminder whose anchor is already past, so it should fire now.
        return fire
    }

    private static func afterDateFire(
        rule: ReminderRule,
        dashboard: Dashboard,
        now: Date
    ) -> Date? {
        guard let fieldID = rule.fieldID,
              let target = dashboard.field(id: fieldID)?.dateValue,
              let daysAfter = rule.config.daysAfter else { return nil }
        guard let fire = Calendar.current.date(byAdding: .day, value: daysAfter, to: target) else {
            return nil
        }
        if let last = rule.lastFiredAt, last >= fire {
            return nil
        }
        return fire
    }

    private static func recurringFire(
        rule: ReminderRule,
        now: Date,
        afterFiring: Bool
    ) -> Date? {
        guard let interval = rule.config.intervalDays, interval > 0 else { return nil }
        let anchor: Date = rule.lastFiredAt ?? rule.createdAt
        let proposed = Calendar.current.date(byAdding: .day, value: interval, to: anchor) ?? now
        // First-time recurring rules fire immediately.
        if rule.lastFiredAt == nil, !afterFiring {
            return now
        }
        return proposed
    }

    private static func todoTitle(for rule: ReminderRule, dashboard: Dashboard) -> String {
        if !rule.name.isEmpty { return rule.name }
        switch rule.kind {
        case .beforeDate:
            let label = rule.fieldID.flatMap { dashboard.field(id: $0)?.label } ?? "field"
            let days = rule.config.daysBefore ?? 0
            return "\(dashboard.name): \(label) in \(days) day\(days == 1 ? "" : "s")"
        case .afterDate:
            let label = rule.fieldID.flatMap { dashboard.field(id: $0)?.label } ?? "field"
            let days = rule.config.daysAfter ?? 0
            return "\(dashboard.name): follow up on \(label) (+\(days)d)"
        case .recurring:
            return "\(dashboard.name): check-in"
        case .threshold:
            return "\(dashboard.name): threshold"
        }
    }
}
