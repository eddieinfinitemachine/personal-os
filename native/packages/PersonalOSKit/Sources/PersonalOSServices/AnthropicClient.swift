import Foundation
import os

public enum AnthropicModel: String, Sendable {
    case opusLatest = "claude-opus-4-7"
    case sonnetLatest = "claude-sonnet-4-6"
    case haikuLatest = "claude-haiku-4-5-20251001"
}

public enum AnthropicClientError: Error, CustomStringConvertible, Sendable {
    case missingAPIKey
    case http(status: Int, body: String)
    case decoding(String)
    case noToolUse

    public var description: String {
        switch self {
        case .missingAPIKey: "No Anthropic API key in Keychain. Open Settings to add one."
        case .http(let s, let b): "Anthropic API error \(s): \(b)"
        case .decoding(let m): "Decode error: \(m)"
        case .noToolUse: "Claude returned no tool_use block — refusing to guess."
        }
    }
}

// MARK: - Wire-format types

public struct AnthropicMessage: Sendable {
    public let role: String
    public let content: String

    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

public struct AnthropicTool: Encodable, Sendable {
    public let name: String
    public let description: String
    public let inputSchema: AnthropicJSONValue

    private enum CodingKeys: String, CodingKey {
        case name, description
        case inputSchema = "input_schema"
    }

    public init(name: String, description: String, inputSchema: AnthropicJSONValue) {
        self.name = name
        self.description = description
        self.inputSchema = inputSchema
    }
}

/// Minimal AnyCodable for ad-hoc JSON payloads.
public struct AnthropicJSONValue: Codable, Sendable {
    public let raw: Data

    public init<T: Encodable>(_ value: T) throws {
        self.raw = try JSONEncoder().encode(value)
    }

    public init(rawData: Data) {
        self.raw = rawData
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        let any = try JSONSerialization.jsonObject(with: raw)
        let data = try JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed])
        let decoded = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        if let dict = decoded as? [String: Any] {
            try container.encode(AnyEncodable(dict))
        } else if let arr = decoded as? [Any] {
            try container.encode(AnyEncodable(arr))
        } else if let s = decoded as? String {
            try container.encode(s)
        } else if let n = decoded as? NSNumber {
            try container.encode(n.doubleValue)
        } else if decoded is NSNull {
            try container.encodeNil()
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self.raw = Data("null".utf8)
            return
        }
        if let s = try? container.decode(String.self) {
            self.raw = try JSONEncoder().encode(s)
            return
        }
        if let d = try? container.decode([String: AnthropicJSONValue].self) {
            self.raw = try JSONEncoder().encode(d)
            return
        }
        if let a = try? container.decode([AnthropicJSONValue].self) {
            self.raw = try JSONEncoder().encode(a)
            return
        }
        if let n = try? container.decode(Double.self) {
            self.raw = try JSONEncoder().encode(n)
            return
        }
        if let b = try? container.decode(Bool.self) {
            self.raw = try JSONEncoder().encode(b)
            return
        }
        self.raw = Data("null".utf8)
    }
}

private struct AnyEncodable: Encodable {
    let value: Any
    init(_ value: Any) { self.value = value }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as String: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as Bool: try container.encode(v)
        case let v as [Any]: try container.encode(v.map(AnyEncodable.init))
        case let v as [String: Any]:
            try container.encode(v.mapValues(AnyEncodable.init))
        case is NSNull: try container.encodeNil()
        default: try container.encodeNil()
        }
    }
}

/// One block of a Claude response. Sprint 3 only handles `text` and `tool_use`.
public enum AnthropicResponseBlock: Sendable {
    case text(String)
    case toolUse(name: String, input: Data)
}

public struct AnthropicResponse: Sendable {
    public let blocks: [AnthropicResponseBlock]
    public let stopReason: String?

    /// Convenience: first tool_use input matching `name`, decoded as `T`.
    public func firstToolInput<T: Decodable>(named name: String, as type: T.Type) throws -> T? {
        for block in blocks {
            if case let .toolUse(blockName, input) = block, blockName == name {
                return try JSONDecoder().decode(T.self, from: input)
            }
        }
        return nil
    }

    public var firstText: String? {
        for block in blocks {
            if case let .text(t) = block { return t }
        }
        return nil
    }
}

public struct AnthropicRequest: Sendable {
    public let model: AnthropicModel
    public let system: String?
    public let messages: [AnthropicMessage]
    public let maxTokens: Int
    public let tools: [AnthropicTool]
    public let toolChoice: ToolChoice?

    public enum ToolChoice: Sendable {
        case auto
        case any
        case tool(name: String)
    }

