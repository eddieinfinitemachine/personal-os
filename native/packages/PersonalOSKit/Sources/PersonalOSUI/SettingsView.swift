import SwiftUI
import PersonalOSServices

@MainActor
@Observable
public final class SettingsViewModel {
    public var apiKeyDraft: String = ""
    public private(set) var savedAPIKeyMasked: String?
    public private(set) var saveError: String?

    private let keychain: KeychainStore

    public init(keychain: KeychainStore) {
        self.keychain = keychain
        refresh()
    }

    public func refresh() {
        if let key = keychain.anthropicAPIKey(), !key.isEmpty {
            savedAPIKeyMasked = Self.mask(key)
        } else {
            savedAPIKeyMasked = nil
        }
    }

    public func save() {
        let trimmed = apiKeyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try keychain.setAnthropicAPIKey(trimmed.isEmpty ? nil : trimmed)
            apiKeyDraft = ""
            saveError = nil
            refresh()
        } catch {
            saveError = error.localizedDescription
        }
    }

    public func clear() {
        do {
            try keychain.setAnthropicAPIKey(nil)
            saveError = nil
            refresh()
        } catch {
            saveError = error.localizedDescription
        }
    }

    private static func mask(_ key: String) -> String {
        guard key.count > 8 else { return String(repeating: "•", count: max(key.count, 4)) }
        let prefix = key.prefix(4)
        let suffix = key.suffix(4)
        return "\(prefix)…\(suffix)"
    }
}

public struct SettingsView: View {
    @Bindable public var viewModel: SettingsViewModel

    public init(viewModel: SettingsViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        Form {
            Section {
                if let masked = viewModel.savedAPIKeyMasked {
                    LabeledContent("Saved key") {
                        Text(masked)
                            .monospaced()
                            .foregroundStyle(.secondary)
                    }
                    Button("Remove key", role: .destructive) {
                        viewModel.clear()
                    }
                }
                SecureField("sk-ant-…", text: $viewModel.apiKeyDraft)
                    .textFieldStyle(.roundedBorder)
                Button("Save") {
                    viewModel.save()
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.apiKeyDraft.trimmingCharacters(in: .whitespaces).isEmpty)

                if let error = viewModel.saveError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } header: {
                Text("Anthropic API Key")
            } footer: {
                Text("Stored in iCloud Keychain. Used for natural-language capture and Claude assistance. The vault is excluded from AI context — keys never leave your devices except as outbound calls to Anthropic.")
            }
        }
        .formStyle(.grouped)
    }
}
