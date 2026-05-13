import Testing
import Foundation
@testable import PersonalOSPersistence
import PersonalOSModels

@Suite("PersonStore", .serialized)
@MainActor
struct PersonStoreTests {
    private func makeStores() -> (PersonStore, TodoStore, PersistenceController) {
        let controller = PersistenceController.inMemory()
        return (PersonStore(controller: controller), TodoStore(controller: controller), controller)
    }

    @Test("CRUD round trip")
    func crud() throws {
        let (people, _, _) = makeStores()
        let person = Person(name: "Joe Milstein", role: .peer, team: "IM")
        try people.create(person)
        #expect(try people.fetchAll().count == 1)

        var edited = person
        edited.notes = "Co-founder"
        try people.update(edited)
        #expect(try people.fetchAll().first?.notes == "Co-founder")

        try people.delete(id: person.id)
        #expect(try people.fetchAll().isEmpty)
    }

    @Test("fetch by role groups correctly")
    func fetchByRole() throws {
        let (people, _, _) = makeStores()
        try people.create(Person(name: "Direct A", role: .report))
        try people.create(Person(name: "Direct B", role: .report))
        try people.create(Person(name: "Cofounder", role: .peer))
        try people.create(Person(name: "Sister", role: .family))

        #expect(try people.fetch(role: .report).count == 2)
        #expect(try people.fetch(role: .peer).count == 1)
        #expect(try people.fetch(role: .family).count == 1)
        #expect(try people.fetch(role: .other).isEmpty)
    }

    @Test("link todo to person via personIDs")
    func linkTodoToPerson() throws {
        let (people, todos, _) = makeStores()
        let joe = Person(name: "Joe", role: .peer)
        let ben = Person(name: "Ben", role: .peer)
        try people.create(joe)
        try people.create(ben)

        let todo = Todo(
            title: "1:1 with Joe",
            list: .todo,
            personIDs: [joe.id]
        )
        try todos.create(todo)

        let joeTodos = try todos.fetch(personID: joe.id)
        #expect(joeTodos.count == 1)
        #expect(joeTodos.first?.title == "1:1 with Joe")

        let benTodos = try todos.fetch(personID: ben.id)
        #expect(benTodos.isEmpty)
    }

    @Test("fetch by person excludes completed by default")
    func excludesCompleted() throws {
        let (people, todos, _) = makeStores()
        let joe = Person(name: "Joe", role: .peer)
        try people.create(joe)

        let todo = Todo(
            title: "do the thing",
            personIDs: [joe.id]
        )
        try todos.create(todo)
        try todos.complete(id: todo.id)

        #expect(try todos.fetch(personID: joe.id).isEmpty)
        #expect(try todos.fetch(personID: joe.id, includeCompleted: true).count == 1)
    }

    @Test("update can change person links")
    func updatePersonLinks() throws {
        let (people, todos, _) = makeStores()
        let a = Person(name: "A")
        let b = Person(name: "B")
        try people.create(a)
        try people.create(b)

        var todo = Todo(title: "shared", personIDs: [a.id])
        try todos.create(todo)
        #expect(try todos.fetch(personID: a.id).count == 1)
        #expect(try todos.fetch(personID: b.id).isEmpty)

        todo.personIDs = [b.id]
        try todos.update(todo)
        #expect(try todos.fetch(personID: a.id).isEmpty)
        #expect(try todos.fetch(personID: b.id).count == 1)
    }

    @Test("Person initials derived from name")
    func initials() {
        #expect(Person(name: "Joe Milstein").initials == "JM")
        #expect(Person(name: "eddie cohen").initials == "EC")
        #expect(Person(name: "Cher").initials == "C")
        #expect(Person(name: "John Ronald Reuel Tolkien").initials == "JR")
    }
}
