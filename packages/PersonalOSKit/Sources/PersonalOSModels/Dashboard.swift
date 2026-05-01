import Foundation

public struct Dashboard: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var name: String
    /// Free-form type hint ("vehicle", "pet", "home", anything). Used as a
    /// grouping key in UI; not validated against any enum.
    public var type: String
    public var icon: String
    public var fields: [FieldValue]
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        type: String = "general",
        icon: String = "square.grid.2x2",
        fields: [FieldValue] = [],
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.icon = icon
        self.fields = fields.sorted { $0.position < $1.position }
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public func field(id: UUID) -> FieldValue? {
        fields.first { $0.id == id }
    }
}
