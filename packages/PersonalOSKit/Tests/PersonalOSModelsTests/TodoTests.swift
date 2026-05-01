import Testing
import Foundation
@testable import PersonalOSModels

@Suite("Todo")
struct TodoTests {
    @Test("default initializer sets sane defaults")
    func defaults() {
        let todo = Todo(title: "Buy oat milk")
        #expect(todo.title == "Buy oat milk")
        #expect(todo.list == .todo)
        #expect(todo.source == .manual)
        #expect(todo.completedAt == nil)
        #expect(todo.deletedAt == nil)
        #expect(todo.isCompleted == false)
        #expect(todo.isDeleted == false)
        #expect(todo.tagIDs.isEmpty)
    }

    @Test("isOverdue is true for past dueDate when not completed")
    func overdueLogic() {
        let yesterday = Date.now.addingTimeInterval(-86_400)
        let tomorrow = Date.now.addingTimeInterval(86_400)

        let pastDue = Todo(title: "Late", dueDate: yesterday)
        #expect(pastDue.isOverdue == true)

        let future = Todo(title: "Soon", dueDate: tomorrow)
        #expect(future.isOverdue == false)

        let completed = Todo(
            title: "Done",
            dueDate: yesterday,
            completedAt: .now
        )
        #expect(completed.isOverdue == false)
    }

    @Test("Codable round-trip preserves all fields")
    func codableRoundTrip() throws {
        let original = Todo(
            title: "Test",
            notes: "with notes",
            list: .monitor,
            dueDate: Date(timeIntervalSince1970: 1_700_000_000),
            source: .nl,
            tagIDs: [UUID(), UUID()]
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Todo.self, from: encoded)
        #expect(decoded == original)
    }
}

@Suite("TodoList")
struct TodoListTests {
    @Test("title and systemImage are non-empty for all cases")
    func display() {
        for list in TodoList.allCases {
            #expect(!list.title.isEmpty)
            #expect(!list.systemImage.isEmpty)
        }
    }
}
