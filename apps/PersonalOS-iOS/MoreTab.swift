import SwiftUI
import PersonalOSUI

struct MoreTab: View {
    @Environment(\.appEnvironment) private var env
    @State private var settingsViewModel: SettingsViewModel?
    @State private var vaultViewModel: VaultViewModel?

    var body: some View {
        NavigationStack {
            List {
                NavigationLink {
                    vaultScreen
                } label: {
                    Label("Vault", systemImage: "lock.shield")
                }

                NavigationLink {
                    settingsScreen
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                Section {
                    Label("Birthdays — coming soon", systemImage: "gift")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("More")
        }
    }

    @ViewBuilder
    private var vaultScreen: some View {
        Group {
            if let vaultViewModel {
                VaultView(viewModel: vaultViewModel)
            } else {
                ProgressView()
            }
        }
        .onAppear {
            if vaultViewModel == nil {
                vaultViewModel = VaultViewModel(store: env.vault)
            } else {
                // Re-locked on every entry per the brief.
                vaultViewModel?.lock()
            }
        }
    }

    @ViewBuilder
    private var settingsScreen: some View {
        Group {
            if let settingsViewModel {
                SettingsView(viewModel: settingsViewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if settingsViewModel == nil {
                settingsViewModel = SettingsViewModel(keychain: env.keychain)
            } else {
                settingsViewModel?.refresh()
            }
        }
    }
}
