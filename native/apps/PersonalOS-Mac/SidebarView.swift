import SwiftUI
import PersonalOSModels

struct SidebarView: View {
    @Binding var selection: SidebarItem

    var body: some View {
        List(selection: $selection) {
            Section("Lists") {
                ForEach(TodoList.allCases) { list in
                    Label(list.title, systemImage: list.systemImage)
                        .tag(SidebarItem.list(list))
                }
            }

            Section("Network") {
                Label("People", systemImage: "person.2")
                    .tag(SidebarItem.people)
            }

            Section("Workspaces") {
                Label("Dashboards", systemImage: "square.grid.2x2")
                    .tag(SidebarItem.dashboards)
            }

            Section("Private") {
                Label("Vault", systemImage: "lock.shield")
                    .tag(SidebarItem.vault)
            }

            Section("Smart filters") {
                Label("This Week", systemImage: "calendar.badge.clock")
                    .foregroundStyle(.tertiary)
                Label("Overdue", systemImage: "exclamationmark.circle")
                    .foregroundStyle(.tertiary)
            }
        }
        .listStyle(.sidebar)
    }
}

#Preview {
    SidebarView(selection: .constant(.list(.todo)))
        .frame(width: 200, height: 400)
}
