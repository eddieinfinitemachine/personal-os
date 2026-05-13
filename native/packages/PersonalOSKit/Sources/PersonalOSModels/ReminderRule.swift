import Foundation

public enum ReminderKind: Int16, CaseIterable, Codable, Sendable, Identifiable {
    /// Fire `daysBefore` days before the target field's date.
    case beforeDate = 0
    /// Fire `daysAfter` days after the target field's date.
    case afterDate = 1
    /// Fire every `intervalDays` days starting from `createdAt`.
    case recurring = 2
    /// Reserved — Sprint 4.5+ (needs change-detection plumbing on field writes).
    case threshold = 3

    public var id: Int16 { rawValue }

    public var title: String {
        switch self {
        case .beforeDate: "Before date"
        case .afterDate: "After date"
        case .recurring: "Recurring"
        case .threshold: "When threshold crossed"
        }
    }

    public static var userPickable: [ReminderKind] {
        [.beforeDate, .afterDate, .recurring]
    }
}

public enum ReminderAction: Int16, CaseIterable, Codable, Sendable {
    case createTodo = 0
    /// Reserved — Sprint 5 once we ask for notification permission.
    case notify = 1
    /// Reserved — Sprint 4.5 (Claude inbox).
    case inboxPrompt = 2

    public var title: String {
        switch self {
        case .createTodo: "Create todo"
        case .notify: "Notify"
        case .inboxPrompt: "Ask in inbox"
        }
    }
}

/// Polymorphic config for a `ReminderRule`. Stored as JSON in Core Data.
public struct ReminderConfig: Hashable, Sendable, Codable {
    public var daysBefore: Int?
    public var daysAfter: Int?
    public var intervalDays: Int?

    public init(
        daysBefore: Int? = nil,
        daysAfter: Int? = nil,
        intervalDays: Int? = nil
    ) {
        self.daysBefore = daysBefore
        self.daysAfter = daysAfter
        self.intervalDays = intervalDays
    }

    public static func before(days: Int) -> ReminderConfig { ReminderConfig(daysBefore: days) }
    public static func after(days: Int) -> ReminderConfig { ReminderConfig(daysAfter: days) }
    public static func recurring(everyDays days: Int) -> ReminderConfig {
        ReminderConfig(intervalDays: days)
    }

    public func encoded() -> String {
        let data = (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    public static func decoded(_ json: String?) -> ReminderConfig {
        guard let json, let data = json.data(using: .utf8) else { return ReminderConfig() }
        return (try? JSONDecoder().decode(ReminderConfig.self, from: data)) ?? ReminderConfig()
    }
}

public struct ReminderRule: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var dashboardID: UUID
    /// Optional: when set, the rule references a specific field's value.
    public var fieldID: UUID?
    public var name: String
    public var kind: ReminderKind
    public var config: ReminderConfig
    public var action: ReminderAction
    public var nextFireAt: Date?
    public var lastFiredAt: Date?
    public var enabled: Bool
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        dashboardID: UUID,
        fieldID: UUID? = nil,
        name: String,
        kind: ReminderKind,
        config: ReminderConfig,
        action: ReminderAction = .createTodo,
        nextFireAt: Date? = nil,
        lastFiredAt: Date? = nil,
        enabled: Bool = true,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.dashboardID = dashboardID
        self.fieldID = fieldID
        self.name = name
        self.kind = kind
        self.config = config
        self.action = action
        self.nextFireAt = nextFireAt
        self.lastFiredAt = lastFiredAt
        self.enabled = enabled
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
