import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class TodosViewModel {
    public var list: TodoList {
        didSet { refresh() }
    }
    public var includeCompleted: Bool = false {
        didSet { refresh() }
    }
    public private(set) var todos: [Todo] = []
    public private(set) var lastError: String?

    private let store: TodoStore

    public init(store: TodoStore, list: TodoList = .todo) {
        self.store = store
        self.list = list
        refresh()
    }

    public func refresh() {
        do {
            self.todos = try store.fetch(list: list, includeCompleted: includeCompleted)
            self.lastError = nil
        } catch {
            self.todos = []
            self.lastError = error.localizedDescription
        }
    }

    @discardableResult
    public func createBlank() -> Todo? {
        let new = Todo(title: "New todo", list: list)
        do {
            try store.create(new)
            refresh()
            return new
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    public func update(_ todo: Todo) {
        do {
            try store.update(todo)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func toggleComplete(_ todo: Todo) {
        do {
            if todo.isCompleted {
                try store.uncomplete(id: todo.id)
            } else {
                try store.complete(id: todo.id)
            }
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func softDelete(_ todo: Todo) {
        do {
            try store.softDelete(id: todo.id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
