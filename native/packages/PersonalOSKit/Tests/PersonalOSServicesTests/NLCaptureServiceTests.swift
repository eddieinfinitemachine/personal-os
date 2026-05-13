import Testing
import Foundation
@testable import PersonalOSServices
import PersonalOSModels

@Suite("NLCaptureService", .serialized)
struct NLCaptureServiceTests {

    @Test("parses a simple todo from mocked tool_use")
    func simpleTodo() async throws {
        let mock = MockAnthropicClient.returningToolInput(
            name: "record_todo",
            input: [
                "title": "Buy oat milk",
                "list": "todo"
            ]
        )
        let service = NLCaptureService(client: mock)
        let result = try await service.capture("I need to buy oat milk")
        #expect(result.todo.title == "Buy oat milk")
        #expect(result.todo.list == .todo)
        #expect(result.todo.source == .nl)
        #expect(result.todo.dueDate == nil)
    }

    @Test("respects monitor / later list assignments")
    func listAssignment() async throws {
        for (raw, expected) in [
            ("monitor", TodoList.monitor),
            ("later", TodoList.later),
            ("todo", TodoList.todo)
        ] {
            let mock = MockAnthropicClient.returningToolInput(
                name: "record_todo",
                input: ["title": "x", "list": raw]
            )
            let service = NLCaptureService(client: mock)
            let result = try await service.capture("x")
            #expect(result.todo.list == expected)
        }
    }

    @Test("parses ISO 8601 dueDate")
    func parsesDueDate() async throws {
        let mock = MockAnthropicClient.returningToolInput(
            name: "record_todo",
            input: [
                "title": "Submit form",
                "list": "todo",
                "dueDate": "2026-05-15"
            ]
        )
        let service = NLCaptureService(client: mock)
        let result = try await service.capture("submit the form by May 15")
        #expect(result.todo.dueDate != nil)

        let components = Calendar(identifier: .gregorian)
            .dateComponents([.year, .month, .day], from: result.todo.dueDate!)
        #expect(components.year == 2026)
        #expect(components.month == 5)
        #expect(components.day == 15)
    }

    @Test("notes pass through, empty notes become nil")
    func notes() async throws {
        let mock = MockAnthropicClient.returningToolInput(
            name: "record_todo",
            input: ["title": "x", "list": "todo", "notes": "for the dinner party"]
        )
        let result = try await NLCaptureService(client: mock).capture("x")
        #expect(result.todo.notes == "for the dinner party")
    }

    @Test("empty input throws")
    func emptyInput() async {
        let mock = MockAnthropicClient.returningToolInput(name: "record_todo", input: [:])
        do {
            _ = try await NLCaptureService(client: mock).capture("    ")
            Issue.record("expected NLCaptureError.emptyInput")
        } catch let error as NLCaptureError {
            switch error {
            case .emptyInput: break
            default: Issue.record("expected emptyInput, got \(error)")
            }
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }

    @Test("missing tool use throws")
    func missingTool() async {
        let mock = MockAnthropicClient { _ in
            AnthropicResponse(blocks: [.text("hi")], stopReason: "end_turn")
        }
        do {
            _ = try await NLCaptureService(client: mock).capture("buy milk")
            Issue.record("expected missingTool")
        } catch let error as NLCaptureError {
            switch error {
            case .missingTool: break
            default: Issue.record("expected missingTool, got \(error)")
            }
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }

    @Test("malformed input throws when title is empty")
    func malformedTitle() async {
        let mock = MockAnthropicClient.returningToolInput(
            name: "record_todo",
            input: ["title": "", "list": "todo"]
        )
        do {
            _ = try await NLCaptureService(client: mock).capture("buy milk")
            Issue.record("expected malformed")
        } catch let error as NLCaptureError {
            switch error {
            case .malformed: break
            default: Issue.record("expected malformed, got \(error)")
            }
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }
}
