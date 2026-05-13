import SwiftUI
import PersonalOSModels
import PersonalOSUI
import PersonalOSServices

enum SidebarItem: Hashable {
    case list(TodoList)
    case people
    case dashboards
    case vault
}

struct RootView: View {
    @Environment(\.appEnvironment) private var env

    @State private var selection: SidebarItem = .list(.todo)
    @State private var selectedTodoID: UUID?
    @State private var selectedPersonID: UUID?
    @State private var selectedDashboardID: UUID?
    @State private var showingQuickAdd = false
    @State private var quickAddViewModel: QuickAddViewModel?
    @State private var vaultViewModel: VaultViewModel?

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selection)
                .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
        } content: {
            middleColumn
                .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        } detail: {
            detailColumn
        }
        .navigationTitle("Personal OS")
        .sheet(isPresented: $showingQuickAdd) {
            if let quickAddViewModel {
                QuickAddView(viewModel: quickAddViewModel) {
                    showingQuickAdd = false
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .quickAddRequested)) { _ in
            presentQuickAdd()
        }
        .task {
            // Fire any due reminders on app launch + once per appearance.
            _ = try? env.makeReminderEngine().tick()
            _ = try? env.makeBirthdayService().tick()
        }
    }

    private func presentQuickAdd() {
        let nlClient = env.makeAnthropicClient().map { NLCaptureService(client: $0) }
        quickAddViewModel = QuickAddViewModel(todos: env.todos, nl: nlClient)
        showingQuickAdd = true
    }

    @ViewBuilder
    private var middleColumn: some View {
        switch selection {
        case .list(let list):
            TodoListColumn(list: list, selectedTodoID: $selectedTodoID)
        case .people:
            PeopleColumn(selectedPersonID: $selectedPersonID)
        case .dashboards:
            DashboardsColumn(selectedDashboardID: $selectedDashboardID)
        case .vault:
            vaultColumn
        }
    }

    @ViewBuilder
    private var detailColumn: some View {
        switch selection {
        case .list(let list):
            TodoDetailColumn(selectedTodoID: $selectedTodoID, list: list)
        case .people:
            PersonDetailColumn(personID: selectedPersonID)
        case .dashboards:
            DashboardDetailColumn(dashboardID: selectedDashboardID)
        case .vault:
            ContentUnavailableView(
                "Vault",
                systemImage: "lock.shield",
                description: Text("Open the vault from the middle column.")
            )
        }
    }

    @ViewBuilder
    private var vaultColumn: some View {
        if let vaultViewModel {
            VaultView(viewModel: vaultViewModel)
        } else {
            ProgressView().onAppear {
                vaultViewModel = VaultViewModel(store: env.vault)
            }
        }
    }
}

#Preview {
    RootView()
        .environment(\.appEnvironment, AppEnvironment.seededPreview())
        .frame(width: 1100, height: 700)
}
