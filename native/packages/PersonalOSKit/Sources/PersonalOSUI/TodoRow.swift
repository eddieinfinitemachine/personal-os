import SwiftUI
import PersonalOSModels

public struct TodoRow: View {
    public let todo: Todo
    public let onToggle: () -> Void

    public init(todo: Todo, onToggle: @escaping () -> Void) {
        self.todo = todo
        self.onToggle = onToggle
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: todo.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(todo.isCompleted ? Color.accentColor : Color.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(todo.isCompleted ? "Mark incomplete" : "Mark complete")

            VStack(alignment: .leading, spacing: 4) {
                Text(todo.title)
                    .font(.body)
                    .strikethrough(todo.isCompleted)
                    .foregroundStyle(todo.isCompleted ? .secondary : .primary)

                if let due = todo.dueDate {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.caption2)
                        Text(due, format: .relative(presentation: .named))
                            .font(.caption)
                    }
                    .foregroundStyle(todo.isOverdue ? .red : .secondary)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

#Preview("Todo Row") {
    VStack(alignment: .leading) {
        TodoRow(todo: .init(title: "Buy oat milk"), onToggle: {})
        TodoRow(todo: .init(title: "Overdue task", dueDate: .now.addingTimeInterval(-86_400)), onToggle: {})
        TodoRow(todo: .init(title: "Done task", completedAt: .now), onToggle: {})
    }
    .padding()
}
