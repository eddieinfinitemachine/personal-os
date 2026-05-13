import SwiftUI
import PersonalOSModels
import PersonalOSPersistence
import PersonalOSServices

@MainActor
@Observable
public final class QuickAddViewModel {
    public enum Phase: Sendable {
        case idle
        case parsing
        case preview(Todo)
        case saved(Todo)
        case error(String)
    }

    public var input: String = ""
    public private(set) var phase: Phase = .idle

    private let todos: TodoStore
    private let nl: NLCaptureService?

    public init(todos: TodoStore, nl: NLCaptureService?) {
        self.todos = todos
        self.nl = nl
    }

    public var canSubmit: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var hasNLAvailable: Bool { nl != nil }

    public func submit() async {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // No NL available → just create a literal todo with the title.
        guard let nl else {
            let todo = Todo(title: trimmed, source: .manual)
            do {
                try todos.create(todo)
                phase = .saved(todo)
                input = ""
            } catch {
                phase = .error(error.localizedDescription)
            }
            return
        }

        phase = .parsing
        do {
            let result = try await nl.capture(trimmed)
            phase = .preview(result.todo)
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    public func confirm() {
        guard case let .preview(todo) = phase else { return }
        do {
            try todos.create(todo)
            phase = .saved(todo)
            input = ""
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    public func reset() {
        phase = .idle
        input = ""
    }
}

public struct QuickAddView: View {
    @Bindable public var viewModel: QuickAddViewModel
    let onClose: () -> Void

    public init(viewModel: QuickAddViewModel, onClose: @escaping () -> Void = {}) {
        self.viewModel = viewModel
        self.onClose = onClose
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "sparkles")
                    .foregroundStyle(.tint)
                Text(viewModel.hasNLAvailable ? "Quick add" : "Quick add (manual)")
                    .font(.headline)
                Spacer()
            }

            TextField(
                viewModel.hasNLAvailable
                    ? "Tell me what to add (e.g. \"book Ferrari service Friday\")"
                    : "Add a todo (Claude key not configured — will save as-is)",
                text: $viewModel.input,
                axis: .vertical
            )
            .lineLimit(2...5)
            .textFieldStyle(.roundedBorder)
            .disabled(isParsing)
            .onSubmit { Task { await viewModel.submit() } }

            statusOrPreview

            HStack {
                if case .preview = viewModel.phase {
                    Button("Edit again") { viewModel.reset() }
                    Spacer()
                    Button("Save") { viewModel.confirm() }
                        .keyboardShortcut(.return, modifiers: .command)
                        .buttonStyle(.borderedProminent)
                } else {
                    Spacer()
                    Button("Cancel", role: .cancel) {
                        viewModel.reset()
                        onClose()
                    }
                    .keyboardShortcut(.cancelAction)
                    Button(viewModel.hasNLAvailable ? "Parse" : "Add") {
                        Task { await viewModel.submit() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(!viewModel.canSubmit || isParsing)
                }
            }
        }
        .padding(20)
        .frame(minWidth: 380)
        .onChange(of: phaseToken) { _, _ in
            if case .saved = viewModel.phase {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    onClose()
                }
            }
        }
    }

    private var isParsing: Bool {
        if case .parsing = viewModel.phase { return true }
        return false
    }

    /// Stable token used by `.onChange` to detect phase transitions
    /// (since `Phase` isn't Equatable for free).
    private var phaseToken: String {
        switch viewModel.phase {
        case .idle: "idle"
        case .parsing: "parsing"
        case .preview(let t): "preview-\(t.id)"
        case .saved(let t): "saved-\(t.id)"
        case .error(let m): "error-\(m)"
        }
    }

    @ViewBuilder
    private var statusOrPreview: some View {
        switch viewModel.phase {
        case .idle:
            EmptyView()
        case .parsing:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Asking Claude…")
                    .foregroundStyle(.secondary)
            }
        case .preview(let todo):
            previewCard(todo)
        case .saved(let todo):
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Saved: \(todo.title)")
                    .foregroundStyle(.secondary)
            }
        case .error(let message):
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func previewCard(_ todo: Todo) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(todo.list.title, systemImage: todo.list.systemImage)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.15), in: .capsule)
                if let due = todo.dueDate {
                    Label(due.formatted(.dateTime.month().day()), systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text(todo.title)
                .font(.body.weight(.medium))
            if let notes = todo.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: 10))
    }
}
