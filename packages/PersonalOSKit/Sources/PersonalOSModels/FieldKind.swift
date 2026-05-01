import Foundation

/// Sprint 2 MVP supports text/number/date/currency/url. Select / multiselect /
/// attachment / person are reserved for Sprint 2.5+ — the raw values are stable
/// so existing data won't shift when those land.
public enum FieldKind: Int16, CaseIterable, Codable, Sendable, Identifiable {
    case text = 0
    case number = 1
    case date = 2
    case currency = 3
    case url = 4
    // Reserved:
    case select = 5
    case multiselect = 6
    case attachment = 7
    case person = 8

    public var id: Int16 { rawValue }

    public var title: String {
        switch self {
        case .text: "Text"
        case .number: "Number"
        case .date: "Date"
        case .currency: "Currency"
        case .url: "URL"
        case .select: "Select"
        case .multiselect: "Multi-select"
        case .attachment: "Attachment"
        case .person: "Person"
        }
    }

    public var systemImage: String {
        switch self {
        case .text: "textformat"
        case .number: "number"
        case .date: "calendar"
        case .currency: "dollarsign.circle"
        case .url: "link"
        case .select: "list.bullet.circle"
        case .multiselect: "list.bullet.indent"
        case .attachment: "paperclip"
        case .person: "person"
        }
    }

    /// Kinds the UI exposes today. Hidden kinds (select+) are still readable
    /// from existing data but the editor doesn't offer them yet.
    public static var userPickable: [FieldKind] {
        [.text, .number, .date, .currency, .url]
    }
}