    public init(
        model: AnthropicModel,
        system: String? = nil,
        messages: [AnthropicMessage],
        maxTokens: Int = 1024,
        tools: [AnthropicTool] = [],
        toolChoice: ToolChoice? = nil
    ) {
        self.model = model
        self.system = system
        self.messages = messages
        self.maxTokens = maxTokens
        self.tools = tools
        self.toolChoice = toolChoice
    }
}

// MARK: - Client protocol

public protocol AnthropicClient: Sendable {
    func send(_ request: AnthropicRequest) async throws -> AnthropicResponse
}

// MARK: - Live HTTP implementation

public struct LiveAnthropicClient: AnthropicClient {
    public let apiKey: String
    public let urlSession: URLSession
    public let endpoint: URL
    public let apiVersion: String

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "Anthropic")

    public init(
        apiKey: String,
        urlSession: URLSession = .shared,
        endpoint: URL = URL(string: "https://api.anthropic.com/v1/messages")!,
        apiVersion: String = "2023-06-01"
    ) {
        self.apiKey = apiKey
        self.urlSession = urlSession
        self.endpoint = endpoint
        self.apiVersion = apiVersion
    }

    public func send(_ request: AnthropicRequest) async throws -> AnthropicResponse {
        guard !apiKey.isEmpty else { throw AnthropicClientError.missingAPIKey }

        var urlRequest = URLRequest(url: endpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        urlRequest.setValue(apiVersion, forHTTPHeaderField: "anthropic-version")
        urlRequest.httpBody = try Self.encodeBody(request)

        let (data, response) = try await urlSession.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw AnthropicClientError.http(status: -1, body: "no HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "<binary>"
            Self.logger.error("Anthropic HTTP \(http.statusCode): \(body, privacy: .public)")
            throw AnthropicClientError.http(status: http.statusCode, body: body)
        }
        return try Self.decodeBody(data)
    }

    static func encodeBody(_ request: AnthropicRequest) throws -> Data {
        struct WireMessage: Encodable {
            let role: String
            let content: String
        }
        struct Body: Encodable {
            let model: String
            let max_tokens: Int
            let system: String?
            let messages: [WireMessage]
            let tools: [AnthropicTool]?
            let tool_choice: AnyEncodable?
        }

        let toolChoiceJSON: AnyEncodable? = request.toolChoice.flatMap { choice in
            switch choice {
            case .auto: return AnyEncodable(["type": "auto"])
            case .any: return AnyEncodable(["type": "any"])
            case .tool(let name): return AnyEncodable(["type": "tool", "name": name])
            }
        }

        let body = Body(
            model: request.model.rawValue,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: request.messages.map { WireMessage(role: $0.role, content: $0.content) },
            tools: request.tools.isEmpty ? nil : request.tools,
            tool_choice: toolChoiceJSON
        )
        return try JSONEncoder().encode(body)
    }

    static func decodeBody(_ data: Data) throws -> AnthropicResponse {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AnthropicClientError.decoding("response is not a JSON object")
        }
        let stopReason = json["stop_reason"] as? String

        guard let contentArray = json["content"] as? [[String: Any]] else {
            throw AnthropicClientError.decoding("missing 'content' array")
        }

        var blocks: [AnthropicResponseBlock] = []
        for block in contentArray {
            let type = block["type"] as? String
            switch type {
            case "text":
                if let t = block["text"] as? String {
                    blocks.append(.text(t))
                }
            case "tool_use":
                guard let name = block["name"] as? String,
                      let input = block["input"] else {
                    continue
                }
                let inputData = try JSONSerialization.data(withJSONObject: input)
                blocks.append(.toolUse(name: name, input: inputData))
            default:
                continue
            }
        }
        return AnthropicResponse(blocks: blocks, stopReason: stopReason)
    }
}

// MARK: - Mock for tests + previews

public struct MockAnthropicClient: AnthropicClient {
    public typealias Handler = @Sendable (AnthropicRequest) async throws -> AnthropicResponse
    public let handler: Handler

    public init(handler: @escaping Handler) {
        self.handler = handler
    }

    public func send(_ request: AnthropicRequest) async throws -> AnthropicResponse {
        try await handler(request)
    }

    /// Returns a tool_use response with the given JSON body as the input.
    public static func returningToolInput(name: String, input: [String: Any]) -> MockAnthropicClient {
        // Pre-serialize so the closure doesn't capture the non-Sendable dict.
        let data = (try? JSONSerialization.data(withJSONObject: input)) ?? Data("{}".utf8)
        return MockAnthropicClient { _ in
            AnthropicResponse(
                blocks: [.toolUse(name: name, input: data)],
                stopReason: "tool_use"
            )
        }
    }
}
