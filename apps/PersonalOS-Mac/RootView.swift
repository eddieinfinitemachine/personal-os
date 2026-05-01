import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct RootView: View {
    @Environment(\.appEnvironment) private var env

    @State private var selectedList: TodoList = .todo
    @State private var selectedTodoID: UUID?

    var body: some View {
        NavigationSplitView {
            SidebarView(selectedList: $selectedList)
                .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
        } content: {
            TodoListColumn(
                list: selectedList,
                selectedTodoID: $selectedTodoID
            )
            .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        } detail: {
            TodoDetailColumn(selectedTodoID: $selectedTodoID, list: selectedList)
        }
        .navigationTitle("Personal OS")
    }
}

#Preview {
    RootView()
        .environment(\.appEnvironment, .preview)
        .frame(width: 1100, height: 700)
}
