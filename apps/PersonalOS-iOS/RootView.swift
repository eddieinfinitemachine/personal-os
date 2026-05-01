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

            PlaceholderTab(
                title: "People",
                systemImage: "person.2",
                description: "Coming in Sprint 2"
            )
            .tabItem { Label("People", systemImage: "person.2") }
            .tag(AppTab.people)

            PlaceholderTab(
                title: "Dashboards",
                systemImage: "square.grid.2x2",
                description: "Coming in Sprint 2"
            )
            .tabItem { Label("Dashboards", systemImage: "square.grid.2x2") }
            .tag(AppTab.dashboards)

            PlaceholderTab(
                title: "More",
                systemImage: "ellipsis.circle",
                description: "Vault, birthdays, settings — Sprint 5"
            )
            .tabItem { Label("More", systemImage: "ellipsis.circle") }
            .tag(AppTab.more)
        }
    }
}

struct PlaceholderTab: View {
    let title: String
    let systemImage: String
    let description: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                title,
                systemImage: systemImage,
                description: Text(description)
            )
            .navigationTitle(title)
        }
    }
}

#Preview {
    RootView()
        .environment(\.appEnvironment, .preview)
}
