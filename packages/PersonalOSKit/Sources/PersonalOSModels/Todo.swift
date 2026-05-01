import Foundation

public struct Todo: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var title: String
    public var notes: String?
    public var list: TodoList
    public var dueDate: Date?
    public var snoozedUntil: Date?
    public var completedAt: Date?
    public var deletedAt: Date?
    public var source: TodoSource
    public var externalID: String?
    public var tagIDs: Set<UUID>
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        title: String,
        notes: String? = nil,
        list: TodoList = .todo,
        dueDate: Date? = nil,
        snoozedUntil: Date? = nil,
        completedAt: Date? = nil,
        deletedAt: Date? = nil,
        source: TodoSource = .manual,
        externalID: String? = nil,
        tagIDs: Set<UUID> = [],
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.notes = notes
        self.list = list
        self.dueDate = dueDate
        self.snoozedUntil = snoozedUntil
        self.completedAt = completedAt
        self.deletedAt = deletedAt
        self.source = source
        self.externalID = externalID
        self.tagIDs = tagIDs
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isCompleted: Bool { completedAt != nil }
    public var isDeleted: Bool { deletedAt != nil }

    public var isOverdue: Bool {
        guard let dueDate, !isCompleted else { return false }
        return dueDate < .now
    }
}
