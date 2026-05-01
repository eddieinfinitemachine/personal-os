import SwiftUI
import PersonalOSUI
import PersonalOSServices

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

                Button("Quick Add…") {
                    NotificationCenter.default.post(name: .quickAddRequested, object: nil)
                }
                .keyboardShortcut(.space, modifiers: [.command, .shift])
            }
            CommandGroup(after: .newItem) {
                Divider()
                Button("Import from Things…") {
                    ThingsImportCommand(store: environment.todos).run()
                }
            }
        }

        Settings {
            MacSettingsScene()
                .environment(\.appEnvironment, environment)
        }
    }
}

struct MacSettingsScene: View {
    @Environment(\.appEnvironment) private var env
    @State private var viewModel: SettingsViewModel?

    var body: some View {
        Group {
            if let viewModel {
                SettingsView(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .frame(width: 480, height: 320)
        .onAppear {
            if viewModel == nil {
                viewModel = SettingsViewModel(keychain: env.keychain)
            } else {
                viewModel?.refresh()
            }
        }
    }
}

extension Notification.Name {
    static let newTodoRequested = Notification.Name("com.zelig.PersonalOS.newTodoRequested")
    static let quickAddRequested = Notification.Name("com.zelig.PersonalOS.quickAddRequested")
}
