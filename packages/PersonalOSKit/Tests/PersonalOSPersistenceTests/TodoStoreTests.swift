import Testing
import Foundation
@testable import PersonalOSPersistence
import PersonalOSModels

@Suite("TodoStore")
struct TodoStoreTests {
    private func makeStore() -> TodoStore {
        TodoStore(controller: PersistenceController.inMemory())
    }

    @Test("create + fetch by list returns the todo")
    func createAndFetch() throws {
        let store = makeStore()
        let todo = Todo(title: "Buy oat milk", list: .todo)
        try store.create(todo)

        let fetched = try store.fetch(list: .todo)
        #expect(fetched.count == 1)
        #expect(fetched.first?.title == "Buy oat milk")
        #expect(fetched.first?.id == todo.id)
    }

    @Test("fetch by list filters by list")
    func filterByList() throws {
        let store = makeStore()
        try store.create(Todo(title: "active", list: .todo))
        try store.create(Todo(title: "watching", list: .monitor))
        try store.create(Todo(title: "someday", list: .later))

        #expect(try store.fetch(list: .todo).count == 1)
        #expect(try store.fetch(list: .monitor).count == 1)
        #expect(try store.fetch(list: .later).count == 1)
    }

    @Test("fetch excludes completed by default")
    func excludesCompleted() throws {
        let store = makeStore()
        let todo = Todo(title: "to complete", list: .todo)
        try store.create(todo)
        try store.complete(id: todo.id)

        #expect(try store.fetch(list: .todo).isEmpty)
        #expect(try store.fetch(list: .todo, includeCompleted: true).count == 1)
    }

    @Test("fetch excludes soft-deleted")
    func excludesDeleted() throws {
        let store = makeStore()
        let todo = Todo(title: "to delete", list: .todo)
        try store.create(todo)
        try store.softDelete(id: todo.id)

        #expect(try store.fetch(list: .todo).isEmpty)
        #expect(try store.fetch(list: .todo, includeCompleted: true).isEmpty)
    }

    @Test("update mutates fields and bumps updatedAt")
    func update() throws {
        let store = makeStore()
        let original = Todo(title: "v1", list: .todo)
        try store.create(original)

        var edited = original
        edited.title = "v2"
        edited.list = .monitor
        try store.update(edited)

        let monitor = try store.fetch(list: .monitor)
        #expect(monitor.first?.title == "v2")
        #expect(try store.fetch(list: .todo).isEmpty)
        let fetched = try #require(try store.fetch(id: original.id))
        #expect(fetched.updatedAt > original.updatedAt)
    }

    @Test("complete then uncomplete restores to active list")
    func completeUncomplete() throws {
        let store = makeStore()
        let todo = Todo(title: "round trip", list: .todo)
        try store.create(todo)
        try store.complete(id: todo.id)
        #expect(try store.fetch(list: .todo).isEmpty)
        try store.uncomplete(id: todo.id)
        #expect(try store.fetch(list: .todo).count == 1)
    }

    @Test("update of unknown id throws notFound")
    func notFound() throws {
        let store = makeStore()
        let ghost = Todo(title: "ghost")
        #expect(throws: TodoStoreError.self) {
            try store.update(ghost)
        }
    }

    @Test("fetchToday returns overdue + due-today, excludes future")
    func today() throws {
        let store = makeStore()
        let yesterday = Date.now.addingTimeInterval(-86_400)
        let now = Date.now
        let nextWeek = Date.now.addingTimeInterval(7 * 86_400)

        try store.create(Todo(title: "overdue", list: .todo, dueDate: yesterday))
        try store.create(Todo(title: "today", list: .todo, dueDate: now))
        try store.create(Todo(title: "future", list: .todo, dueDate: nextWeek))
        try store.create(Todo(title: "no due", list: .todo))

        let today = try store.fetchToday()
        let titles = Set(today.map(\.title))
        #expect(titles.contains("overdue"))
        #expect(titles.contains("today"))
        #expect(!titles.contains("future"))
        #expect(!titles.contains("no due"))
    }
}

@Suite("TagStore")
struct TagStoreTests {
    private func makeStore() -> (TagStore, TodoStore, PersistenceController) {
        let controller = PersistenceController.inMemory()
        return (TagStore(controller: controller), TodoStore(controller: controller), controller)
    }

    @Test("CRUD round trip")
    func crud() throws {
        let (tags, _, _) = makeStore()
        let tag = Tag(name: "work")
        try tags.create(tag)
        #expect(try tags.fetchAll().count == 1)

        var edited = tag
        edited.name = "errands"
        try tags.update(edited)
        #expect(try tags.fetchAll().first?.name == "errands")

        try tags.delete(id: tag.id)
        #expect(try tags.fetchAll().isEmpty)
    }

    @Test("todo can be linked to tags via tagIDs")
    func linkTagsToTodo() throws {
        let (tags, todos, _) = makeStore()
        let workTag = Tag(name: "work")
        let urgentTag = Tag(name: "urgent")
        try tags.create(workTag)
        try tags.create(urgentTag)

        let todo = Todo(
            title: "ship it",
            list: .todo,
            tagIDs: [workTag.id, urgentTag.id]
        )
        try todos.create(todo)

        var edited = todo
        edited.tagIDs = [workTag.id, urgentTag.id]
        try todos.update(edited)

        let fetched = try #require(try todos.fetch(id: todo.id))
        #expect(fetched.tagIDs == [workTag.id, urgentTag.id])
    }
}
