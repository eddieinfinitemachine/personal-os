import SwiftUI
import AppKit
import PersonalOSServices
import PersonalOSPersistence

@MainActor
struct ThingsImportCommand {
    let store: TodoStore

    func run() {
        let panel = NSOpenPanel()
        panel.title = "Select Things Database"
        panel.message = "Pick the Things SQLite file. It's at ~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-…/Things Database.thingsdatabase/main.sqlite"
        panel.allowedContentTypes = [.data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.directoryURL = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers", isDirectory: true)

        guard panel.runModal() == .OK, let url = panel.url else { return }

        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            if didStart { url.stopAccessingSecurityScopedResource() }
        }

        do {
            let importer = ThingsImporter(store: store)
            let result = try importer.importDatabase(at: url)
            showResult(result)
        } catch {
            showError(error)
        }
    }

    private func showResult(_ result: ThingsImportResult) {
        let alert = NSAlert()
        alert.messageText = "Things import complete"
        alert.informativeText = """
        Scanned: \(result.scanned)
        Created: \(result.created)
        Updated: \(result.updated)
        Skipped: \(result.skipped)
        """
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func showError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Things import failed"
        alert.informativeText = String(describing: error)
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
