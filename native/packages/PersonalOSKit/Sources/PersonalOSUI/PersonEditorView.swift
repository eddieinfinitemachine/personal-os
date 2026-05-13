import SwiftUI
import PersonalOSModels

public struct PersonEditorView: View {
    @Binding var person: Person
    let onSave: (Person) -> Void

    @State private var birthdayEnabled: Bool

    public init(person: Binding<Person>, onSave: @escaping (Person) -> Void) {
        self._person = person
        self.onSave = onSave
        self._birthdayEnabled = State(initialValue: person.wrappedValue.birthday != nil)
    }

    public var body: some View {
        Form {
            Section("Name") {
                TextField("Name", text: $person.name)
                    .textFieldStyle(.roundedBorder)
            }

            Section("Role") {
                Picker("Role", selection: $person.role) {
                    ForEach(PersonRole.allCases) { role in
                        Label(role.title, systemImage: role.systemImage).tag(role)
                    }
                }
                .pickerStyle(.menu)
            }

            Section("Team") {
                TextField("Team or org", text: Binding(
                    get: { person.team ?? "" },
                    set: { person.team = $0.isEmpty ? nil : $0 }
                ))
                .textFieldStyle(.roundedBorder)
            }

            Section("Notes") {
                TextEditor(text: Binding(
                    get: { person.notes ?? "" },
                    set: { person.notes = $0.isEmpty ? nil : $0 }
                ))
                .frame(minHeight: 80)
            }

            Section("Birthday") {
                Toggle("Set birthday", isOn: $birthdayEnabled)
                    .onChange(of: birthdayEnabled) { _, enabled in
                        if enabled, person.birthday == nil {
                            person.birthday = Calendar.current.startOfDay(for: .now)
                        } else if !enabled {
                            person.birthday = nil
                        }
                    }
                if birthdayEnabled {
                    DatePicker(
                        "Birthday",
                        selection: Binding(
                            get: { person.birthday ?? .now },
                            set: { person.birthday = $0 }
                        ),
                        displayedComponents: [.date]
                    )
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: person) { _, new in
            onSave(new)
        }
    }
}
