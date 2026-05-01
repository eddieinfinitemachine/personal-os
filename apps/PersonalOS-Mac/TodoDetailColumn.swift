import SwiftUI
import PersonalOSModels
import PersonalOSPersistence
import PersonalOSUI

struct TodoDetailColumn: View {
    @Environment(\.appEnvironment) private var env

    @Binding var selectedTodoID: UUID?
    let list: TodoList

    @State private var draft: Todo?

    var body: some View {
        Group {
            if let binding = todoBinding {
                TodoEditorView(todo: binding) { updated in
                    env.todos.updateAndIgnoreErrors(updated)
                }
                .navigationTitle(binding.wrappedValue.title.isEmpty ? "Untitled" : binding.wrappedValue.title)
            } else {
                ContentUnavailableView(
                    "No todo selected",
                    systemImage: "sidebar.right",
                    description: Text("Select a todo from the middle column or press ⌘N.")
                )
            }
        }
        .onChange(of: selectedTodoID) { _, newID in
            loadDraft(for: newID)
        }
        .onAppear {
            loadDraft(for: selectedTodoID)
        }
    }

    private var todoBinding: Binding<Todo>? {
        guard draft != nil else { return nil }
        return Binding(
            get: { draft! },
            set: { draft = $0 }
        )
    }

    private func loadDraft(for id: UUID?) {
        guard let id else {
            draft = nil
            return
        }
        draft = (try? env.todos.fetch(id: id)) ?? nil
    }
}

private extension TodoStore {
    func updateAndIgnoreErrors(_ todo: Todo) {
        do { try update(todo) } catch { /* surfaced via lastError elsewhere */ }
    }
}
