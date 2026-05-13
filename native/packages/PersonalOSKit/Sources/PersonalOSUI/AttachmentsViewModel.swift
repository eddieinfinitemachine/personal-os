import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class AttachmentsViewModel {
    public let dashboardID: UUID
    public private(set) var attachments: [Attachment] = []
    public private(set) var lastError: String?

    private let store: AttachmentStore

    public init(dashboardID: UUID, store: AttachmentStore) {
        self.dashboardID = dashboardID
        self.store = store
        refresh()
    }

    public func refresh() {
        do {
            attachments = try store.fetch(dashboardID: dashboardID)
            lastError = nil
        } catch {
            attachments = []
            lastError = error.localizedDescription
        }
    }

    public func importLocal(url: URL) {
        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            if didStart { url.stopAccessingSecurityScopedResource() }
        }
        do {
            try store.importLocal(file: url, dashboardID: dashboardID)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func delete(id: UUID) {
        do {
            try store.delete(id: id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func data(for attachmentID: UUID) -> Data? {
        (try? store.data(for: attachmentID)) ?? nil
    }
}
