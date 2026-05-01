import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct ListsTab: View {
    var body: some View {
        NavigationStack {
            List(TodoList.allCases) { list in
                NavigationLink(value: list) {
                    Label(list.title, systemImage: list.systemImage)
                }
            }
            .navigationTitle("Lists")
            .navigationDestination(for: TodoList.self) { list in
                ListDetailView(list: list)
            }
        }
    }
}

struct ListDetailView: View {
    @Environment(\.appEnvironment) private var env

    let list: TodoList

    @State private var viewModel: TodosViewModel?
    @State private var presentedTodoID: UUID?

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(list.title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    if let new = viewModel?.createBlank() {
                        presentedTodoID = new.id
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(item: Binding(
            get: { presentedTodoID.map(IdentifiableUUID.init) },
            set: { presentedTodoID = $0?.id }
        )) { wrapper in
            EditorSheet(todoID: wrapper.id) {
                viewModel?.refresh()
                presentedTodoID = nil
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = TodosViewModel(store: env.todos, list: list)
            } else {
                viewModel?.refresh()
            }
        }
    }

    @ViewBuilder
    private func content(viewModel: TodosViewModel) -> some View {
        if viewModel.todos.isEmpty {
            ContentUnavailableView(
                "\(list.title) is empty",
                systemImage: list.systemImage,
                description: Text("Tap + to add a todo.")
            )
        } else {
            List {
                ForEach(viewModel.todos) { todo in
                    Button {
                        presentedTodoID = todo.id
                    } label: {
                        TodoRow(todo: todo) {
                            viewModel.toggleComplete(todo)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .leading) {
                        Button {
                            viewModel.toggleComplete(todo)
                        } label: {
                            Label("Complete", systemImage: "checkmark")
                        }
                        .tint(.green)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            viewModel.softDelete(todo)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .refreshable {
                viewModel.refresh()
            }
        }
    }
}

private struct IdentifiableUUID: Identifiable {
    let id: UUID
}

private struct EditorSheet: View {
    @Environment(\.appEnvironment) private var env
    @Environment(\.dismiss) private var dismiss

    let todoID: UUID
    let onClose: () -> Void

    @State private var draft: Todo?

    var body: some View {
        NavigationStack {
            Group {
                if let binding = todoBinding {
                    TodoEditorView(todo: binding) { updated in
                        _ = try? env.todos.update(updated)
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Edit Todo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        if let draft {
                            _ = try? env.todos.update(draft)
                        }
                        onClose()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .onAppear {
            draft = (try? env.todos.fetch(id: todoID)) ?? nil
        }
    }

    private var todoBinding: Binding<Todo>? {
        guard draft != nil else { return nil }
        return Binding(
            get: { draft! },
            set: { draft = $0 }
        )
    }
}
