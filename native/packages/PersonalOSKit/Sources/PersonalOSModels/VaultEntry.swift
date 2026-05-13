import Foundation

/// A vault entry as displayed in app code. The plaintext `value` only ever
/// exists in memory and is never serialized to disk in this form — `VaultStore`
/// encrypts it via `VaultCrypto` before persisting.
public struct VaultEntry: Identifiable, Hashable, Sendable {
    public let id: UUID
    public var label: String
    public var value: String
    public var category: String?
    public var notes: String?
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        label: String,
        value: String,
        category: String? = nil,
        notes: String? = nil,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.category = category
        self.notes = notes
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// A list-view summary that doesn't carry the plaintext value.
    /// Used so labels can render without unlocking.
    public struct Summary: Identifiable, Hashable, Sendable {
        public let id: UUID
        public let label: String
        public let category: String?
        public let updatedAt: Date

        public init(id: UUID, label: String, category: String?, updatedAt: Date) {
            self.id = id
            self.label = label
            self.category = category
            self.updatedAt = updatedAt
        }
    }
}
