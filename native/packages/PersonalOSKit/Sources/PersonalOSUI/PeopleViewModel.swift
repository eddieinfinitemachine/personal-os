import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class PeopleViewModel {
    public private(set) var people: [Person] = []
    public private(set) var lastError: String?

    private let store: PersonStore

    public init(store: PersonStore) {
        self.store = store
        refresh()
    }

    public func refresh() {
        do {
            people = try store.fetchAll()
            lastError = nil
        } catch {
            people = []
            lastError = error.localizedDescription
        }
    }

    public var groupedByRole: [(role: PersonRole, people: [Person])] {
        let grouped = Dictionary(grouping: people, by: \.role)
        return PersonRole.allCases.compactMap { role in
            guard let group = grouped[role], !group.isEmpty else { return nil }
            return (role, group)
        }
    }

    @discardableResult
    public func createBlank() -> Person? {
        let new = Person(name: "New person", role: .other)
        do {
            try store.create(new)
            refresh()
            return new
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    public func update(_ person: Person) {
        do {
            try store.update(person)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func delete(id: UUID) {
        do {
            try store.delete(id: id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
