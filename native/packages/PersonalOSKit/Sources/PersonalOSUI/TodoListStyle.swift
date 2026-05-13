import SwiftUI
import PersonalOSModels

/// Per-list accent color used for the directory dot, the hero title on the
/// list detail screen, and the bottom "New Reminder" anchor. Single source of
/// truth — edit here to retune the whole Lists tab palette.
public extension TodoList {
    var tint: Color {
        switch self {
        case .todo:    .blue
        case .monitor: .orange
        case .later:   .purple
        }
    }
}
