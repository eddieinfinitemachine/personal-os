import SwiftUI
import PersonalOSUI

@main
struct PersonalOSApp: App {
    @State private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.appEnvironment, environment)
        }
    }
}
