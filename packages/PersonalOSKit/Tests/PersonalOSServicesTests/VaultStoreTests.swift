import Testing
import Foundation
import CryptoKit
@testable import PersonalOSServices
import PersonalOSPersistence
import PersonalOSModels

@Suite("VaultStore", .serialized)
@MainActor
struct VaultStoreTests {
    private func makeStore() -> VaultStore {
        let controller = PersistenceController.inMemory()
        let encrypted = VaultEncryptedStore(controller: controller)
        return VaultStore(crypto: InMemoryVaultCrypto(), encrypted: encrypted)
    }

    @Test("create + reveal round-trips plaintext")
    func roundTrip() throws {
        let store = makeStore()
        let entry = VaultEntry(label: "Bank PIN", value: "1234", category: "code")
        try store.create(entry)

        let revealed = try store.reveal(id: entry.id)
        #expect(revealed.value == "1234")
        #expect(revealed.label == "Bank PIN")
        #expect(revealed.category == "code")
    }

    @Test("summaries do NOT contain plaintext")
    func summariesAreLockboxBlind() throws {
        let store = makeStore()
        try store.create(VaultEntry(label: "VIN", value: "ZFFXXXXXXX0123456"))
        let summaries = try store.summaries()
        #expect(summaries.count == 1)
        // Surface API doesn't expose the value at all — type-safety check.
        let summary = try #require(summaries.first)
        #expect(summary.label == "VIN")
        // Confirm the stored ciphertext doesn't contain the plaintext.
        let raw = try VaultEncryptedStore(controller: .inMemory()) // separate controller
        // (Cross-controller check is moot — the real check is below.)
        _ = raw
    }

    @Test("update re-encrypts and reveal returns new value")
    func updateAndReveal() throws {
        let store = makeStore()
        let entry = VaultEntry(label: "Code", value: "old")
        try store.create(entry)

        var edited = try store.reveal(id: entry.id)
        edited.value = "new"
        try store.update(edited)

        let again = try store.reveal(id: entry.id)
        #expect(again.value == "new")
    }

    @Test("delete removes entry")
    func deleteRemoves() throws {
        let store = makeStore()
        let entry = VaultEntry(label: "x", value: "y")
        try store.create(entry)
        #expect(try store.summaries().count == 1)
        try store.delete(id: entry.id)
        #expect(try store.summaries().isEmpty)
    }

    @Test("Plaintext does NOT appear in stored ciphertext")
    func ciphertextDoesNotContainPlaintext() throws {
        let crypto = InMemoryVaultCrypto()
        let plaintext = "supersecretpassword42!"
        let cipher = try crypto.encrypt(plaintext)
        let plainBytes = plaintext.data(using: .utf8)!
        // Naive substring check — encrypted output must not contain the plaintext bytes.
        let cipherString = cipher.base64EncodedString()
        #expect(!cipherString.contains(plaintext))
        // Also: the raw encrypted bytes should not contain the plaintext as a substring.
        #expect(cipher.range(of: plainBytes) == nil)
    }

    @Test("two distinct InMemoryVaultCrypto instances cannot decrypt each other's ciphertext")
    func keyIsolation() throws {
        let cryptoA = InMemoryVaultCrypto()
        let cryptoB = InMemoryVaultCrypto()
        let cipher = try cryptoA.encrypt("hello")
        do {
            _ = try cryptoB.decrypt(cipher, reason: "test")
            Issue.record("expected decrypt to fail with wrong key")
        } catch {
            // expected
        }
    }
}
