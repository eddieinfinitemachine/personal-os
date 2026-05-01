import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct TodoListColumn: View {
    @Environment(\.appEnvironment) private var env

    let list: TodoList
    @Binding var selectedTodoID: UUID?

    @State private var viewModel: TodosViewModel?

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel: viewModel)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(list.title)
        .onAppear {
            if viewModel == nil {
                viewModel = TodosViewModel(store: env.todos, list: list)
            }
        }
        .onChange(of: list) { _, newList in
            viewModel?.list = newList
            selectedTodoID = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: .newTodoRequested)) { _ in
            createNewTodo()
        }
    }

    @ViewBuilder
    private func content(viewModel: TodosViewModel) -> some View {
        VStack(spacing: 0) {
            if viewModel.todos.isEmpty {
                ContentUnavailableView(
                    list.title + " is empty",
                    systemImage: list.systemImage,
                    description: Text("Press ⌘N to add a todo.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $selectedTodoID) {
                    ForEach(viewModel.todos) { todo in
                        TodoRow(todo: todo) {
                            viewModel.toggleComplete(todo)
                        }
                        .tag(todo.id)
                        .contextMenu {
                            Button("Mark \(todo.isCompleted ? "Incomplete" : "Complete")") {
                                viewModel.toggleComplete(todo)
                            }
                            Divider()
                            Button("Delete", role: .destructive) {
                                viewModel.softDelete(todo)
                                if selectedTodoID == todo.id { selectedTodoID = nil }
                            }
                        }
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: false))
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: createNewTodo) {
                    Label("New Todo", systemImage: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)
                .help("New Todo (⌘N)")
            }
            if let selectedTodoID,
               let todo = viewModel.todos.first(where: { $0.id == selectedTodoID }) {
                ToolbarItem(placement: .secondaryAction) {
                    Button {
                        viewModel.toggleComplete(todo)
                    } label: {
                        Label(todo.isCompleted ? "Uncomplete" : "Complete", systemImage: "checkmark.circle")
                    }
                    .keyboardShortcut("d", modifiers: .command)
                    .help("Mark Complete (⌘D)")
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button(role: .destructive) {
                        viewModel.softDelete(todo)
                        self.selectedTodoID = nil
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .keyboardShortcut(.delete, modifiers: .command)
                    .help("Delete (⌘⌫)")
                }
            }
        }
    }

    private func createNewTodo() {
        guard let viewModel else { return }
        if let new = viewModel.createBlank() {
            selectedTodoID = new.id
        }
    }
}
