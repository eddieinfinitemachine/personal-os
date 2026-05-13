import SwiftUI
import PersonalOSPersistence
import PersonalOSModels
import PersonalOSServices

/// Top-level dependency container injected via SwiftUI environment.
/// Holds Sendable stores; methods that touch viewContext are @MainActor.
public final class AppEnvironment: Sendable {
    public let persistence: PersistenceController
    public let todos: TodoStore
    public let tags: TagStore
    public let people: PersonStore
    public let dashboards: DashboardStore
    public let attachments: AttachmentStore
    public let reminders: ReminderStore
    public let keychain: KeychainStore
    public let vault: VaultStore

    public init(
        persistence: PersistenceController = .shared,
        keychain: KeychainStore = KeychainStore(),
        vaultCrypto: any VaultCrypto = SecureEnclaveVaultCrypto()
    ) {
        self.persistence = persistence
        self.todos = TodoStore(controller: persistence)
        self.tags = TagStore(controller: persistence)
        self.people = PersonStore(controller: persistence)
        self.dashboards = DashboardStore(controller: persistence)
        self.attachments = AttachmentStore(controller: persistence)
        self.reminders = ReminderStore(controller: persistence)
        self.keychain = keychain
        self.vault = VaultStore(
            crypto: vaultCrypto,
            encrypted: VaultEncryptedStore(controller: persistence)
        )
    }

    @MainActor
    public func makeReminderEngine() -> ReminderEngine {
        ReminderEngine(reminders: reminders, dashboards: dashboards, todos: todos)
    }

    @MainActor
    public func makeBirthdayService() -> BirthdayService {
        BirthdayService(people: people, todos: todos)
    }

    /// Live Anthropic client backed by the API key in Keychain. Returns nil
    /// when no key is configured — UI should surface a "configure in
    /// Settings" prompt rather than failing silently.
    public func makeAnthropicClient() -> (any AnthropicClient)? {
        guard let key = keychain.anthropicAPIKey(), !key.isEmpty else { return nil }
        return LiveAnthropicClient(apiKey: key)
    }

    /// Empty in-memory env. Used as the @Entry default and as the base for
    /// #Preview blocks that don't need sample data.
    public static let preview = AppEnvironment(persistence: .inMemory())

    /// In-memory env seeded with sample data for #Preview blocks.
    /// MainActor because seeding hits viewContext.
    @MainActor
    public static func seededPreview() -> AppEnvironment {
        let env = AppEnvironment(persistence: .inMemory())
        _ = try? env.todos.create(Todo(title: "Buy oat milk", list: .todo))
        _ = try? env.todos.create(Todo(
            title: "Renew Ferrari registration",
            list: .todo,
            dueDate: Date.now.addingTimeInterval(7 * 86_400)
        ))
        _ = try? env.todos.create(Todo(title: "Watch lease renewal Q3", list: .monitor))
        _ = try? env.todos.create(Todo(title: "Maybe rebuild the espresso bar", list: .later))
        _ = try? env.people.create(Person(name: "Joe Milstein", role: .peer, team: "IM"))
        _ = try? env.people.create(Person(name: "Ben Milstein", role: .peer, team: "C2"))
        _ = try? env.dashboards.create(Dashboard(
            name: "Ferrari 360",
            type: "vehicle",
            icon: "car",
            fields: [
                FieldValue(label: "Mileage", kind: .number, position: 0, numberValue: 4_800),
                FieldValue(label: "VIN", kind: .text, position: 1, textValue: "ZFFXXXX"),
                FieldValue(
                    label: "Last service",
                    kind: .date,
                    position: 2,
                    dateValue: Date.now.addingTimeInterval(-30 * 86_400)
                )
            ]
        ))
        _ = try? env.dashboards.create(Dashboard(
            name: "Apartment",
            type: "home",
            icon: "house",
            fields: [
                FieldValue(label: "Lease end", kind: .date, position: 0),
                FieldValue(label: "Landlord", kind: .text, position: 1)
            ]
        ))
        return env
    }
}

public extension EnvironmentValues {
    @Entry var appEnvironment: AppEnvironment = .preview
}
