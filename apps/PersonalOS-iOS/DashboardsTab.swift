import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct DashboardsTab: View {
    @Environment(\.appEnvironment) private var env

    @State private var viewModel: DashboardsViewModel?
    @State private var selectedID: UUID?

    var body: some View {
        NavigationStack {
            Group {
                if let viewModel {
                    content(viewModel: viewModel)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Dashboards")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if let new = viewModel?.createBlank() {
                            selectedID = new.id
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .navigationDestination(item: $selectedID) { id in
                DashboardDetailScreen(dashboardID: id, onChange: {
                    viewModel?.refresh()
                })
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
                description: Text("Tap + to create your first dashboard.")
            )
        } else {
            List {
                ForEach(viewModel.groupedByType, id: \.type) { group in
                    Section(group.type.capitalized) {
                        ForEach(group.dashboards) { dashboard in
                            Button {
                                selectedID = dashboard.id
                            } label: {
                                HStack {
                                    Image(systemName: dashboard.icon)
                                        .foregroundStyle(.tint)
                                        .frame(width: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(dashboard.name.isEmpty ? "Untitled" : dashboard.name)
                                            .foregroundStyle(.primary)
                                        Text("\(dashboard.fields.count) field\(dashboard.fields.count == 1 ? "" : "s")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    viewModel.delete(id: dashboard.id)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
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

struct DashboardDetailScreen: View {
    @Environment(\.appEnvironment) private var env

    let dashboardID: UUID
    let onChange: () -> Void

    @State private var viewModel: DashboardDetailViewModel?
    @State private var attachmentsViewModel: AttachmentsViewModel?
    @State private var remindersViewModel: DashboardRemindersViewModel?
    @State private var showingImporter = false

    var body: some View {
        Group {
            if let viewModel, let attachmentsViewModel {
                DashboardDetailView(
                    viewModel: viewModel,
                    attachmentsViewModel: attachmentsViewModel,
                    onAddAttachmentTapped: { showingImporter = true },
                    remindersViewModel: remindersViewModel
                )
            } else {
                ProgressView()
            }
        }
        .navigationTitle(viewModel?.dashboard?.name ?? "Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first {
                    attachmentsViewModel?.importLocal(url: url)
                }
            case .failure:
                break
            }
        }
        .onDisappear {
            onChange()
        }
        .onAppear {
            if viewModel == nil {
                viewModel = DashboardDetailViewModel(dashboardID: dashboardID, store: env.dashboards)
                attachmentsViewModel = AttachmentsViewModel(dashboardID: dashboardID, store: env.attachments)
                remindersViewModel = DashboardRemindersViewModel(
                    dashboardID: dashboardID,
                    reminders: env.reminders,
                    engine: env.makeReminderEngine()
                )
            } else {
                viewModel?.refresh()
                attachmentsViewModel?.refresh()
                remindersViewModel?.refresh()
            }
        }
    }
}
