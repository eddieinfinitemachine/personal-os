import Foundation
import os
import PersonalOSModels
import PersonalOSPersistence

@MainActor
public struct BirthdayService: Sendable {
    public let people: PersonStore
    public let todos: TodoStore
    public let leadDays: Int

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "BirthdayService")

    public init(people: PersonStore, todos: TodoStore, leadDays: Int = 3) {
        self.people = people
        self.todos = todos
        self.leadDays = leadDays
    }

    /// Ensures a "Wish X happy birthday" todo exists for every person whose
    /// next birthday is within `leadDays` days. Idempotent — re-runs are
    /// no-ops once todos exist.
    /// Returns the number of todos created on this tick.
    @discardableResult
    public func tick(now: Date = .now, calendar: Calendar = .current) throws -> Int {
        let allPeople = try people.fetchAll()
        var created = 0

        for person in allPeople {
            guard let birthday = person.birthday else { continue }
            guard let nextBirthday = Self.nextOccurrence(of: birthday, after: now, calendar: calendar) else {
                continue
            }
            let daysUntil = calendar.dateComponents(
                [.day],
                from: calendar.startOfDay(for: now),
                to: calendar.startOfDay(for: nextBirthday)
            ).day ?? Int.max

            guard daysUntil <= leadDays else { continue }

            let year = calendar.component(.year, from: nextBirthday)
            let externalID = "birthday:\(person.id.uuidString):\(year)"
            if let _ = try todos.fetch(externalID: externalID) {
                continue // already created for this year
            }

            let todo = Todo(
                title: "Wish \(person.name) happy birthday",
                notes: "Birthday: \(Self.formatted(date: nextBirthday))",
                list: .todo,
                dueDate: nextBirthday,
                source: .reminder,
                externalID: externalID,
                personIDs: [person.id]
            )
            try todos.create(todo)
            created += 1
        }

        if created > 0 {
            Self.logger.info("Birthday tick created \(created) todo(s)")
        }
        return created
    }

    /// Next occurrence of `birthday` (which can be from any year) on or after
    /// `reference`. Handles Feb 29 by falling back to Feb 28 in non-leap years.
    static func nextOccurrence(
        of birthday: Date,
        after reference: Date,
        calendar: Calendar
    ) -> Date? {
        let monthDay = calendar.dateComponents([.month, .day], from: birthday)
        guard let month = monthDay.month, let day = monthDay.day else { return nil }

        let referenceComponents = calendar.dateComponents([.year, .month, .day], from: reference)
        guard var year = referenceComponents.year else { return nil }

        var attempt = DateComponents(year: year, month: month, day: day)
        // If we're past this year's birthday, look at next year.
        if let thisYearDate = calendar.date(from: attempt),
           calendar.startOfDay(for: thisYearDate) < calendar.startOfDay(for: reference) {
            year += 1
            attempt = DateComponents(year: year, month: month, day: day)
        }
        // Feb 29 in a non-leap year: roll back to Feb 28.
        if month == 2, day == 29, !Self.isLeapYear(year) {
            attempt.day = 28
        }
        return calendar.date(from: attempt)
    }

    private static func isLeapYear(_ year: Int) -> Bool {
        (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
    }

    private static func formatted(date: Date) -> String {
        date.formatted(.dateTime.month(.wide).day().year())
    }
}
