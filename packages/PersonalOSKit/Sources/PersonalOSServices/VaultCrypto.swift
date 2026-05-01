import Foundation
import CryptoKit
import LocalAuthentication
import Security
import os

public enum VaultCryptoError: Error, CustomStringConvertible, Sendable {
    case keyCreationFailed(OSStatus)
    case keyAccessFailed(OSStatus)
    case unsupportedAlgorithm
    case encryptFailed(String)
    case decryptFailed(String)
    case biometryUnavailable
    case userCancelled

    public var description: String {
        switch self {
        case .keyCreationFailed(let s): "Vault key create failed (\(s))"
        case .keyAccessFailed(let s): "Vault key access failed (\(s))"
        case .unsupportedAlgorithm: "Vault: ECIES X963 SHA256 AES-GCM not supported on this device"
        case .encryptFailed(let m): "Encrypt failed: \(m)"
        case .decryptFailed(let m): "Decrypt failed: \(m)"
        case .biometryUnavailable: "Biometric authentication is not configured on this device."
        case .userCancelled: "Authentication cancelled."
        }
    }
}

public protocol VaultCrypto: Sendable {
    /// Encrypts plaintext UTF-8 text. May not require biometry — the public
    /// key alone can encrypt; only decrypt requires the SE key + biometric.
    func encrypt(_ plaintext: String) throws -> Data

    /// Decrypts ciphertext. On the live SE-backed implementation this triggers
    /// biometric authentication. The reason string is shown in the system
    /// prompt.
    func decrypt(_ ciphertext: Data, reason: String) throws -> String

    /// Confirms the device has a usable vault key (creating one if needed) and
    /// that biometric auth is available. Throws if either is impossible.
    func ensureReady() throws
}

// MARK: - Live Secure Enclave-backed implementation

public final class SecureEnclaveVaultCrypto: VaultCrypto, @unchecked Sendable {
    public let keychainTag: String
    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "VaultCrypto")

    public init(keychainTag: String = "com.zelig.PersonalOS.vault.key.v1") {
        self.keychainTag = keychainTag
    }

    public func ensureReady() throws {
        var error: NSError?
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw VaultCryptoError.biometryUnavailable
        }
        _ = try fetchOrCreateKey()
    }

    public func encrypt(_ plaintext: String) throws -> Data {
        let privateKey = try fetchOrCreateKey()
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw VaultCryptoError.keyAccessFailed(errSecInvalidKeyRef)
        }
        let algorithm: SecKeyAlgorithm = .eciesEncryptionStandardX963SHA256AESGCM
        guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, algorithm) else {
            throw VaultCryptoError.unsupportedAlgorithm
        }
        var error: Unmanaged<CFError>?
        let data = plaintext.data(using: .utf8) ?? Data()
        guard let cipher = SecKeyCreateEncryptedData(publicKey, algorithm, data as CFData, &error) else {
            let msg = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "?"
            throw VaultCryptoError.encryptFailed(msg)
        }
        return cipher as Data
    }

    public func decrypt(_ ciphertext: Data, reason: String) throws -> String {
        let privateKey = try fetchOrCreateKey(prompt: reason)
        let algorithm: SecKeyAlgorithm = .eciesEncryptionStandardX963SHA256AESGCM
        guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, algorithm) else {
            throw VaultCryptoError.unsupportedAlgorithm
        }
        var error: Unmanaged<CFError>?
        guard let plain = SecKeyCreateDecryptedData(privateKey, algorithm, ciphertext as CFData, &error) else {
            let cfError = error?.takeRetainedValue()
            let nsError = cfError as Error?
            // OSStatus -25293 = errSecAuthFailed. -128 = userCanceled in LAError.
            if let nsError = nsError as NSError?,
               nsError.domain == "com.apple.LocalAuthentication" && nsError.code == -2 {
                throw VaultCryptoError.userCancelled
            }
            throw VaultCryptoError.decryptFailed(nsError?.localizedDescription ?? "?")
        }
        guard let s = String(data: plain as Data, encoding: .utf8) else {
            throw VaultCryptoError.decryptFailed("ciphertext did not decode as UTF-8")
        }
        return s
    }

    // MARK: Key management

    private func fetchOrCreateKey(prompt: String? = nil) throws -> SecKey {
        if let existing = try fetchKey(prompt: prompt) {
            return existing
        }
        return try createKey()
    }

    private func keyTagData() -> Data { Data(keychainTag.utf8) }

    private func fetchKey(prompt: String?) throws -> SecKey? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTagData(),
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        if let prompt {
            let context = LAContext()
            context.localizedReason = prompt
            query[kSecUseAuthenticationContext as String] = context
            query[kSecUseOperationPrompt as String] = prompt
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            return (item as! SecKey)
        case errSecItemNotFound:
            return nil
        default:
            throw VaultCryptoError.keyAccessFailed(status)
        }
    }

    private func createKey() throws -> SecKey {
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &accessError
        ) else {
            throw VaultCryptoError.keyCreationFailed(errSecParam)
        }

        var attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: keyTagData(),
                kSecAttrAccessControl as String: access
            ]
        ]
        #if !targetEnvironment(simulator)
        // Secure Enclave only on real devices / Apple Silicon Macs.
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        #endif

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            let msg = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "?"
            Self.logger.error("Vault key creation failed: \(msg, privacy: .public)")
            throw VaultCryptoError.keyCreationFailed(errSecCreateChainFailed)
        }
        return key
    }
}

// MARK: - Test mock (AES-GCM with a fixed in-memory key)

public final class InMemoryVaultCrypto: VaultCrypto, @unchecked Sendable {
    private let key: SymmetricKey

    public init(key: SymmetricKey = SymmetricKey(size: .bits256)) {
        self.key = key
    }

    public func ensureReady() throws { /* always ready */ }

    public func encrypt(_ plaintext: String) throws -> Data {
        let data = plaintext.data(using: .utf8) ?? Data()
        let sealed = try AES.GCM.seal(data, using: key)
        guard let combined = sealed.combined else {
            throw VaultCryptoError.encryptFailed("no combined")
        }
        return combined
    }

    public func decrypt(_ ciphertext: Data, reason: String) throws -> String {
        let box = try AES.GCM.SealedBox(combined: ciphertext)
        let plain = try AES.GCM.open(box, using: key)
        guard let s = String(data: plain, encoding: .utf8) else {
            throw VaultCryptoError.decryptFailed("not UTF-8")
        }
        return s
    }
}
