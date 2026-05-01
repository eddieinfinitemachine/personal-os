import Foundation

public enum PersonRole: Int16, CaseIterable, Codable, Sendable, Identifiable {
    case report = 0
    case peer = 1
    case family = 2
    case other = 3

    public var id: Int16 { rawValue }

    public var title: String {
        switch self {
        case .report: "Direct Report"
        case .peer: "Peer"
        case .family: "Family"
        case .other: "Other"
        }
    }

    public var groupTitle: String {
        switch self {
        case .report: "Direct Reports"
        case .peer: "Peers"
        case .family: "Family"
        case .other: "Other"
        }
    }

    public var systemImage: String {
        switch self {
        case .report: "person.badge.shield.checkmark"
        case .peer: "person.2"
        case .family: "house"
        case .other: "person"
        }
    }
}
