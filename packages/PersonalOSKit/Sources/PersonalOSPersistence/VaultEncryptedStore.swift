import Foundation
import CoreData

public enum VaultEncryptedStoreError: Error, Sendable {
    case notFound(UUID)
}

/// Low-level CRUD over CDVaultEntry. Operates in ciphertext only — wraps
/// nothing crypto-related. Services-layer `VaultStore` wraps this with a
/// `VaultCrypto` to expose plaintext.
@MainActor
public struct VaultEncryptedStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    public struct Record: Identifiable, Hashable, Sendable {
        public let id: UUID
        public var label: String
        public var category: String?
        public var notes: String?
        public var valueCiphertext: Data
        public let createdAt: Date
        public var updatedAt: Date

        public init(
            id: UUID = UUID(),
            label: String,
            category: String? = nil,
            notes: String? = nil,
            valueCiphertext: Data,
            createdAt: Date = .now,
            updatedAt: Date = .now
        ) {
            self.id = id
            self.label = label
            self.category = category
            self.notes = notes
            self.valueCiphertext = valueCiphertext
            self.createdAt = createdAt
            self.updatedAt = updatedAt
        }
    }

    public func fetchAll() throws -> [Record] {
        let request = CDVaultEntry.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "label", ascending: true)]
        return try controller.viewContext.fetch(request).map(Self.toRecord)
    }

    public func fetch(id: UUID) throws -> Record? {
        try fetchManaged(id: id, in: controller.viewContext).map(Self.toRecord)
    }

    @discardableResult
    public func create(_ record: Record) throws -> Record {
        let context = controller.viewContext
        let cd = CDVaultEntry(context: context)
        Self.apply(record, to: cd)
        try context.save()
        return Self.toRecord(cd)
    }

    @discardableResult
    public func update(_ record: Record) throws -> Record {
        let context = controller.viewContext
        guard let cd = try fetchManaged(id: record.id, in: context) else {
            throw VaultEncryptedStoreError.notFound(record.id)
        }
        var updated = record
        updated.updatedAt = .now
        Self.apply(updated, to: cd)
        try context.save()
        return Self.toRecord(cd)
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cd = try fetchManaged(id: id, in: context) else {
            throw VaultEncryptedStoreError.notFound(id)
        }
        context.delete(cd)
        try context.save()
    }

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDVaultEntry? {
        let request = CDVaultEntry.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    private static func toRecord(_ cd: CDVaultEntry) -> Record {
        Record(
            id: cd.id ?? UUID(),
            label: cd.label ?? "",
            category: cd.category,
            notes: cd.notes,
            valueCiphertext: cd.valueCiphertext ?? Data(),
            createdAt: cd.createdAt ?? .distantPast,
            updatedAt: cd.updatedAt ?? .distantPast
        )
    }

    private static func apply(_ record: Record, to cd: CDVaultEntry) {
        cd.id = record.id
        cd.label = record.label
        cd.category = record.category
        cd.notes = record.notes
        cd.valueCiphertext = record.valueCiphertext
        cd.createdAt = record.createdAt
        cd.updatedAt = record.updatedAt
    }
}
