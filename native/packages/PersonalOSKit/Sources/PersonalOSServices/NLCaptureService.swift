import Foundation
import os
import PersonalOSModels

public struct NLCaptureResult: Sendable {
    public let todo: Todo
    public let rawInput: String
}

public enum NLCaptureError: Error, CustomStringConvertible, Sendable {
    case emptyInput
    case missingTool
    case malformed(String)

    public var description: String {
        switch self {
        case .emptyInput: "Nothing to capture."
        case .missingTool: "Claude didn't call the record_todo tool."
        case .malformed(let m): "Malformed tool input: \(m)"
        }
    }
}

/// Parses a free-form text fragment into a structured Todo via Claude tool use.
public struct NLCaptureService: Sendable {
    public let client: any AnthropicClient
    public let model: AnthropicModel

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "NLCapture")

    public init(client: any AnthropicClient, model: AnthropicModel = .haikuLatest) {
        self.client = client
        self.model = model
    }

    public func capture(_ input: String, now: Date = .now) async throws -> NLCaptureResult {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw NLCaptureError.emptyInput }

        let request = AnthropicRequest(
            model: model,
            system: Self.systemPrompt,
            messages: [
                AnthropicMessage(role: "user", content: Self.userMessage(input: trimmed, now: now))
            ],
            maxTokens: 256,
            tools: [Self.recordTodoTool],
            toolChoice: .tool(name: "record_todo")
        )

        let response = try await client.send(request)
        guard let raw: RecordTodoInput = try response.firstToolInput(named: "record_todo", as: RecordTodoInput.self) else {
            throw NLCaptureError.missingTool
        }

        let todo = try Self.todo(from: raw, source: .nl)
        return NLCaptureResult(todo: todo, rawInput: trimmed)
    }

    // MARK: - Tool schema (matches Prompts/nl-capture-v1.md)

    static var recordTodoTool: AnthropicTool {
        let schema: [String: Any] = [
            "type": "object",
            "required": ["title", "list"],
            "properties": [
                "title": ["type": "string", "description": "Imperative core of the todo, ~ < 70 chars."],
                "list": [
                    "type": "string",
                    "enum": ["todo", "monitor", "later"],
                    "description": "Which list this belongs in."
                ],
                "dueDate": [
                    "type": ["string", "null"],
                    "description": "ISO 8601 date or datetime. Null if not mentioned."
                ],
                "notes": [
                    "type": ["string", "null"],
                    "description": "Extra context from the user. Null if none."
                ],
                "tags": [
                    "type": "array",
                    "items": ["type": "string"],
                    "maxItems": 3
                ]
            ]
        ]
        let schemaData = (try? JSONSerialization.data(withJSONObject: schema)) ?? Data("{}".utf8)
        return AnthropicTool(
            name: "record_todo",
            description: "Record a structured todo extracted from the user's input.",
            inputSchema: AnthropicJSONValue(rawData: schemaData)
        )
    }

    static let systemPrompt = """
    You are a fast, careful capture assistant for a personal-OS app. The user \
    gives you a fragment of text. Call record_todo exactly once with the \
    structured todo.

    Rules:
    - Title is the imperative core. Strip filler ("I need to", "remember to"). \
    Keep under 70 chars when possible.
    - List = "todo" by default. Use "monitor" for watching ("waiting on", \
    "following"). Use "later" for someday/maybe.
    - dueDate is ISO 8601. Only set it if the user mentioned a date or \
    relative time. Otherwise null.
    - notes is for context the title can't carry. Null unless the user \
    volunteered extra detail.
    - tags: array of short lowercase tags inferred from the input. ≤ 3.

    Call record_todo exactly once. No free-form text.
    """

    static func userMessage(input: String, now: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let today = formatter.string(from: now)
        return "Today is \(today).\n\nInput:\n\(input)"
    }

    // MARK: - Parsing the tool input

    struct RecordTodoInput: Decodable, Sendable {
        let title: String
        let list: String
        let dueDate: String?
        let notes: String?
        let tags: [String]?
    }

    static func todo(from input: RecordTodoInput, source: TodoSource) throws -> Todo {
        let trimmedTitle = input.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            throw NLCaptureError.malformed("title is empty")
        }
        let list: TodoList = switch input.list {
        case "todo": .todo
        case "monitor": .monitor
        case "later": .later
        default: .todo
        }
        let due: Date? = input.dueDate.flatMap(parseDate)
        let notes = input.notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        return Todo(
            title: trimmedTitle,
            notes: (notes?.isEmpty == false) ? notes : nil,
            list: list,
            dueDate: due,
            source: source
        )
    }

    static func parseDate(_ raw: String) -> Date? {
        // Try ISO8601 with time first, then date-only.
        let isoFull = ISO8601DateFormatter()
        isoFull.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = isoFull.date(from: raw) { return d }

        let isoDateTime = ISO8601DateFormatter()
        isoDateTime.formatOptions = [.withInternetDateTime]
        if let d = isoDateTime.date(from: raw) { return d }

        let dateOnly = DateFormatter()
        dateOnly.calendar = Calendar(identifier: .gregorian)
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: raw)
    }
}
