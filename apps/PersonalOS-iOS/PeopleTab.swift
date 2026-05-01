import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct PeopleTab: View {
    @Environment(\.appEnvironment) private var env

    @State private var viewModel: PeopleViewModel?
    @State private var selectedPersonID: UUID?

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 12)]

    var body: some View {
        NavigationStack {
            Group {
                if let viewModel {
                    content(viewModel: viewModel)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("People")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if let new = viewModel?.createBlank() {
                            selectedPersonID = new.id
                        }
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                }
            }
            .navigationDestination(item: $selectedPersonID) { id in
                PersonDetailScreen(personID: id, onChange: {
                    viewModel?.refresh()
                })
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
                description: Text("Tap + to add the people you work with.")
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
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
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .refreshable {
                viewModel.refresh()
            }
        }
    }

    private func openTodoCount(for person: Person) -> Int {
        (try? env.todos.fetch(personID: person.id).count) ?? 0
    }
}

struct PersonDetailScreen: View {
    @Environment(\.appEnvironment) private var env
    @Environment(\.dismiss) private var dismiss

    let personID: UUID
    let onChange: () -> Void

    @State private var viewModel: PersonProfileViewModel?
    @State private var showingEditor = false

    var body: some View {
        Group {
            if let viewModel {
                PersonProfileView(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(viewModel?.person?.name ?? "Person")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { showingEditor = true }
            }
        }
        .sheet(isPresented: $showingEditor, onDismiss: {
            viewModel?.refresh()
            onChange()
        }) {
            if let viewModel, let person = viewModel.person {
                NavigationStack {
                    PersonEditorView(
                        person: Binding(
                            get: { person },
                            set: { viewModel.updatePerson($0) }
                        ),
                        onSave: { viewModel.updatePerson($0) }
                    )
                    .navigationTitle("Edit Person")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showingEditor = false }
                                .fontWeight(.semibold)
                        }
                    }
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = PersonProfileViewModel(
                    personID: personID,
                    people: env.people,
                    todos: env.todos
                )
            } else {
                viewModel?.refresh()
            }
        }
    }
}
