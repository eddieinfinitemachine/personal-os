import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct ListsTab: View {
    @Environment(\.appEnvironment) private var env

    @State private var counts: [TodoList: Int] = [:]

    var body: some View {
        NavigationStack {
            List(TodoList.allCases) { list in
                NavigationLink(value: list) {
                    HStack(spacing: 14) {
                        Image(systemName: "circle.fill")
                            .font(.title3)
                            .foregroundStyle(list.tint)
                        Text(list.title)
                            .font(.body)
                        Spacer()
                        Text("\(counts[list] ?? 0)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("My Lists")
            .navigationDestination(for: TodoList.self) { list in
                ListDetailView(list: list)
            }
            .onAppear(perform: refreshCounts)
            .task { refreshCounts() }
        }
    }

    private func refreshCounts() {
        var next: [TodoList: Int] = [:]
        for list in TodoList.allCases {
            next[list] = (try? env.todos.count(list: list)) ?? 0
        }
        counts = next
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
        .navigationBarTitleDisplayMode(.inline)
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
        .safeAreaInset(edge: .bottom) {
            Button {
                if let new = viewModel?.createBlank() {
                    presentedTodoID = new.id
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                    Text("New Reminder").fontWeight(.semibold)
                }
                .foregroundStyle(list.tint)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(.bar)
            }
            .buttonStyle(.plain)
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
        List {
            // Reminders-style hero: big colored title flush with the rows below.
            Section {
                Text(list.title)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(list.tint)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 8, trailing: 16))
            }

            if viewModel.todos.isEmpty {
                Section {
                    ContentUnavailableView(
                        "\(list.title) is empty",
                        systemImage: list.systemImage,
                        description: Text("Tap + or New Reminder to add a todo.")
                    )
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            } else {
                Section {
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
            }
        }
        .listStyle(.plain)
        .refreshable {
            viewModel.refresh()
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
    @State private var people: [Person] = []

    var body: some View {
        NavigationStack {
            Group {
                if let binding = todoBinding {
                    TodoEditorView(todo: binding, availablePeople: people) { updated in
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
            people = (try? env.people.fetchAll()) ?? []
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
