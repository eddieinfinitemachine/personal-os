import SwiftUI
import PersonalOSModels
import PersonalOSUI

enum AppTab: Hashable {
    case today, lists, people, dashboards, more
}

struct RootView: View {
    @State private var selectedTab: AppTab = .today

    var body: some View {
        TabView(selection: $selectedTab) {
            TodayTab()
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(AppTab.today)

            ListsTab()
                .tabItem { Label("Lists", systemImage: "checklist") }
                .tag(AppTab.lists)

            PeopleTab()
                .tabItem { Label("People", systemImage: "person.2") }
                .tag(AppTab.people)

            DashboardsTab()
                .tabItem { Label("Dashboards", systemImage: "square.grid.2x2") }
                .tag(AppTab.dashboards)

            MoreTab()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(AppTab.more)
        }
    }
}

#Preview {
    RootView()
        .environment(\.appEnvironment, .preview)
}
