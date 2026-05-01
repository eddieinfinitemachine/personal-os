import Foundation
import os
import PersonalOSModels
import PersonalOSPersistence

public enum VaultStoreError: Error, Sendable {
    case notFound(UUID)
}

/// High-level vault API — encrypts on write, decrypts on read.
/// Decrypts trigger biometric auth via the underlying `VaultCrypto`.
@MainActor
public struct VaultStore: Sendable {
    public let crypto: any VaultCrypto
    private let encrypted: VaultEncryptedStore

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "VaultStore")

    nonisolated public init(crypto: any VaultCrypto, encrypted: VaultEncryptedStore) {
        self.crypto = crypto
        self.encrypted = encrypted
    }

    /// List of summaries — does NOT decrypt. Safe to call without auth.
    public func summaries() throws -> [VaultEntry.Summary] {
        try encrypted.fetchAll().map {
            VaultEntry.Summary(
                id: $0.id,
                label: $0.label,
                category: $0.category,
                updatedAt: $0.updatedAt
            )
        }
    }

    /// Reveal one entry's plaintext. Triggers biometric auth.
    public func reveal(id: UUID, reason: String = "Reveal vault entry") throws -> VaultEntry {
        guard let record = try encrypted.fetch(id: id) else {
            throw VaultStoreError.notFound(id)
        }
        let plaintext = try crypto.decrypt(record.valueCiphertext, reason: reason)
        return VaultEntry(
            id: record.id,
            label: record.label,
            value: plaintext,
            category: record.category,
            notes: record.notes,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
        )
    }

    @discardableResult
    public func create(_ entry: VaultEntry) throws -> VaultEntry.Summary {
        let cipher = try crypto.encrypt(entry.value)
        let record = VaultEncryptedStore.Record(
            id: entry.id,
            label: entry.label,
            category: entry.category,
            notes: entry.notes,
            valueCiphertext: cipher,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
        )
        let saved = try encrypted.create(record)
        return VaultEntry.Summary(
            id: saved.id,
            label: saved.label,
            category: saved.category,
            updatedAt: saved.updatedAt
        )
    }

    @discardableResult
    public func update(_ entry: VaultEntry) throws -> VaultEntry.Summary {
        guard let existing = try encrypted.fetch(id: entry.id) else {
            throw VaultStoreError.notFound(entry.id)
        }
        let cipher = try crypto.encrypt(entry.value)
        var updated = existing
        updated.label = entry.label
        updated.category = entry.category
        updated.notes = entry.notes
        updated.valueCiphertext = cipher
        let saved = try encrypted.update(updated)
        return VaultEntry.Summary(
            id: saved.id,
            label: saved.label,
            category: saved.category,
            updatedAt: saved.updatedAt
        )
    }

    public func delete(id: UUID) throws {
        try encrypted.delete(id: id)
    }
}
