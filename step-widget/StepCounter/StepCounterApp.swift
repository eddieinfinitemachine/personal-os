import BackgroundTasks
import SwiftUI
import UIKit

@main
struct StepCounterApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var health = HealthStore.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(health)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await health.refresh() }
            case .background:
                HealthStore.scheduleBackgroundRefresh()
            default:
                break
            }
        }
    }
}

/// Launch-time hooks that must run before any scene exists. HealthKit wakes the
/// app in the background to deliver new samples, and the observer query has to
/// be re-registered on each of those launches or the delivery is wasted.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        HealthStore.registerBackgroundTask()
        HealthStore.shared.startBackgroundDeliveryIfAuthorized()
        return true
    }
}
