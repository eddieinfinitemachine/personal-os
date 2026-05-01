import Foundation

public struct Person: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var name: String
    public var role: PersonRole
    public var team: String?
    public var contactRef: String?
    public var notes: String?
    public var birthday: Date?
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        role: PersonRole = .other,
        team: String? = nil,
        contactRef: String? = nil,
        notes: String? = nil,
        birthday: Date? = nil,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.name = name
        self.role = role
        self.team = team
        self.contactRef = contactRef
        self.notes = notes
        self.birthday = birthday
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var initials: String {
        let parts = name
            .split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            .prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.joined().uppercased()
    }
}
