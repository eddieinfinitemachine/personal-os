import SwiftUI
import PersonalOSModels

/// Pure presentational profile view. Owners (Mac/iOS) provide the view model.
public struct PersonProfileView: View {
    @Bindable public var viewModel: PersonProfileViewModel

    public init(viewModel: PersonProfileViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        Group {
            if let person = viewModel.person {
                content(for: person)
            } else {
                ContentUnavailableView(
                    "Person not found",
                    systemImage: "person.crop.circle.badge.questionmark"
                )
            }
        }
    }

    @ViewBuilder
    private func content(for person: Person) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(for: person)

                if let notes = person.notes, !notes.isEmpty {
                    section(title: "Notes") {
                        Text(notes)
                            .font(.body)
                    }
                }

                if let birthday = person.birthday {
                    section(title: "Birthday") {
                        Text(birthday, format: .dateTime.month(.wide).day().year())
                            .font(.body)
                    }
                }

                section(title: "Open todos (\(viewModel.todos.count))") {
                    if viewModel.todos.isEmpty {
                        Text("No open todos linked to this person.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    } else {
                        VStack(spacing: 6) {
                            ForEach(viewModel.todos) { todo in
                                TodoRow(todo: todo) {
                                    viewModel.toggleComplete(todo)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(.background.secondary, in: .rect(cornerRadius: 8))
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func header(for person: Person) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(.tint.opacity(0.15))
                Text(person.initials)
                    .font(.system(.title, design: .rounded, weight: .semibold))
                    .foregroundStyle(.tint)
            }
            .frame(width: 72, height: 72)

            VStack(alignment: .leading, spacing: 4) {
                Text(person.name.isEmpty ? "Untitled" : person.name)
                    .font(.title2.weight(.semibold))
                Label(person.role.title, systemImage: person.role.systemImage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let team = person.team, !team.isEmpty {
                    Text(team)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()
        }
    }

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            content()
        }
    }
}
