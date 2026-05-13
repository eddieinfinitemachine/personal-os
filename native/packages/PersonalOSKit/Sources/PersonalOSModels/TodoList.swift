import Foundation

public enum TodoList: Int16, CaseIterable, Codable, Sendable, Identifiable {
    case todo = 0
    case monitor = 1
    case later = 2

    public var id: Int16 { rawValue }

    public var title: String {
        switch self {
        case .todo: "To Do"
        case .monitor: "Monitor"
        case .later: "Later"
        }
    }

    public var systemImage: String {
        switch self {
        case .todo: "checklist"
        case .monitor: "eye"
        case .later: "tray"
        }
    }
}
