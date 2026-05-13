import SwiftUI
import PersonalOSModels
import PersonalOSPersistence
import PersonalOSUI

struct PeopleColumn: View {
    @Environment(\.appEnvironment) private var env

    @Binding var selectedPersonID: UUID?

    @State private var viewModel: PeopleViewModel?

    private let columns = [GridItem(.adaptive(minimum: 180, maximum: 260), spacing: 12)]

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel: viewModel)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("People")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    if let new = viewModel?.createBlank() {
                        selectedPersonID = new.id
                    }
                } label: {
                    Label("Add Person", systemImage: "person.badge.plus")
                }
                .help("Add Person")
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = PeopleViewModel(store: env.people)
            } else {
                viewModel?.refresh()
            }
        }
    }

    @ViewBuilder
    private func content(viewModel: PeopleViewModel) -> some View {
        if viewModel.people.isEmpty {
            ContentUnavailableView(
                "No people yet",
                systemImage: "person.2",
                description: Text("Add the people you work with to keep their context one click away.")
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(viewModel.groupedByRole, id: \.role) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(group.role.groupTitle.uppercased())
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 16)

                            LazyVGrid(columns: columns, spacing: 12) {
                                ForEach(group.people) { person in
                                    Button {
                                        selectedPersonID = person.id
                                    } label: {
                                        PersonTile(
                                            person: person,
                                            openTodoCount: openTodoCount(for: person)
                                        )
                                        .overlay {
                                            if selectedPersonID == person.id {
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(.tint, lineWidth: 2)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button("Delete", role: .destructive) {
                                            viewModel.delete(id: person.id)
                                            if selectedPersonID == person.id {
                                                selectedPersonID = nil
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.vertical, 16)
            }
        }
    }

    private func openTodoCount(for person: Person) -> Int {
        (try? env.todos.fetch(personID: person.id).count) ?? 0
    }
}

struct PersonDetailColumn: View {
    @Environment(\.appEnvironment) private var env

    let personID: UUID?

    @State private var viewModel: PersonProfileViewModel?
    @State private var lastID: UUID?

    var body: some View {
        Group {
            if let personID, let viewModel {
                editor(viewModel: viewModel)
            } else {
                ContentUnavailableView(
                    "No person selected",
                    systemImage: "person.crop.circle",
                    description: Text("Pick someone from the grid, or add a new person.")
                )
            }
        }
        .onChange(of: personID) { _, newID in
            rebuild(for: newID)
        }
        .onAppear {
            rebuild(for: personID)
        }
    }

    @ViewBuilder
    private func editor(viewModel: PersonProfileViewModel) -> some View {
        if let person = viewModel.person {
            HSplitView {
                PersonProfileView(viewModel: viewModel)
                    .frame(minWidth: 280)

                PersonEditorView(
                    person: Binding(
                        get: { person },
                        set: { viewModel.updatePerson($0) }
                    ),
                    onSave: { viewModel.updatePerson($0) }
                )
                .frame(minWidth: 280)
            }
        } else {
            ProgressView()
        }
    }

    private func rebuild(for id: UUID?) {
        guard let id else {
            viewModel = nil
            lastID = nil
            return
        }
        if id == lastID, viewModel != nil {
            viewModel?.refresh()
            return
        }
        viewModel = PersonProfileViewModel(personID: id, people: env.people, todos: env.todos)
        lastID = id
    }
}
