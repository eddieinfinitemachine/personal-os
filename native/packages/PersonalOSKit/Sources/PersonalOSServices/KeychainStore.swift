import Foundation
import Security

public enum KeychainError: Error, CustomStringConvertible {
    case unexpectedStatus(OSStatus)
    case decodingFailure

    public var description: String {
        switch self {
        case .unexpectedStatus(let status): "Keychain status \(status)"
        case .decodingFailure: "Keychain value could not be decoded as UTF-8"
        }
    }
}

/// Tiny Keychain wrapper. Items are written `kSecAttrSynchronizable=true` so
/// they sync via iCloud Keychain across the user's signed-in devices.
public struct KeychainStore: Sendable {
    public let service: String

    public init(service: String = "com.zelig.PersonalOS") {
        self.service = service
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanTrue as Any
        ]
    }

    public func setString(_ value: String, account: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.decodingFailure
        }
        try set(data, account: account)
    }

    public func string(account: String) throws -> String? {
        guard let data = try data(account: account) else { return nil }
        guard let s = String(data: data, encoding: .utf8) else {
            throw KeychainError.decodingFailure
        }
        return s
    }

    public func data(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            return item as? Data
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func set(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = query
            addQuery[kSecValueData as String] = data
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unexpectedStatus(addStatus)
            }
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    public func delete(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    /// Convenience accessor for the Anthropic API key.
    public var anthropicAPIKeyAccount: String { "anthropic.api_key" }

    public func anthropicAPIKey() -> String? {
        (try? string(account: anthropicAPIKeyAccount)) ?? nil
    }

    public func setAnthropicAPIKey(_ key: String?) throws {
        if let key, !key.isEmpty {
            try setString(key, account: anthropicAPIKeyAccount)
        } else {
            try delete(account: anthropicAPIKeyAccount)
        }
    }
}
