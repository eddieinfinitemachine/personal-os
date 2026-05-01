import SwiftUI
import PersonalOSModels

public struct TodoEditorView: View {
    @Binding var todo: Todo
    let onSave: (Todo) -> Void
    /// Optional pool of people to choose from. When empty, the people section
    /// is hidden — this keeps the editor usable in contexts that don't have
    /// a person store available (e.g. tests, simple previews).
    let availablePeople: [Person]

    @State private var dueDateEnabled: Bool

    public init(
        todo: Binding<Todo>,
        availablePeople: [Person] = [],
        onSave: @escaping (Todo) -> Void
    ) {
        self._todo = todo
        self.onSave = onSave
        self.availablePeople = availablePeople
        self._dueDateEnabled = State(initialValue: todo.wrappedValue.dueDate != nil)
    }

    public var body: some View {
        Form {
            Section("Title") {
                TextField("Title", text: $todo.title, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { onSave(todo) }
            }

            Section("List") {
                Picker("List", selection: $todo.list) {
                    ForEach(TodoList.allCases) { list in
                        Label(list.title, systemImage: list.systemImage).tag(list)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("Notes") {
                TextEditor(text: Binding(
                    get: { todo.notes ?? "" },
                    set: { todo.notes = $0.isEmpty ? nil : $0 }
                ))
                .frame(minHeight: 80)
            }

            Section("Due date") {
                Toggle("Set due date", isOn: $dueDateEnabled)
                    .onChange(of: dueDateEnabled) { _, enabled in
                        if enabled, todo.dueDate == nil {
                            todo.dueDate = Calendar.current.startOfDay(for: .now)
                        } else if !enabled {
                            todo.dueDate = nil
                        }
                    }

                if dueDateEnabled {
                    DatePicker(
                        "Due",
                        selection: Binding(
                            get: { todo.dueDate ?? .now },
                            set: { todo.dueDate = $0 }
                        ),
                        displayedComponents: [.date, .hourAndMinute]
                    )
                }
            }

            if !availablePeople.isEmpty {
                Section("People") {
                    ForEach(availablePeople) { person in
                        Toggle(isOn: Binding(
                            get: { todo.personIDs.contains(person.id) },
                            set: { isOn in
                                if isOn { todo.personIDs.insert(person.id) }
                                else { todo.personIDs.remove(person.id) }
                            }
                        )) {
                            Label(person.name, systemImage: person.role.systemImage)
                        }
                    }
                }
            }

            Section {
                LabeledContent("Created") {
                    Text(todo.createdAt, format: .dateTime.month().day().year().hour().minute())
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Source") {
                    Text(String(describing: todo.source))
                        .foregroundStyle(.secondary)
                        .monospaced()
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: todo) { _, new in
            onSave(new)
        }
    }
}
