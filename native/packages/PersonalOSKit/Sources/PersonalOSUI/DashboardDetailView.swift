import SwiftUI
import PersonalOSModels

/// Editable dashboard view used on Mac (in the detail column) and iOS (in
/// a navigation destination).
public struct DashboardDetailView: View {
    @Bindable public var viewModel: DashboardDetailViewModel
    /// Optional attachments view-model. When provided, an attachments section
    /// is rendered.
    let attachmentsViewModel: AttachmentsViewModel?
    let onAddAttachmentTapped: () -> Void
    /// Optional reminders view-model. When provided, a reminders section is
    /// rendered.
    let remindersViewModel: DashboardRemindersViewModel?

    @State private var showingAddField = false
    @State private var newFieldLabel = ""
    @State private var newFieldKind: FieldKind = .text

    public init(
        viewModel: DashboardDetailViewModel,
        attachmentsViewModel: AttachmentsViewModel? = nil,
        onAddAttachmentTapped: @escaping () -> Void = {},
        remindersViewModel: DashboardRemindersViewModel? = nil
    ) {
        self.viewModel = viewModel
        self.attachmentsViewModel = attachmentsViewModel
        self.onAddAttachmentTapped = onAddAttachmentTapped
        self.remindersViewModel = remindersViewModel
    }

    public var body: some View {
        Group {
            if let dashboard = viewModel.dashboard {
                content(for: dashboard)
            } else {
                ContentUnavailableView(
                    "Dashboard not found",
                    systemImage: "square.grid.2x2"
                )
            }
        }
        .sheet(isPresented: $showingAddField) {
            AddFieldSheet(
                label: $newFieldLabel,
                kind: $newFieldKind,
                onCancel: { showingAddField = false },
                onAdd: { label, kind in
                    viewModel.addField(kind: kind, label: label)
                    newFieldLabel = ""
                    showingAddField = false
                }
            )
            #if os(macOS)
            .frame(minWidth: 360, idealHeight: 220)
            #else
            .presentationDetents([.medium])
            #endif
        }
    }

    @ViewBuilder
    private func content(for dashboard: Dashboard) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header(for: dashboard)
                fieldsList(for: dashboard)
                if let remindersViewModel {
                    RemindersSection(viewModel: remindersViewModel, dashboard: dashboard)
                }
                if let attachmentsViewModel {
                    AttachmentsSection(
                        viewModel: attachmentsViewModel,
                        onAddTapped: onAddAttachmentTapped
                    )
                }
            }
            .padding(20)
        }
    }

    private func header(for dashboard: Dashboard) -> some View {
        HStack(alignment: .center, spacing: 16) {
            Image(systemName: dashboard.icon)
                .font(.system(size: 32))
                .foregroundStyle(.tint)
                .frame(width: 56, height: 56)
                .background(.tint.opacity(0.12), in: .rect(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                TextField("Name", text: nameBinding(for: dashboard))
                    .font(.title2.weight(.semibold))
                    .textFieldStyle(.plain)
                Text(dashboard.type.uppercased())
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }

    private func fieldsList(for dashboard: Dashboard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Fields")
                    .font(.headline)
                Spacer()
                Button {
                    showingAddField = true
                } label: {
                    Label("Add Field", systemImage: "plus")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if dashboard.fields.isEmpty {
                ContentUnavailableView(
                    "No fields yet",
                    systemImage: "list.bullet.rectangle",
                    description: Text("Add your first field to track something on this dashboard.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                ForEach(Array(dashboard.fields.enumerated()), id: \.element.id) { index, field in
                    HStack(alignment: .top) {
                        FieldEditor(field: bindingForField(at: index))
                        Button(role: .destructive) {
                            viewModel.removeField(field.id)
                        } label: {
                            Image(systemName: "minus.circle")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 8)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(.background.secondary, in: .rect(cornerRadius: 8))
                }
            }
        }
    }

    // MARK: Bindings into the view-model snapshot

    private func nameBinding(for dashboard: Dashboard) -> Binding<String> {
        Binding(
            get: { dashboard.name },
            set: { newName in
                var updated = dashboard
                updated.name = newName
                viewModel.save(updated)
            }
        )
    }

    private func bindingForField(at index: Int) -> Binding<FieldValue> {
        Binding(
            get: { viewModel.dashboard?.fields[safe: index] ?? FieldValue.empty(kind: .text, label: "") },
            set: { newField in
                guard var dashboard = viewModel.dashboard else { return }
                guard index < dashboard.fields.count else { return }
                dashboard.fields[index] = newField
                viewModel.save(dashboard)
            }
        )
    }
}

private struct AddFieldSheet: View {
    @Binding var label: String
    @Binding var kind: FieldKind
    let onCancel: () -> Void
    let onAdd: (String, FieldKind) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New field")
                .font(.headline)

            Form {
                TextField("Label", text: $label)
                Picker("Kind", selection: $kind) {
                    ForEach(FieldKind.userPickable) { kind in
                        Label(kind.title, systemImage: kind.systemImage).tag(kind)
                    }
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") {
                    let trimmed = label.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    onAdd(trimmed, kind)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
