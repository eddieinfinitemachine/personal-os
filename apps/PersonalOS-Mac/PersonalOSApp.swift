import SwiftUI
import PersonalOSUI

@main
struct PersonalOSApp: App {
    @State private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.appEnvironment, environment)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Todo") {
                    NotificationCenter.default.post(name: .newTodoRequested, object: nil)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Divider()
                Button("Import from Things…") {
                    ThingsImportCommand(store: environment.todos).run()
                }
            }
        }
    }
}

extension Notification.Name {
    static let newTodoRequested = Notification.Name("com.zelig.PersonalOS.newTodoRequested")
}
