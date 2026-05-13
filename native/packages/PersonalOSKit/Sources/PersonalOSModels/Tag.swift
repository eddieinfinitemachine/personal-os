import Foundation

public struct Tag: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var name: String
    public var color: String
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        color: String = "#9CA3AF",
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.name = name
        self.color = color
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
