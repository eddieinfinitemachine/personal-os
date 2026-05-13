import Testing
import Foundation
@testable import PersonalOSServices
import PersonalOSPersistence
import PersonalOSModels

@Suite("BirthdayService", .serialized)
@MainActor
struct BirthdayServiceTests {
    private func makeStack() -> (BirthdayService, PersonStore, TodoStore) {
        let controller = PersistenceController.inMemory()
        let people = PersonStore(controller: controller)
        let todos = TodoStore(controller: controller)
        let service = BirthdayService(people: people, todos: todos, leadDays: 3)
        return (service, people, todos)
    }

    private static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        return Calendar(identifier: .gregorian).date(from: components)!
    }

    @Test("creates a todo when birthday is within lead window")
    func createsWithinWindow() throws {
        let (service, people, todos) = makeStack()
        try people.create(Person(
            name: "Joe",
            role: .peer,
            birthday: Self.date(1985, 5, 4)
        ))

        let now = Self.date(2026, 5, 2) // 2 days before
        let created = try service.tick(now: now)
        #expect(created == 1)

        let active = try todos.fetch(list: .todo)
        let birthdayTodo = try #require(active.first { $0.title.contains("Joe") })
        #expect(birthdayTodo.title == "Wish Joe happy birthday")
        #expect(birthdayTodo.source == .reminder)
        #expect(birthdayTodo.externalID?.starts(with: "birthday:") == true)
    }

    @Test("does not create when outside lead window")
    func skipOutsideWindow() throws {
        let (service, people, _) = makeStack()
        try people.create(Person(
            name: "Far",
            birthday: Self.date(1990, 12, 25)
        ))
        let now = Self.date(2026, 5, 2)
        let created = try service.tick(now: now)
        #expect(created == 0)
    }

    @Test("idempotent within the same year")
    func idempotent() throws {
        let (service, people, todos) = makeStack()
        try people.create(Person(name: "Joe", birthday: Self.date(1985, 5, 4)))
        let now = Self.date(2026, 5, 2)
        _ = try service.tick(now: now)
        let again = try service.tick(now: now)
        #expect(again == 0)
        #expect(try todos.fetch(list: .todo, includeCompleted: true).count == 1)
    }

    @Test("creates new todo next year (different externalID)")
    func newTodoNextYear() throws {
        let (service, people, todos) = makeStack()
        try people.create(Person(name: "Joe", birthday: Self.date(1985, 5, 4)))
        _ = try service.tick(now: Self.date(2026, 5, 2))
        _ = try service.tick(now: Self.date(2027, 5, 2))
        // Two todos total — one per year — both visible.
        let all = try todos.fetch(list: .todo, includeCompleted: true)
        #expect(all.count == 2)
        let externals = Set(all.compactMap(\.externalID))
        #expect(externals.count == 2)
    }

    @Test("nextOccurrence rolls past today's birthday to next year")
    func nextOccurrenceRollsForward() {
        let cal = Calendar(identifier: .gregorian)
        let birthday = Self.date(1985, 5, 4)
        let reference = Self.date(2026, 6, 1) // already past 2026 birthday
        let next = BirthdayService.nextOccurrence(of: birthday, after: reference, calendar: cal)
        let nextYear = cal.component(.year, from: next!)
        #expect(nextYear == 2027)
    }

    @Test("Feb 29 birthday falls back to Feb 28 in non-leap years")
    func leapYearFallback() {
        let cal = Calendar(identifier: .gregorian)
        let birthday = Self.date(2000, 2, 29)
        let reference = Self.date(2027, 1, 1) // 2027 is non-leap
        let next = BirthdayService.nextOccurrence(of: birthday, after: reference, calendar: cal)
        let parts = cal.dateComponents([.year, .month, .day], from: next!)
        #expect(parts.year == 2027)
        #expect(parts.month == 2)
        #expect(parts.day == 28)
    }
}
