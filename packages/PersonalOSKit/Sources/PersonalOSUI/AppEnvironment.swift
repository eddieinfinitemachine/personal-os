import SwiftUI
import PersonalOSPersistence
import PersonalOSModels

/// Top-level dependency container injected via SwiftUI environment.
/// Holds Sendable stores; safe to access from any actor.
public final class AppEnvironment: Sendable {
    public let persistence: PersistenceController
    public let todos: TodoStore
    public let tags: TagStore

    public init(persistence: PersistenceController = .shared) {
        self.persistence = persistence
        self.todos = TodoStore(controller: persistence)
        self.tags = TagStore(controller: persistence)
    }

    public static let preview: AppEnvironment = {
        let env = AppEnvironment(persistence: .inMemory())
        _ = try? env.todos.create(Todo(title: "Buy oat milk", list: .todo))
        _ = try? env.todos.create(Todo(
            title: "Renew Ferrari registration",
            list: .todo,
            dueDate: Date.now.addingTimeInterval(7 * 86_400)
        ))
        _ = try? env.todos.create(Todo(title: "Watch lease renewal Q3", list: .monitor))
        _ = try? env.todos.create(Todo(title: "Maybe rebuild the espresso bar", list: .later))
        return env
    }()
}

public extension EnvironmentValues {
    @Entry var appEnvironment: AppEnvironment = .preview
}
