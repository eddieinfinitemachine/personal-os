import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class PersonProfileViewModel {
    public let personID: UUID
    public private(set) var person: Person?
    public private(set) var todos: [Todo] = []
    public private(set) var lastError: String?

    private let people: PersonStore
    private let todoStore: TodoStore

    public init(personID: UUID, people: PersonStore, todos: TodoStore) {
        self.personID = personID
        self.people = people
        self.todoStore = todos
        refresh()
    }

    public func refresh() {
        do {
            person = try people.fetch(id: personID)
            todos = try todoStore.fetch(personID: personID, includeCompleted: false)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func updatePerson(_ updated: Person) {
        do {
            try people.update(updated)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func toggleComplete(_ todo: Todo) {
        do {
            if todo.isCompleted {
                try todoStore.uncomplete(id: todo.id)
            } else {
                try todoStore.complete(id: todo.id)
            }
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
