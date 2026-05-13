import Testing
import Foundation
@testable import PersonalOSServices
import PersonalOSPersistence
import PersonalOSModels

@Suite("ReminderEngine", .serialized)
@MainActor
struct ReminderEngineTests {
    private func makeStack() -> (
        ReminderEngine,
        ReminderStore,
        DashboardStore,
        TodoStore
    ) {
        let controller = PersistenceController.inMemory()
        let reminders = ReminderStore(controller: controller)
        let dashboards = DashboardStore(controller: controller)
        let todos = TodoStore(controller: controller)
        let engine = ReminderEngine(
            reminders: reminders,
            dashboards: dashboards,
            todos: todos
        )
        return (engine, reminders, dashboards, todos)
    }

    // MARK: Pure scheduling

    @Test("before-date rule schedules N days before anchor")
    func beforeDateSchedules() {
        let leaseEnd = Date(timeIntervalSince1970: 1_750_000_000)
        let field = FieldValue(label: "Lease end", kind: .date, position: 0, dateValue: leaseEnd)
        let dashboard = Dashboard(name: "Apt", fields: [field])
        let rule = ReminderRule(
            dashboardID: dashboard.id,
            fieldID: field.id,
            name: "lease soon",
            kind: .beforeDate,
            config: .before(days: 14)
        )
        let next = ReminderEngine.computeNextFire(
            rule: rule, dashboard: dashboard, now: leaseEnd.addingTimeInterval(-86_400 * 30)
        )
        let expected = Calendar.current.date(byAdding: .day, value: -14, to: leaseEnd)!
        #expect(next == expected)
    }

    @Test("before-date rule returns nil when anchor field has no date")
    func beforeDateNoAnchor() {
        let field = FieldValue(label: "Lease end", kind: .date, position: 0)
        let dashboard = Dashboard(name: "Apt", fields: [field])
        let rule = ReminderRule(
            dashboardID: dashboard.id,
            fieldID: field.id,
            name: "x",
            kind: .beforeDate,
            config: .before(days: 14)
        )
        #expect(ReminderEngine.computeNextFire(rule: rule, dashboard: dashboard, now: .now) == nil)
    }

    @Test("recurring schedules interval after lastFiredAt")
    func recurringAfterFire() {
        let lastFired = Date.now.addingTimeInterval(-86_400)
        let rule = ReminderRule(
            dashboardID: UUID(),
            name: "weekly",
            kind: .recurring,
            config: .recurring(everyDays: 7),
            lastFiredAt: lastFired,
            createdAt: lastFired.addingTimeInterval(-86_400 * 30)
        )
        let next = ReminderEngine.computeNextFire(
            rule: rule, dashboard: Dashboard(name: "X"), now: .now, afterFiring: true
        )
        let expected = Calendar.current.date(byAdding: .day, value: 7, to: lastFired)!
        #expect(next == expected)
    }

    @Test("recurring fires immediately on first scheduling")
    func recurringFirstFire() {
        let now = Date.now
        let rule = ReminderRule(
            dashboardID: UUID(),
            name: "weekly",
            kind: .recurring,
            config: .recurring(everyDays: 7),
            lastFiredAt: nil,
            createdAt: now.addingTimeInterval(-3600)
        )
        let next = ReminderEngine.computeNextFire(rule: rule, dashboard: Dashboard(name: "X"), now: now)
        #expect(next == now) // first fire is "now"
    }

    @Test("disabled rule never schedules")
    func disabledRule() {
        let leaseEnd = Date.now.addingTimeInterval(86_400 * 30)
        let field = FieldValue(label: "x", kind: .date, dateValue: leaseEnd)
        let dashboard = Dashboard(name: "X", fields: [field])
        let rule = ReminderRule(
            dashboardID: dashboard.id,
            fieldID: field.id,
            name: "x",
            kind: .beforeDate,
            config: .before(days: 7),
            enabled: false
        )
        #expect(ReminderEngine.computeNextFire(rule: rule, dashboard: dashboard, now: .now) == nil)
    }

    // MARK: tick() integration

    @Test("tick fires due before-date rule and creates a todo")
    func tickFiresBefore() throws {
        let (engine, reminders, dashboards, todos) = makeStack()

        // Lease end is 5 days from now; we want a 14-day-before reminder, so it
        // should already be overdue and fire immediately.
        let leaseEnd = Date.now.addingTimeInterval(5 * 86_400)
        let field = FieldValue(label: "Lease end", kind: .date, position: 0, dateValue: leaseEnd)
        var dashboard = Dashboard(name: "Apt", fields: [field])
        try dashboards.create(dashboard)
        dashboard = try #require(try dashboards.fetch(id: dashboard.id))
        let savedField = try #require(dashboard.fields.first)

        try reminders.create(ReminderRule(
            dashboardID: dashboard.id,
            fieldID: savedField.id,
            name: "Lease coming up",
            kind: .beforeDate,
            config: .before(days: 14)
        ))

        try engine.recomputeRules(forDashboardID: dashboard.id)
        let result = try engine.tick()

        #expect(result.firedRuleIDs.count == 1)
        #expect(result.createdTodoIDs.count == 1)

        // The created todo should land on the .todo list and be visible.
        let active = try todos.fetch(list: .todo)
        #expect(active.contains { $0.title.contains("Lease coming up") })
        #expect(active.contains { $0.source == .reminder })
    }

    @Test("tick is idempotent — already-fired rule won't fire again until next anchor")
    func tickIdempotent() throws {
        let (engine, reminders, dashboards, _) = makeStack()
        let leaseEnd = Date.now.addingTimeInterval(5 * 86_400)
        let field = FieldValue(label: "Lease end", kind: .date, position: 0, dateValue: leaseEnd)
        let dashboard = Dashboard(name: "Apt", fields: [field])
        try dashboards.create(dashboard)
        let stored = try #require(try dashboards.fetch(id: dashboard.id))
        let storedField = try #require(stored.fields.first)

        try reminders.create(ReminderRule(
            dashboardID: dashboard.id,
            fieldID: storedField.id,
            name: "soon",
            kind: .beforeDate,
            config: .before(days: 14)
        ))

        try engine.recomputeRules(forDashboardID: dashboard.id)
        let first = try engine.tick()
        #expect(first.firedRuleIDs.count == 1)

        let second = try engine.tick()
        #expect(second.firedRuleIDs.isEmpty)
    }

    @Test("dashboard delete cascades reminder rules via soft FK")
    func dashboardDeleteCascadesReminders() throws {
        let (_, reminders, dashboards, _) = makeStack()
        let dashboard = Dashboard(name: "Doomed")
        try dashboards.create(dashboard)
        try reminders.create(ReminderRule(
            dashboardID: dashboard.id,
            name: "x",
            kind: .recurring,
            config: .recurring(everyDays: 7)
        ))
        #expect(try reminders.fetch(dashboardID: dashboard.id).count == 1)

        try dashboards.delete(id: dashboard.id)
        #expect(try reminders.fetch(dashboardID: dashboard.id).isEmpty)
    }
}
