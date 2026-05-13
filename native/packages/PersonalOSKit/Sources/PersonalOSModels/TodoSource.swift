import Foundation

public enum TodoSource: Int16, CaseIterable, Codable, Sendable {
    case manual = 0
    case nl = 1
    case siri = 2
    case share = 3
    case ai = 4
    case reminder = 5
    case importer = 6
}
