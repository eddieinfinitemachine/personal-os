import Foundation

/// One field on a Dashboard. Kind-discriminated: only the column matching
/// `kind` should be set; the others are nil. The model bridge enforces this
/// when reading from Core Data.
public struct FieldValue: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var label: String
    public var kind: FieldKind
    public var position: Int16

    public var textValue: String?
    public var numberValue: Double?
    public var dateValue: Date?
    /// Stored as Decimal in Core Data; serialized as String here for
    /// Codable + CloudKit safety.
    public var decimalValue: Decimal?

    public init(
        id: UUID = UUID(),
        label: String,
        kind: FieldKind,
        position: Int16 = 0,
        textValue: String? = nil,
        numberValue: Double? = nil,
        dateValue: Date? = nil,
        decimalValue: Decimal? = nil
    ) {
        self.id = id
        self.label = label
        self.kind = kind
        self.position = position
        self.textValue = textValue
        self.numberValue = numberValue
        self.dateValue = dateValue
        self.decimalValue = decimalValue
    }

    /// Empty field of a given kind, ready to be edited.
    public static func empty(kind: FieldKind, label: String, position: Int16 = 0) -> FieldValue {
        FieldValue(label: label, kind: kind, position: position)
    }

    /// True iff the field has a value matching its kind.
    public var hasValue: Bool {
        switch kind {
        case .text, .url: return !(textValue ?? "").isEmpty
        case .number: return numberValue != nil
        case .date: return dateValue != nil
        case .currency: return decimalValue != nil
        case .select, .multiselect, .attachment, .person: return false
        }
    }

    /// Display string for read-only views. Returns an em dash if no value.
    public func displayString(currencyCode: String = "USD") -> String {
        switch kind {
        case .text:
            return textValue ?? "—"
        case .url:
            return textValue ?? "—"
        case .number:
            guard let n = numberValue else { return "—" }
            return n.formatted()
        case .date:
            guard let d = dateValue else { return "—" }
            return d.formatted(date: .abbreviated, time: .omitted)
        case .currency:
            guard let d = decimalValue else { return "—" }
            return d.formatted(.currency(code: currencyCode))
        case .select, .multiselect, .attachment, .person:
            return "—"
        }
    }
}
