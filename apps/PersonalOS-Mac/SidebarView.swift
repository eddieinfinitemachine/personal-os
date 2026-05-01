import SwiftUI
import PersonalOSModels

struct SidebarView: View {
    @Binding var selectedList: TodoList

    var body: some View {
        List(selection: $selectedList) {
            Section("Lists") {
                ForEach(TodoList.allCases) { list in
                    Label(list.title, systemImage: list.systemImage)
                        .tag(list)
                }
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
    SidebarView(selectedList: .constant(.todo))
        .frame(width: 200, height: 400)
}
