import SwiftUI
import PersonalOSModels
import PersonalOSPersistence
import PersonalOSUI

struct DashboardsColumn: View {
    @Environment(\.appEnvironment) private var env

    @Binding var selectedDashboardID: UUID?

    @State private var viewModel: DashboardsViewModel?

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel: viewModel)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Dashboards")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    if let new = viewModel?.createBlank() {
                        selectedDashboardID = new.id
                    }
                } label: {
                    Label("New Dashboard", systemImage: "plus")
                }
                .help("New Dashboard")
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = DashboardsViewModel(store: env.dashboards)
            } else {
                viewModel?.refresh()
            }
        }
    }

    @ViewBuilder
    private func content(viewModel: DashboardsViewModel) -> some View {
        if viewModel.dashboards.isEmpty {
            ContentUnavailableView(
                "No dashboards yet",
                systemImage: "square.grid.2x2",
                description: Text("Create dashboards to track vehicles, pets, your home, anything with custom fields.")
            )
        } else {
            List(selection: $selectedDashboardID) {
                ForEach(viewModel.groupedByType, id: \.type) { group in
                    Section(group.type.capitalized) {
                        ForEach(group.dashboards) { dashboard in
                            Label(
                                dashboard.name.isEmpty ? "Untitled" : dashboard.name,
                                systemImage: dashboard.icon
                            )
                            .tag(dashboard.id)
                            .contextMenu {
                                Button("Delete", role: .destructive) {
                                    viewModel.delete(id: dashboard.id)
                                    if selectedDashboardID == dashboard.id {
                                        selectedDashboardID = nil
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.inset(alternatesRowBackgrounds: false))
        }
    }
}

struct DashboardDetailColumn: View {
    @Environment(\.appEnvironment) private var env

    let dashboardID: UUID?

    @State private var viewModel: DashboardDetailViewModel?
    @State private var attachmentsViewModel: AttachmentsViewModel?
    @State private var remindersViewModel: DashboardRemindersViewModel?
    @State private var lastID: UUID?

    var body: some View {
        Group {
            if let viewModel, let attachmentsViewModel, dashboardID != nil {
                DashboardDetailView(
                    viewModel: viewModel,
                    attachmentsViewModel: attachmentsViewModel,
                    onAddAttachmentTapped: { presentImporter() },
                    remindersViewModel: remindersViewModel
                )
            } else {
                ContentUnavailableView(
                    "No dashboard selected",
                    systemImage: "square.grid.2x2",
                    description: Text("Pick a dashboard from the middle column or create a new one.")
                )
            }
        }
        .onChange(of: dashboardID) { _, newID in
            rebuild(for: newID)
        }
        .onAppear {
            rebuild(for: dashboardID)
        }
    }

    private func rebuild(for id: UUID?) {
        guard let id else {
            viewModel = nil
            attachmentsViewModel = nil
            remindersViewModel = nil
            lastID = nil
            return
        }
        if id == lastID, viewModel != nil {
            viewModel?.refresh()
            attachmentsViewModel?.refresh()
            remindersViewModel?.refresh()
            return
        }
        viewModel = DashboardDetailViewModel(dashboardID: id, store: env.dashboards)
        attachmentsViewModel = AttachmentsViewModel(dashboardID: id, store: env.attachments)
        remindersViewModel = DashboardRemindersViewModel(
            dashboardID: id,
            reminders: env.reminders,
            engine: env.makeReminderEngine()
        )
        lastID = id
    }

    private func presentImporter() {
        guard let attachmentsViewModel else { return }
        let panel = NSOpenPanel()
        panel.title = "Add file"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        attachmentsViewModel.importLocal(url: url)
    }
}
